import { adminDb } from '@/lib/firebase/admin'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { FAVORITES_COLLECTION, sendDiscretionary } from './campaigns'

/**
 * "An event you saved is coming up" reminders (daily cron,
 * /api/cron/favorite-reminders).
 *
 * This reached nobody for four separate reasons, all fixed here:
 *   1. it read `favorites`; saves are written to `event_favorites`;
 *   2. it compared `start_datetime` (an ISO STRING from the composer, a
 *      Timestamp from older writes) against a Date, and a Firestore range
 *      never crosses value types, so the composer's events never matched;
 *   3. it called `.toDate()` on that string, which throws;
 *   4. it counted only `valid` tickets as "already bought", so MonCash and
 *      SogePay buyers (`confirmed`) were nudged to buy what they already had.
 *
 * Dedupe: it also had none, so a daily cron over a 7-day window would have
 * re-sent the same reminder up to seven times. Each send now goes through
 * sendDiscretionary with a per-(user, event) cap key, so a person hears about
 * a given saved event once, and the send obeys the user's reminder switch and
 * quiet hours like every other discretionary notification.
 */

export const FAVORITE_REMINDER_WINDOW_DAYS = 7

export const favoriteReminderCapKey = (eventId: string) => `saved_event:${eventId}`

/** start_datetime as a Date, whichever shape it was stored in. */
export function eventStartDate(raw: unknown): Date | null {
  if (!raw) return null
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  if (typeof (raw as any)?.toDate === 'function') {
    const d = (raw as any).toDate()
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

async function upcomingPublishedEvents(now: Date, until: Date) {
  // Ask for both stored shapes and merge (see event-reminders for the same fix).
  const base = () => adminDb.collection('events').where('is_published', '==', true)
  const [asString, asTimestamp] = await Promise.all([
    base()
      .where('start_datetime', '>=', now.toISOString())
      .where('start_datetime', '<=', until.toISOString())
      .get()
      .catch((e: unknown) => {
        console.error('[favorite-reminders] string-date query failed', e)
        return null
      }),
    base()
      .where('start_datetime', '>=', now)
      .where('start_datetime', '<=', until)
      .get()
      .catch((e: unknown) => {
        console.error('[favorite-reminders] timestamp-date query failed', e)
        return null
      }),
  ])
  const byId = new Map<string, Record<string, any>>()
  for (const snap of [asString, asTimestamp]) {
    for (const d of snap?.docs || []) byId.set(d.id, { id: d.id, ...(d.data() as Record<string, any>) })
  }
  return Array.from(byId.values()).filter((e) => {
    const status = String(e.status || '').toLowerCase()
    return status !== 'cancelled' && status !== 'canceled' && e.rejected !== true
  })
}

/** Does this user already hold a live ticket for the event? */
async function holdsLiveTicket(eventId: string, userId: string): Promise<boolean> {
  try {
    const snap = await adminDb
      .collection('tickets')
      .where('event_id', '==', eventId)
      .where('attendee_id', '==', userId)
      .get()
    return snap.docs.some((d: any) => isLiveTicketStatus(d.data()?.status))
  } catch (error) {
    // Unknown: do not nudge someone to buy what they may already have.
    console.error('[favorite-reminders] ticket lookup failed', eventId, userId, error)
    return true
  }
}

export interface FavoriteReminderResult {
  eventsChecked: number
  remindersSent: number
}

export async function runFavoriteReminders(now: Date = new Date()): Promise<FavoriteReminderResult> {
  const until = new Date(now.getTime() + FAVORITE_REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const events = await upcomingPublishedEvents(now, until)
  let remindersSent = 0

  for (const event of events) {
    const eventId = String(event.id)
    const start = eventStartDate(event.start_datetime)
    if (!start) continue

    const favSnap = await adminDb.collection(FAVORITES_COLLECTION).where('event_id', '==', eventId).get()
    const userIds = Array.from(
      new Set<string>(
        favSnap.docs
          .map((d: any) => d.data()?.user_id)
          .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      )
    )

    const daysUntil = Math.max(1, Math.ceil((start.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
    const when = daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`
    const title = String(event.title || 'An event you saved')

    for (const userId of userIds) {
      if (await holdsLiveTicket(eventId, userId)) continue
      const sent = await sendDiscretionary({
        userId,
        category: 'saved_event',
        capKey: favoriteReminderCapKey(eventId),
        type: 'event_reminder_24h',
        title: `Coming up ${when}: ${title}`,
        body: `An event you saved is happening ${when}. Get your tickets before they're gone.`,
        url: `/events/${eventId}`,
        data: { eventId, daysUntil, kind: 'favorite_reminder' },
      })
      if (sent) remindersSent++
    }
  }

  return { eventsChecked: events.length, remindersSent }
}
