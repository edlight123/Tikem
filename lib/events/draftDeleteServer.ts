import { adminDb } from '@/lib/firebase/admin'
import { PHYSICAL_BATCHES } from '@/lib/physical/rules'
import { DOOR_TEAM_REQUESTS } from '@/lib/doorTeam/rules'
import { WAITLIST_COLLECTION } from '@/lib/waitlist'
import { ATTEND_REQUESTS_COLLECTION } from '@/lib/events/approval'
import { draftDeleteBlock, isDraftEvent, type DraftDeleteBlock, type DraftDeleteSignals } from '@/lib/events/draftDelete'

/**
 * Server half of "delete a draft that never sold" (lib/events/draftDelete has
 * the pure rules). Two jobs:
 *
 *  1. draftDeleteSignals: look EVERYWHERE an event leaves a trace of a sale or
 *     a person: tickets (both event-id spellings), the guest list, attend
 *     requests, the waitlist, printed batches, door-team requests, MonCash /
 *     SogePay orders, seat reservations (Stripe and every other rail holds a
 *     seat before paying), earnings, payout releases, withdrawals and promoter
 *     commissions. Any one of them keeps the event.
 *  2. deleteDraftEvent: remove the event and what it OWNS (tiers, promo codes,
 *     promoter links, tracking links, group discounts, updates, favourites,
 *     dead reservations, view stats, its subcollections).
 *
 * Storage files are NOT deleted. A poster is only a URL on the event doc, and
 * an organizer can point that URL at any file (another org's upload, a crafted
 * link that parses to it), so "delete the draft's poster" would let them
 * delete someone else's file. An orphaned image is small; a lost one is not.
 */

/** Order rows on the Haiti rails that never became anything. */
const DEAD_ORDER_STATUSES = new Set(['failed', 'cancelled', 'canceled', 'expired', 'abandoned'])

async function has(collection: string, field: string, eventId: string): Promise<number> {
  const snap = await adminDb.collection(collection).where(field, '==', eventId).limit(1).get()
  return snap.size || 0
}

async function hasEither(collection: string, eventId: string): Promise<number> {
  const [a, b] = await Promise.all([has(collection, 'event_id', eventId), has(collection, 'eventId', eventId)])
  return a + b
}

/** Everything outside the event doc that keeps a draft from being deleted. */
export async function draftDeleteSignals(eventId: string): Promise<DraftDeleteSignals> {
  const id = String(eventId)
  const eventRef = adminDb.collection('events').doc(id)
  const [
    tickets,
    tiers,
    guestList,
    attendRequests,
    waitlist,
    printedBatches,
    doorTeamRequests,
    pendingTx,
    reservations,
    earnings,
    earningsByDocId,
    payoutReleases,
    withdrawals,
    promoterSales,
  ] = await Promise.all([
    hasEither('tickets', id),
    adminDb.collection('ticket_tiers').where('event_id', '==', id).get(),
    eventRef.collection('guests').limit(1).get(),
    has(ATTEND_REQUESTS_COLLECTION, 'event_id', id),
    has(WAITLIST_COLLECTION, 'event_id', id),
    has(PHYSICAL_BATCHES, 'event_id', id),
    has(DOOR_TEAM_REQUESTS, 'event_id', id),
    adminDb.collection('pending_transactions').where('event_id', '==', id).limit(50).get(),
    adminDb.collection('inventory_reservations').where('event_id', '==', id).limit(200).get(),
    hasEither('event_earnings', id),
    adminDb.collection('event_earnings').doc(id).get(),
    has('payout_releases', 'eventId', id),
    has('withdrawal_requests', 'eventId', id),
    has('promoter_sales', 'event_id', id),
  ])

  const soldOnTiers = tiers.docs.reduce((s: number, d: any) => s + (Number(d.data()?.sold_quantity) || 0), 0)
  const liveOrders = pendingTx.docs.filter(
    (d: any) => !DEAD_ORDER_STATUSES.has(String(d.data()?.status || '').toLowerCase()),
  ).length
  const now = Date.now()
  let soldReservations = 0
  let holds = 0
  for (const d of reservations.docs) {
    const r = d.data() || {}
    if (r.state === 'sold') soldReservations++
    else if (r.state === 'held') {
      const exp = Number(r.hold_expires_at ?? r.expires_at)
      // A hold without a readable expiry is treated as live: the safe side.
      if (!Number.isFinite(exp) || exp > now) holds++
    }
  }

  return {
    tickets,
    soldOnTiers,
    guests: guestList.size + attendRequests + waitlist,
    printedBatches,
    doorTeamRequests,
    orders: liveOrders + soldReservations,
    holds,
    moneyRows: earnings + (earningsByDocId.exists ? 1 : 0) + payoutReleases + withdrawals + promoterSales,
  }
}

/** Full check for one event: null when it may be deleted. */
export async function draftDeleteCheck(
  eventId: string,
  event: Record<string, any> | null | undefined,
): Promise<DraftDeleteBlock | null> {
  // The event doc alone settles published / cancelled / frozen / sold counters,
  // without a dozen queries for every published event page.
  const quick = draftDeleteBlock(event)
  if (quick) return quick
  return draftDeleteBlock(event, await draftDeleteSignals(eventId))
}

/** Collections whose docs belong to one event (by event_id) and go with it. */
export const OWNED_BY_EVENT_ID = [
  'ticket_tiers',
  'promo_codes',
  'event_promoters',
  'tracking_links',
  'group_discounts',
  'event_updates',
  'event_favorites',
  // Only released / expired ones remain: a held or sold one blocked the delete.
  'inventory_reservations',
] as const

async function deleteWhere(collection: string, field: string, eventId: string): Promise<number> {
  const snap = await adminDb.collection(collection).where(field, '==', eventId).get()
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = adminDb.batch()
    for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref)
    await batch.commit()
  }
  return snap.docs.length
}

async function recursiveDelete(ref: any): Promise<void> {
  const fn = (adminDb as any).recursiveDelete
  if (typeof fn === 'function') await fn.call(adminDb, ref)
  else await ref.delete()
}

export type DeleteDraftResult =
  | { ok: true; removed: Record<string, number> }
  | { ok: false; code: DraftDeleteBlock }

/**
 * Delete a draft after draftDeleteCheck passed. The event doc goes first, in a
 * transaction that re-reads it, so a publish or a sale landing between the
 * check and here keeps the event (and everything it owns).
 */
export async function deleteDraftEvent(eventId: string): Promise<DeleteDraftResult> {
  const id = String(eventId)
  const ref = adminDb.collection('events').doc(id)

  const outcome = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const event = snap.exists ? snap.data() || {} : null
    const blocked = draftDeleteBlock(event)
    if (blocked) return { ok: false as const, code: blocked }
    if (!isDraftEvent(event)) return { ok: false as const, code: 'published' as const }
    tx.delete(ref)
    return { ok: true as const }
  })
  if (!outcome.ok) return outcome

  const removed: Record<string, number> = {}
  for (const collection of OWNED_BY_EVENT_ID) {
    removed[collection] = await deleteWhere(collection, 'event_id', id)
  }
  // Subcollections of the (now deleted) event doc: updates, private, members,
  // invites, access grants/attempts, inventory shards, an empty guest list.
  await recursiveDelete(ref)
  await recursiveDelete(adminDb.collection('event_view_stats').doc(id))

  return { ok: true, removed }
}
