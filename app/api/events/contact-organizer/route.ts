/**
 * POST /api/events/contact-organizer
 *
 * Lets an attendee send the organizer of an event a short message about the
 * event, their ticket, or something else. The message lands in Firestore as
 * `organizer_messages` and pings the organizer through the existing
 * notification pipeline.
 *
 * Deliberately NOT an email relay: the attendee's address is never handed to
 * the organizer's mail client, and the organizer's address is never exposed to
 * the attendee. Both sides stay inside the app until the organizer chooses to
 * reply.
 */
import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { alertOrganizerOfMessage } from '@/lib/organizer-message-alerts'
import { FieldValue } from 'firebase-admin/firestore'

/** The three things an attendee can be writing about. Anything else is rejected. */
const TOPICS = ['event', 'ticket', 'other'] as const
type Topic = (typeof TOPICS)[number]

const MAX_MESSAGE_LENGTH = 1000
/** Messages one user may send about ONE event per hour. */
const MAX_PER_EVENT_PER_HOUR = 3

function fail(error: string, code: string, status = 400) {
  return NextResponse.json({ error, code }, { status })
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return fail('You must be signed in to contact an organizer.', 'unauthorized', 401)
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return fail('Malformed request body.', 'bad_request')
    }

    const eventId = typeof body?.eventId === 'string' ? body.eventId.trim() : ''
    const topic = String(body?.topic || '') as Topic
    const message = typeof body?.message === 'string' ? body.message.trim() : ''

    if (!eventId) return fail('Event is required.', 'missing_event_id')
    if (!TOPICS.includes(topic)) return fail('Pick what your message is about.', 'invalid_topic')
    if (!message) return fail('Write a message before sending.', 'missing_message')
    if (message.length > MAX_MESSAGE_LENGTH) {
      return fail(`Keep it under ${MAX_MESSAGE_LENGTH} characters.`, 'message_too_long')
    }

    const eventSnap = await adminDb.collection('events').doc(eventId).get()
    if (!eventSnap.exists) return fail('Event not found.', 'event_not_found', 404)

    const event = eventSnap.data() || {}

    // Drafts and rejected events are not public, so a message about one can only
    // have arrived by guessing the document id. Treat them as not found rather
    // than confirming the id exists.
    if (event.is_published === false || event.rejected === true) {
      return fail('Event not found.', 'event_not_found', 404)
    }

    const organizerId = String(event.organizer_id || '')
    if (!organizerId) {
      return fail('This event has no organizer to contact.', 'no_organizer', 409)
    }
    // Writing to yourself is a no-op that would just spam your own inbox.
    if (organizerId === user.id) {
      return fail('You are the organizer of this event.', 'self_contact', 409)
    }

    // Throttle per user PER EVENT rather than globally: someone with tickets to
    // five events has a legitimate reason to message five organizers in a row,
    // but no reason to send the same organizer four messages in an hour.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const recent = await adminDb
      .collection('organizer_messages')
      .where('sender_id', '==', user.id)
      .where('event_id', '==', eventId)
      .where('created_at', '>=', oneHourAgo)
      .limit(MAX_PER_EVENT_PER_HOUR)
      .get()

    if (recent.size >= MAX_PER_EVENT_PER_HOUR) {
      return fail(
        'You have sent this organizer several messages already. Give them a little time to reply.',
        'rate_limited',
        429
      )
    }

    const senderName = String((user as any).full_name || '').trim() || 'An attendee'
    const eventTitle = String(event.title || 'Event')
    const doc = await adminDb.collection('organizer_messages').add({
      event_id: eventId,
      event_title: eventTitle,
      organizer_id: organizerId,
      sender_id: user.id,
      // Snapshotted so the organizer still sees who wrote if the profile changes.
      sender_name: senderName,
      // The sender's EMAIL is deliberately absent. The organizer can read this
      // document (see firestore.rules), so storing the address here would hand
      // it over — exactly what routing this through the app instead of a
      // mailto: link is meant to avoid. A future reply flow can resolve the
      // address server-side from sender_id without ever exposing it.
      topic,
      message,
      status: 'open',
      created_at: FieldValue.serverTimestamp(),
      // Thread bookkeeping, seeded so every document carries the same shape and
      // the organizer's inbox never has to guess. Replies live in the `replies`
      // subcollection of this document — see lib/organizer-messages.ts.
      reply_count: 0,
      // The opener is the attendee's first message in a row (see
      // MAX_ATTENDEE_STREAK) and the thread's latest message.
      attendee_streak: 1,
      last_message_preview: message.replace(/\s+/g, ' ').trim().slice(0, 160),
      last_message_role: 'attendee',
      last_message_at: FieldValue.serverTimestamp(),
      last_activity_at: FieldValue.serverTimestamp(),
    })

    // In-app + push + (rate-limited) email, in the organizer's language. Each
    // channel is guarded inside; a failure must not lose the stored message.
    try {
      await alertOrganizerOfMessage({
        threadId: doc.id,
        organizerId,
        eventId,
        eventTitle,
        senderName,
        topic,
        message,
        followUp: false,
        event: { country: event.country, city: event.city, timezone: event.timezone },
      })
    } catch (error) {
      console.error('contact-organizer: organizer alert failed', error)
    }

    return NextResponse.json({ ok: true, id: doc.id })
  } catch (error) {
    console.error('contact-organizer failed', error)
    return fail('Could not send your message. Try again.', 'internal_error', 500)
  }
}
