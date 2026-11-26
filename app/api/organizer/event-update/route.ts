import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireAuth } from '@/lib/auth'
import { canOnEvent } from '@/lib/organizer/context'
import { consumeRateLimit } from '@/lib/rate-limit'
import { checkBroadcast, type BroadcastRefusal } from '@/lib/moderation/broadcast'
import { broadcastToAttendees } from '@/lib/events/attendee-broadcast'
import { reminderClaimKey, reminderFireAt, resolveEventReminders } from '@/lib/notifications/event-reminder-settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Messages one event may send per rolling day, and one sender across all events. */
const PER_EVENT_PER_DAY = 3
const PER_SENDER_PER_DAY = 10
const DAY_MS = 24 * 60 * 60 * 1000

const BROADCAST_REFUSAL_MESSAGES: Record<BroadcastRefusal, string> = {
  empty: 'Write a message first.',
  too_long: 'Keep the title under 120 characters and the message under 2,000.',
  too_many_links: 'Use at most 3 links, with a few words saying what they are.',
  insecure_link: 'Links must start with https://.',
  shortened_link: 'Use the full link, not a shortened one.',
  phishing: 'Tikra never sends messages that ask for passwords or payments outside Tikra. Remove that part and try again.',
  shouting: 'Please write in normal case rather than all capitals.',
}

