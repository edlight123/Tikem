import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireAuth } from '@/lib/auth'
import { canOnEvent } from '@/lib/organizer/context'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Send an event update to ticket holders.
 *
 * Replaces the old client-side flow (SendEventUpdateScreen wrote the
 * event_updates doc AND fanned notifications into every attendee's feed
 * directly with the Firebase client SDK). Doing that client-side required the
 * notifications rule to allow cross-user writes — a spam/phishing hole (audit
 * M4). This route does the same work server-side (Admin SDK) after verifying
 * the caller may run the event (its org's owner, admin or manager), so the notifications create rule can be locked to
 * the feed owner.
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
    const message = typeof body?.message === 'string' ? body.message.trim() : ''

    if (!eventId || !title || !message) {
      return NextResponse.json({ error: 'eventId, title and message are required' }, { status: 400 })
    }

    // Verify the caller may run this event.
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    if (!eventDoc.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    const eventData = eventDoc.data()!
    if (!(await canOnEvent(user, eventData, 'manage_events')).allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Write the event update (recipients is filled in once the fan-out is done,
    // for the Sent list on the organizer's Messages page).
    const updateRef = await adminDb.collection('event_updates').add({
      event_id: eventId,
      title,
      message,
      created_at: new Date(),
      created_by: user.id,
    })

    // Collect distinct attendees with a live ticket for this event.
    const ticketsSnapshot = await adminDb
      .collection('tickets')
      .where('event_id', '==', eventId)
      .where('status', 'in', ['active', 'valid', 'checked_in', 'confirmed'])
      .get()

    const attendeeIds = new Set<string>()
    ticketsSnapshot.docs.forEach((d: any) => {
      const aid = d.data()?.attendee_id || d.data()?.user_id
      if (aid && aid !== user.id) attendeeIds.add(aid)
    })

    const eventTitle = eventData.title || 'your event'
    const actionUrl = `/events/${eventId}`

    // Fan out in-app + push notifications. A single attendee's failure must not
    // abort the whole send, so failures are swallowed per-recipient.
    const results = await Promise.allSettled(
      Array.from(attendeeIds).map(async (attendeeId) => {
        await createNotification(
          attendeeId,
          'event_updated',
          `Update: ${eventTitle}`,
          title,
          actionUrl,
          { eventId }
        )
        await sendPushNotification(attendeeId, `📣 ${eventTitle}`, title, actionUrl, {
          type: 'event_update',
          eventId,
        }).catch(() => {})
      })
    )

    const notified = results.filter((r) => r.status === 'fulfilled').length
    await updateRef.update({ recipients: notified }).catch(() => {})

    return NextResponse.json({ success: true, notified })
  } catch (err) {
    console.error('Error sending event update:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const AUTOMATIC = [
  { type: 'event_reminder_24h', offsetMs: -24 * 3600_000 },
  { type: 'event_reminder_3h', offsetMs: -3 * 3600_000 },
  { type: 'event_reminder_30min', offsetMs: -30 * 60_000 },
  // The morning after (lib/postEvent/timing): no exact instant, the app labels it.
  { type: 'post_event_followup', offsetMs: null },
] as const

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

    // Equality filter only (no composite index); sorted here.
    const [updatesSnap, claimSnaps] = await Promise.all([
      adminDb.collection('event_updates').where('event_id', '==', eventId).limit(100).get(),
      Promise.all(
        AUTOMATIC.map((a) => adminDb.collection('reminderClaims').doc(`${eventId}__${a.type}`).get())
      ),
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
    const startMs = startIso ? new Date(startIso).getTime() : NaN
    const automatic = AUTOMATIC.map((a, i) => {
      const claim = claimSnaps[i]
      return {
        type: a.type,
        at: a.offsetMs !== null && Number.isFinite(startMs) ? new Date(startMs + a.offsetMs).toISOString() : null,
        sentAt: claim.exists ? iso(claim.data()?.claimedAt) || 'sent' : null,
      }
    })

    return NextResponse.json({ updates, automatic, eventStart: startIso, eventEnd: iso(eventData.end_datetime) })
  } catch (err) {
    console.error('Error listing event updates:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
