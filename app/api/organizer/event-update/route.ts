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

    // Write the event update.
    await adminDb.collection('event_updates').add({
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

    return NextResponse.json({ success: true, notified })
  } catch (err) {
    console.error('Error sending event update:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
