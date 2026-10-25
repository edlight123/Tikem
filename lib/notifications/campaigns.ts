import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { decideSend, type NotificationCategory } from '@/lib/notifications/policy'
import type { NotificationType } from '@/types/database'
import { isFillingFast, milestoneReached } from '@/lib/notifications/thresholds'

export {
  isFillingFast,
  milestoneReached,
  FILLING_FAST_REMAINING_RATIO,
  FILLING_FAST_MIN_CAPACITY,
  ORGANIZER_MILESTONES,
} from '@/lib/notifications/thresholds'

/**
 * Discretionary notifications — the ones Tikèm sends because it wants attention,
 * not because the user transacted. Everything here goes through `decideSend`, so
 * quiet hours, per-category opt-outs and frequency caps are impossible to forget.
 */

const CAP_COLLECTION = 'notificationCaps'

const capId = (userId: string, capKey: string) => `${userId}__${capKey}`

/**
 * Has this exact thing already been said to this person?
 *
 * The cap is a document rather than a timestamp comparison because every cap
 * here is "once, ever, per user per event" — "filling fast" for the same event
 * is not more true the second time.
 */
async function alreadySent(userId: string, capKey: string): Promise<boolean> {
  try {
    const snap = await adminDb.collection(CAP_COLLECTION).doc(capId(userId, capKey)).get()
    return snap.exists
  } catch (error) {
    // Fail closed: an unreadable cap must not become a licence to re-send.
    console.error('[campaigns] cap lookup failed', capKey, error)
    return true
  }
}

async function recordSent(userId: string, capKey: string): Promise<void> {
  try {
    await adminDb
      .collection(CAP_COLLECTION)
      .doc(capId(userId, capKey))
      .set({ userId, capKey, sentAt: FieldValue.serverTimestamp() })
  } catch (error) {
    console.error('[campaigns] could not record cap', capKey, error)
  }
}

export interface DiscretionarySend {
  userId: string
  category: NotificationCategory
  /** Unique per thing-being-said, e.g. `filling_fast:<eventId>`. */
  capKey: string
  type: NotificationType
  title: string
  body: string
  url: string
  data?: Record<string, any>
}

/**
 * Send one discretionary notification, or decline with a reason.
 *
 * Returns whether it went out, so callers can report honest counts instead of
 * assuming everything they queued was delivered.
 */
export async function sendDiscretionary(send: DiscretionarySend): Promise<boolean> {
  const { userId, category, capKey, type, title, body, url, data } = send

  let user: Record<string, any> | null = null
  try {
    const snap = await adminDb.collection('users').doc(userId).get()
    user = snap.exists ? (snap.data() as Record<string, any>) : null
  } catch (error) {
    console.error('[campaigns] could not load user', userId, error)
    return false
  }

  const decision = decideSend({
    user,
    category,
    sentRecently: await alreadySent(userId, capKey),
  })
  if (!decision.send) return false

  // Record the cap BEFORE sending. A duplicate push is worse than a missed one:
  // the failure mode of recording after would be a retry storm re-notifying the
  // same people.
  await recordSent(userId, capKey)

  try {
    await createNotification(userId, type, title, body, url, data)
    await sendPushNotification(userId, title, body, url, { type, ...data })
    return true
  } catch (error) {
    console.error('[campaigns] send failed', capKey, error)
    return false
  }
}

/**
 * Collection the save (heart) buttons write: web /api/favorites/toggle and the
 * mobile Discover/EventDetail screens. This used to read `favorites`, which
 * nothing writes, so "filling fast" reached nobody.
 */
export const FAVORITES_COLLECTION = 'event_favorites'

/** Everyone who saved (favorited) an event. */
export async function favoritedBy(eventId: string): Promise<string[]> {
  try {
    const snap = await adminDb.collection(FAVORITES_COLLECTION).where('event_id', '==', eventId).get()
    const ids = snap.docs
      .map((d: any) => d.data()?.user_id)
      .filter((id: any): id is string => typeof id === 'string' && id.length > 0)
    return Array.from(new Set(ids))
  } catch (error) {
    console.error('[campaigns] could not read favorites for', eventId, error)
    return []
  }
}

