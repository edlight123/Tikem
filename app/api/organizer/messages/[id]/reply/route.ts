/**
 * POST /api/organizer/messages/[id]/reply
 *
 * The organizer answers an attendee's question. This is the half that was
 * missing: until now a message could be written but never answered, so a buyer
 * asking "is this real?" got silence.
 *
 * Only the event's org (its owner, admin or manager) may reply, and the
 * reply is delivered two ways — an in-app notification carrying the answer text,
 * and an email to the address we resolve OURSELVES from the thread's sender_id.
 * The organizer supplies words, never a recipient: there is no code path here
 * that can email an address handed over by a client.
 *
 * A reply may quote one earlier message of the SAME thread (`reply_to_id`).
 * Nothing is written when either side has blocked the other
 * (lib/messages/blockGuard.ts): the attendee blocked the org or the team
 * member typing, or the org (owner, an admin, or that member) blocked the
 * attendee. 403 `blocked` / `you_blocked`.
 */
import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { orgDisplayName } from '@/lib/organizer/context'
import { getThreadForOrgMember } from '@/lib/messages/threadViewer'
import { createNotification } from '@/lib/notifications/helpers'
import { sendEmail, getOrganizerReplyEmail, emailSubjects } from '@/lib/email'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { attendeeThreadPath, pushAttendeeOfReply } from '@/lib/organizer-message-alerts'
import {
  appendOrganizerReply,
  MAX_REPLIES_PER_THREAD,
  MAX_REPLY_LENGTH,
  resolveReplyTo,
} from '@/lib/organizer-messages'
import { readReplyToId } from '@/lib/messages/threadExtras'
import { blockMessage, messagingRefusal } from '@/lib/messages/blockGuard'

export const dynamic = 'force-dynamic'

/** Enough of the reply to be useful in a notification list without flooding it. */
const NOTIFICATION_EXCERPT = 300

function fail(error: string, code: string, status = 400) {
  return NextResponse.json({ error, code }, { status })
}

function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: threadId } = await params
    if (!threadId) return fail('Message is required.', 'missing_thread_id')

    const user = await getCurrentUser()
    if (!user) return fail('You must be signed in to reply.', 'unauthorized', 401)

    let body: any
    try {
      body = await request.json()
    } catch {
      return fail('Malformed request body.', 'bad_request')
    }

    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!message) return fail('Write a reply before sending.', 'missing_message')
    if (message.length > MAX_REPLY_LENGTH) {
      return fail(`Keep your reply under ${MAX_REPLY_LENGTH} characters.`, 'message_too_long')
    }
    // Optional: the message this one quotes (`reply_to_id`, or `reply_to.id`).
    const replyToId = readReplyToId(body)
    if (replyToId === null) return fail('That message can no longer be quoted.', 'reply_to_not_found')

    // A thread that does not exist and a thread belonging to another organizer
    // return the same 404 — replying must not double as a way to discover which
    // message ids are real.
    // Authorized by the THREAD'S own org (its account, or a team member who
    // may run its events), not the org the app is acting for: a member of
    // several orgs must be able to answer on any of them (lib/messages/threadViewer).
    const thread = await getThreadForOrgMember(threadId, user, 'manage_events')
    if (!thread) return fail('Message not found.', 'thread_not_found', 404)
    const org = { value: { orgId: thread.orgId, isOwner: thread.isOwner } }

    const refusal = await messagingRefusal({
      side: 'organizer',
      orgId: thread.orgId,
      attendeeId: String(thread.data.sender_id || ''),
      actingUserId: user.id,
    })
    if (refusal) return fail(blockMessage(refusal), refusal, 403)

    const replyCount =
      typeof thread.data.reply_count === 'number' ? thread.data.reply_count : 0
    if (replyCount >= MAX_REPLIES_PER_THREAD) {
      return fail(
        'This conversation has reached its reply limit.',
        'thread_reply_limit',
        429
      )
    }

    // The quoted message must belong to THIS thread.
    const replyTo = replyToId ? await resolveReplyTo(threadId, thread.data, replyToId) : null
    if (replyToId && !replyTo) return fail('That message can no longer be quoted.', 'reply_to_not_found')

    // The attendee hears from the ORG, whoever on its team typed the answer.
    // A member's personal name is never the fallback: only the owner's is.
    const orgName =
      (await orgDisplayName(org.value.orgId)) ||
      (org.value.isOwner ? String((user as any).full_name || '').trim() : '')
    const organizerName = orgName || 'The organizer'
    const attendeeId = String(thread.data.sender_id || '')
    const eventId = String(thread.data.event_id || '')
    const eventTitle = String(thread.data.event_title || 'your event')

    const reply = await appendOrganizerReply({
      threadId,
      // The reply's author is the person who wrote it, even for a team member.
      organizerId: user.id,
      authorName: organizerName,
      body: message,
      alreadyRead: Boolean(thread.data.organizer_read_at),
      replyTo,
    })

    // The reply is stored. Neither delivery channel may take it back down, so
    // both are best-effort and independently guarded.
    if (attendeeId) {
      // The answer still travels IN the notification (older app builds show it
      // there), and the link now opens the conversation itself: /profile's
      // Messages panel on the web, the MessageThread screen in the app.
      try {
        await createNotification(
          attendeeId,
          'organizer_reply',
          `${organizerName} replied about ${eventTitle}`,
          excerpt(message, NOTIFICATION_EXCERPT),
          attendeeThreadPath(threadId),
          // `message` is an excerpt so notification lists stay scannable;
          // replyBody carries the answer in full for the surfaces that show it.
          { eventId, messageId: threadId, replyId: reply.id, replyBody: message }
        )
      } catch (error) {
        console.error('organizer reply: notification failed', error)
      }

      try {
        const attendeeSnap = await adminDb.collection('users').doc(attendeeId).get()
        const attendee = attendeeSnap.data() || {}
        await pushAttendeeOfReply({
          attendeeId,
          attendee,
          threadId,
          eventId,
          eventTitle,
          organizerName,
          reply: message,
        })
        const to = String(attendee.email || '').trim()
        if (to) {
          // The attendee's profile is already loaded: write in their language.
          const lang = await resolveEmailLang({ explicit: (attendee as any).language })
          const namedOrganizer =
            orgName ||
            { en: 'The organizer', fr: "L'organisateur", ht: 'Òganizatè a' }[lang]
          await sendEmail({
            to,
            subject: emailSubjects.organizerReply(lang, namedOrganizer, eventTitle),
            html: getOrganizerReplyEmail({
              lang,
              attendeeName: String(attendee.full_name || '').trim(),
              organizerName: namedOrganizer,
              eventTitle,
              eventId,
              question: String(thread.data.message || ''),
              reply: message,
              threadId,
            }),
          })
        }
      } catch (error) {
        console.error('organizer reply: email failed', error)
      }
    }

    return NextResponse.json({ ok: true, reply })
  } catch (error) {
    console.error('organizer reply failed', error)
    return fail('Could not send your reply. Try again.', 'internal_error', 500)
  }
}
