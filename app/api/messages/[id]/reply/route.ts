/**
 * POST /api/messages/[id]/reply
 *
 * The attendee answers back in their OWN thread: a follow-up stored in the same
 * `replies` subcollection as the organizer's answers, with
 * `author_role: 'attendee'` (see lib/organizer-messages.ts).
 *
 * Only the attendee who opened the thread may post here. The organizer answers
 * through POST /api/organizer/messages/[id]/reply, so an organizer calling this
 * route is refused with 403, and a stranger gets the same 404 as a missing
 * thread.
 *
 * Caps (checked in one transaction with the write):
 *  - MAX_FOLLOWUP_LENGTH characters per message;
 *  - MAX_REPLIES_PER_THREAD messages per thread after the opener, both sides;
 *  - MAX_ATTENDEE_STREAK attendee messages in a row without an organizer
 *    answer (the opener counts).
 *
 * The organizer then gets an in-app notification and a push for every
 * follow-up, and at most one email per thread per 30 minutes.
 */
import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { alertOrganizerOfMessage } from '@/lib/organizer-message-alerts'
import {
  appendAttendeeFollowUp,
  getThreadForParticipant,
  MAX_FOLLOWUP_LENGTH,
} from '@/lib/organizer-messages'

export const dynamic = 'force-dynamic'

function fail(error: string, code: string, status = 400) {
  return NextResponse.json({ error, code }, { status })
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
    if (!message) return fail('Write a message before sending.', 'missing_message')
    if (message.length > MAX_FOLLOWUP_LENGTH) {
      return fail(`Keep it under ${MAX_FOLLOWUP_LENGTH} characters.`, 'message_too_long')
    }

    const record = await getThreadForParticipant(threadId, user.id)
    if (!record) return fail('Message not found.', 'thread_not_found', 404)
    if (record.role !== 'attendee') {
      return fail('Organizers reply from their inbox.', 'organizer_use_inbox', 403)
    }

    // The name on the thread was snapshotted when it was opened; keep using
    // it so the organizer sees one consistent name across the conversation.
    const authorName =
      String(record.data.sender_name || '').trim() ||
      String((user as any).full_name || '').trim() ||
      'An attendee'

    const result = await appendAttendeeFollowUp({
      threadId,
      attendeeId: user.id,
      authorName,
      body: message,
    })

    if (!result.ok) {
      if (result.code === 'thread_not_found') return fail('Message not found.', 'thread_not_found', 404)
      if (result.code === 'thread_reply_limit') {
        return fail('This conversation has reached its message limit.', 'thread_reply_limit', 429)
      }
      return fail(
        'Give the organizer a chance to answer before writing again.',
        'awaiting_reply',
        429
      )
    }

    const thread = result.thread
    const eventId = String(thread.event_id || '')
    let event: Record<string, any> | null = null
    try {
      const snap = eventId ? await adminDb.collection('events').doc(eventId).get() : null
      event = snap?.exists ? snap.data() || null : null
    } catch {
      event = null
    }

    try {
      await alertOrganizerOfMessage({
        threadId,
        organizerId: String(thread.organizer_id || ''),
        eventId,
        eventTitle: String(thread.event_title || event?.title || 'Event'),
        senderName: authorName,
        topic: String(thread.topic || 'other'),
        message,
        followUp: true,
        event: event ? { country: event.country, city: event.city, timezone: event.timezone } : null,
      })
    } catch (error) {
      console.error('attendee follow-up: organizer alert failed', error)
    }

    return NextResponse.json({ ok: true, reply: result.reply })
  } catch (error) {
    console.error('attendee follow-up failed', error)
    return fail('Could not send your message. Try again.', 'internal_error', 500)
  }
}
