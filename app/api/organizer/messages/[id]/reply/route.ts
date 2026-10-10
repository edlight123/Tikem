/**
 * POST /api/organizer/messages/[id]/reply
 *
 * The organizer answers an attendee's question. This is the half that was
 * missing: until now a message could be written but never answered, so a buyer
 * asking "is this real?" got silence.
 *
 * Only the organizer who owns the event the thread belongs to may reply, and the
 * reply is delivered two ways — an in-app notification carrying the answer text,
 * and an email to the address we resolve OURSELVES from the thread's sender_id.
 * The organizer supplies words, never a recipient: there is no code path here
 * that can email an address handed over by a client.
 */
import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { createNotification } from '@/lib/notifications/helpers'
import { sendEmail, getOrganizerReplyEmail, emailSubjects } from '@/lib/email'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import {
  appendOrganizerReply,
  getThreadForOrganizer,
  MAX_REPLIES_PER_THREAD,
  MAX_REPLY_LENGTH,
} from '@/lib/organizer-messages'

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

    // A thread that does not exist and a thread belonging to another organizer
    // return the same 404 — replying must not double as a way to discover which
    // message ids are real.
    const thread = await getThreadForOrganizer(threadId, user.id)
    if (!thread) return fail('Message not found.', 'thread_not_found', 404)

    const replyCount =
      typeof thread.data.reply_count === 'number' ? thread.data.reply_count : 0
    if (replyCount >= MAX_REPLIES_PER_THREAD) {
      return fail(
        'This conversation has reached its reply limit.',
        'thread_reply_limit',
        429
      )
    }

    const organizerName = String((user as any).full_name || '').trim() || 'The organizer'
    const attendeeId = String(thread.data.sender_id || '')
    const eventId = String(thread.data.event_id || '')
    const eventTitle = String(thread.data.event_title || 'your event')

    const reply = await appendOrganizerReply({
      threadId,
      organizerId: user.id,
      authorName: organizerName,
      body: message,
      alreadyRead: Boolean(thread.data.organizer_read_at),
    })

    // The reply is stored. Neither delivery channel may take it back down, so
    // both are best-effort and independently guarded.
    if (attendeeId) {
      // The answer travels IN the notification. The attendee has no thread view
      // of their own, so a bare "you have a reply" would be a dead end.
      try {
        await createNotification(
          attendeeId,
          'organizer_reply',
          `${organizerName} replied about ${eventTitle}`,
          excerpt(message, NOTIFICATION_EXCERPT),
          eventId ? `/events/${eventId}` : undefined,
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
        const to = String(attendee.email || '').trim()
        if (to) {
          // The attendee's profile is already loaded: write in their language.
          const lang = await resolveEmailLang({ explicit: (attendee as any).language })
          const namedOrganizer =
            String((user as any).full_name || '').trim() ||
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