/**
 * Tell people who favorited an event that it is nearly gone.
 *
 * Buyers are excluded by the cap in practice — someone who already holds a
 * ticket has no use for urgency about getting one — so callers pass the ids to
 * skip.
 */
export async function notifyFillingFast(params: {
  eventId: string
  eventTitle: string
  totalTickets: number
  ticketsSold: number
  skipUserIds?: string[]
}): Promise<number> {
  const { eventId, eventTitle, totalTickets, ticketsSold, skipUserIds = [] } = params
  if (!isFillingFast(totalTickets, ticketsSold)) return 0

  const skip = new Set(skipUserIds)
  const audience = (await favoritedBy(eventId)).filter((id) => !skip.has(id))
  if (audience.length === 0) return 0

  const remaining = totalTickets - ticketsSold
  const results = await Promise.all(
    audience.map((userId) =>
      sendDiscretionary({
        userId,
        category: 'filling_fast',
        capKey: `filling_fast:${eventId}`,
        type: 'event_filling_fast',
        title: `Almost gone: ${eventTitle}`,
        body: `Only ${remaining} ticket${remaining === 1 ? '' : 's'} left.`,
        url: `/events/${eventId}`,
        data: { eventId, remaining },
      })
    )
  )
  return results.filter(Boolean).length
}

/**
 * Everything that should be reconsidered the moment a sale completes.
 *
 * One entry point so the fulfillment path — which is shared by Stripe, MonCash
 * and the free-claim route — gains these notifications without learning anything
 * about thresholds or audiences. Reads the event fresh rather than trusting
 * counts passed down a long call chain.
 *
 * Never throws: a notification must not be able to fail a completed purchase.
 */
export async function onSaleCompleted(params: {
  eventId: string
  buyerId?: string | null
}): Promise<void> {
  const { eventId, buyerId } = params
  try {
    const snap = await adminDb.collection('events').doc(eventId).get()
    if (!snap.exists) return
    const event = snap.data() as Record<string, any>

    const totalTickets = Number(event?.total_tickets ?? 0)
    const ticketsSold = Number(event?.tickets_sold ?? 0)
    const eventTitle = String(event?.title || 'your event')
    const organizerId = String(event?.organizer_id || '')

    await Promise.all([
      notifyFillingFast({
        eventId,
        eventTitle,
        totalTickets,
        ticketsSold,
        // The person who just bought has no use for "hurry, it's filling up".
        skipUserIds: buyerId ? [buyerId] : [],
      }),
      organizerId
        ? notifyOrganizerMilestone({
            organizerId,
            eventId,
            eventTitle,
            totalTickets,
            ticketsSold,
          })
        : Promise.resolve(false),
    ])
  } catch (error) {
    console.error('[campaigns] onSaleCompleted failed for', eventId, error)
  }
}

export async function notifyOrganizerMilestone(params: {
  organizerId: string
  eventId: string
  eventTitle: string
  totalTickets: number
  ticketsSold: number
}): Promise<boolean> {
  const { organizerId, eventId, eventTitle, totalTickets, ticketsSold } = params
  const milestone = milestoneReached(totalTickets, ticketsSold)
  if (milestone === null) return false

  const soldOut = milestone >= 1
  const pct = Math.round(milestone * 100)

  return sendDiscretionary({
    userId: organizerId,
    category: 'organizer_milestone',
    // Keyed by milestone as well as event, so 50% and sold-out are separate
    // messages rather than the second being swallowed by the first's cap.
    capKey: `milestone:${eventId}:${pct}`,
    type: 'organizer_milestone',
    title: soldOut ? `Sold out: ${eventTitle}` : `${pct}% sold: ${eventTitle}`,
    body: soldOut
      ? `All ${totalTickets} tickets are gone.`
      : `${ticketsSold} of ${totalTickets} tickets sold.`,
    url: `/organizer/events/${eventId}`,
    data: { eventId, milestone: pct, ticketsSold, totalTickets },
  })
}