/**
 * POST: an organizer's message to everyone holding a ticket or RSVP. The ONE
 * route for it, from the web dashboard (Attendees, "Message attendees") and the
 * app (SendEventUpdateScreen). The fan-out (email to everyone including guests,
 * in-app + push to account holders, each in their language and honouring their
 * "Messages from organizers" switch) is lib/events/attendee-broadcast.ts.
 *
 * Body: { eventId, message, title? }. The web's older shape
 * { eventId, updateMessage } is accepted too.
 *
 * Guards, in order: signed in; may run the event (owner, admin or manager);
 * the event is live; moderation (lib/moderation/broadcast.ts); 3 messages per
 * event and 10 per sender per day. Every message is kept in event_updates
 * (the Sent list, and the record for review).
 */
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const eventId = typeof body?.eventId === 'string' ? body.eventId.trim() : ''
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const rawMessage =
      (typeof body?.message === 'string' && body.message) ||
      (typeof body?.updateMessage === 'string' && body.updateMessage) ||
      ''
    const message = String(rawMessage).trim()

    if (!eventId || eventId.includes('/') || !message) {
      return NextResponse.json({ error: 'Write a message first.', code: 'empty' }, { status: 400 })
    }

    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    if (!eventDoc.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    const eventData = eventDoc.data()!
    if (!(await canOnEvent(user, eventData, 'manage_events')).allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const status = String(eventData.status || '').toLowerCase()
    const live =
      eventData.is_published === true &&
      status !== 'cancelled' &&
      eventData.hidden_pending_review !== true &&
      eventData.rejected !== true
    if (!live) {
      return NextResponse.json(
        { error: 'Only a live event can message its attendees.', code: 'event_not_live' },
        { status: 409 }
      )
    }

    const verdict = checkBroadcast({ title, message })
    if (!verdict.ok) {
      return NextResponse.json({ error: BROADCAST_REFUSAL_MESSAGES[verdict.code], code: verdict.code }, { status: 422 })
    }

    // The email subject and body, the in-app title and the push also carry the
    // event title and the organizer name, which no one moderated. Check them,
    // whole, as sent (attendee-broadcast.ts uses the same title and name).
    // 'shouting' is not applied: an all-caps event title is common and is
    // already shown publicly; every other refusal is.
    const organizerName = String((eventData as any).organizer_name || '').trim() || null
    const eventTitle = String(eventData.title || '').replace(/[\r\n]+/g, ' ').trim()
    const identity = [eventTitle, organizerName].filter(Boolean).join('\n')
    if (identity) {
      const idVerdict = checkBroadcast({ message: identity })
      if (!idVerdict.ok && idVerdict.code !== 'shouting') {
        return NextResponse.json(
          { error: BROADCAST_REFUSAL_MESSAGES[idVerdict.code], code: idVerdict.code },
          { status: 422 }
        )
      }
    }

    const perEvent = await consumeRateLimit({ key: `event-broadcast:${eventId}`, limit: PER_EVENT_PER_DAY, windowMs: DAY_MS })
    if (perEvent.limited) {
      return NextResponse.json(
        { error: 'This event has sent its messages for today. Try again tomorrow.', code: 'update_limit' },
        { status: 429 }
      )
    }
    const perSender = await consumeRateLimit({
      key: `event-broadcast-sender:${user.id}`,
      limit: PER_SENDER_PER_DAY,
      windowMs: DAY_MS,
    })
    if (perSender.limited) {
      return NextResponse.json(
        { error: 'You have sent the most messages allowed today. Try again tomorrow.', code: 'sender_limit' },
        { status: 429 }
      )
    }

    const updateRef = await adminDb.collection('event_updates').add({
      event_id: eventId,
      title: title || null,
      message,
      created_at: new Date(),
      created_by: user.id,
    })

    const outcome = await broadcastToAttendees({
      event: { ...(eventData as any), id: eventId },
      senderId: user.id,
      title: title || null,
      message,
      organizerName,
    })

    await updateRef.update({ ...outcome }).catch(() => {})

    return NextResponse.json({
      success: true,
      ...outcome,
      // The app reads `notified`; the web's sheet reads sent / failed.
      notified: outcome.recipients,
      sent: outcome.emailed,
      failed: outcome.emailFailed,
    })
  } catch (err) {
    console.error('Error sending event update:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** The morning after (lib/postEvent/timing): no exact instant, the app labels it. Not editable. */
const FOLLOWUP_TYPE = 'post_event_followup'

function iso(v: any): string | null {
  if (!v) return null
  const d = typeof v?.toDate === 'function' ? v.toDate() : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * GET ?eventId= : what this event's attendees have been sent, for the
 * organizer's Messages page. Updates sent from the app (newest first) and the
 * automatic messages Tikèm sends on its own, each with when it goes out and
 * whether it has (reminderClaims is written as each one is sent).
 */
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const eventId = (request.nextUrl.searchParams.get('eventId') || '').trim()
    if (!eventId || eventId.length > 200 || eventId.includes('/')) {
      return NextResponse.json({ error: 'eventId is required' }, { status: 400 })
    }
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    if (!eventDoc.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    const eventData = eventDoc.data()!
    if (!(await canOnEvent(user, eventData, 'manage_events')).allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // The event's own reminders (absent = the stock three), then the follow-up.
    const reminders = resolveEventReminders(eventData)
    const claimKeys = [...reminders.map(reminderClaimKey), FOLLOWUP_TYPE]

    // Equality filter only (no composite index); sorted here.
    const [updatesSnap, claimSnaps] = await Promise.all([
      adminDb.collection('event_updates').where('event_id', '==', eventId).limit(100).get(),
      Promise.all(claimKeys.map((key) => adminDb.collection('reminderClaims').doc(`${eventId}__${key}`).get())),
    ])

    const updates = updatesSnap.docs
      .map((d: any) => {
        const x = d.data() || {}
        return {
          id: d.id,
          title: String(x.title || ''),
          message: String(x.message || ''),
          createdAt: iso(x.created_at),
          recipients: typeof x.recipients === 'number' ? x.recipients : null,
        }
      })
      .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

    const startIso = iso(eventData.start_datetime)
    const sentAt = (i: number) => {
      const claim = claimSnaps[i]
      return claim.exists ? iso(claim.data()?.claimedAt) || 'sent' : null
    }
    // `type` stays the reminder id, so app builds from before reminders were
    // editable keep reading this list (they ignore the extra fields).
    const automatic = [
      ...reminders.map((r, i) => {
        const at = reminderFireAt(r, eventData)
        return {
          type: r.id,
          id: r.id,
          minutesBefore: r.minutes_before,
          enabled: r.enabled,
          message: r.message || null,
          editable: true,
          at: at ? at.toISOString() : null,
          sentAt: sentAt(i),
        }
      }),
      { type: FOLLOWUP_TYPE, id: FOLLOWUP_TYPE, editable: false, at: null, sentAt: sentAt(reminders.length) },
    ]

    return NextResponse.json({ updates, automatic, eventStart: startIso, eventEnd: iso(eventData.end_datetime) })
  } catch (err) {
    console.error('Error listing event updates:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
