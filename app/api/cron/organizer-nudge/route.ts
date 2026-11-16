import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { sendDiscretionary } from '@/lib/notifications/campaigns'
import { resolveOrgRecipients } from '@/lib/notifications/orgRecipients'

export const dynamic = 'force-dynamic'

/**
 * Tell an organizer their event is not selling — while they can still act.
 *
 * The whole value is in the timing and the link. A warning on the morning of the
 * event is just bad news; three days out, with their promoter link attached, it
 * is something they can do something about. So this fires in a window before the
 * event, once, and always carries the action.
 */

const WINDOW_START_HOURS = 48
const WINDOW_END_HOURS = 96

/** Below this share sold, an event is worth mentioning. */
const SLOW_SALES_RATIO = 0.2

/** Events smaller than this are not worth nudging about. */
const MIN_CAPACITY = 20

/** Ceiling on one run's scan — see the note in city-discovery. */
const MAX_EVENTS_SCANNED = 2000

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const windowStart = new Date(now.getTime() + WINDOW_START_HOURS * 60 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + WINDOW_END_HOURS * 60 * 60 * 1000)

  try {
    const snap = await adminDb
      .collection('events')
      .where('is_published', '==', true)
      .limit(MAX_EVENTS_SCANNED)
      .get()

    let notified = 0
    let considered = 0

    for (const doc of snap.docs) {
      const event: any = { id: doc.id, ...(doc.data() || {}) }

      // Normalize the mixed ISO-string / Timestamp representation before comparing.
      const raw = event?.start_datetime
      const start = raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null
      if (!(start instanceof Date) || isNaN(start.getTime())) continue
      if (start < windowStart || start > windowEnd) continue

      const totalTickets = Number(event.total_tickets ?? 0)
      const ticketsSold = Number(event.tickets_sold ?? 0)
      const organizerId = String(event.organizer_id || '')
      if (!organizerId || totalTickets < MIN_CAPACITY) continue

      considered++
      if (ticketsSold / totalTickets >= SLOW_SALES_RATIO) continue

      const sold = ticketsSold
      // The owner plus admins and managers (orgRecipients, event_ops); each
      // passes sendDiscretionary on their own opt-out, quiet hours and cap.
      const recipients = await resolveOrgRecipients({ orgId: organizerId, kind: 'event_ops', eventId: event.id })
      for (const userId of recipients) {
        const sent = await sendDiscretionary({
          userId,
          category: 'organizer_nudge',
          capKey: `nudge:${event.id}`,
          type: 'organizer_nudge',
          title: `${event.title} needs a push`,
          body:
            sold === 0
              ? 'No tickets sold yet. Share your promoter link to get the word out.'
              : `Only ${sold} of ${totalTickets} tickets sold. Share your promoter link.`,
          url: `/organizer/events/${event.id}/promoters`,
          data: { eventId: event.id, ticketsSold: sold, totalTickets },
        })
        if (sent) notified++
      }
    }

    return NextResponse.json({
      ok: true,
      notified,
      considered,
      ...(snap.size >= MAX_EVENTS_SCANNED ? { truncated: true } : {}),
    })
  } catch (error: any) {
    console.error('[organizer-nudge] failed', error)
    return NextResponse.json({ error: error?.message || 'failed' }, { status: 500 })
  }
}
