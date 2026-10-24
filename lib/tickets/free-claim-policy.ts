/**
 * The limits on FREE tickets, wherever they are issued.
 *
 * /api/tickets/claim-free issues free tiers on their own. A multi-tier CARD
 * order can carry free lines too (Free RSVP x2 + GA x2), and those must not be a
 * way around the free-claim rules — otherwise any buyer could attach free
 * tickets to a cheap paid one, over and over. So both paths share these:
 *
 *  - at most MAX_FREE_TICKETS_PER_CLAIM free tickets in one order;
 *  - ONE free claim per buyer per event: an account by uid, a guest by email.
 *    A buyer who already holds a live free ticket, or whose claim lock is still
 *    held, gets no more;
 *  - the claim is held by the same `free_claim_locks/{event}__{buyer}` doc, so a
 *    card order's free tickets count as the buyer's claim on the free-claim
 *    route and vice versa.
 *
 * Inventory, the sales window, the tier being active and the access code are
 * enforced on every line by the checkout routes themselves.
 */

import crypto from 'crypto'
import { adminDb } from '@/lib/firebase/admin'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { MAX_FREE_TICKETS_PER_PERSON } from '@/lib/ticketPricing'

/** Hard cap on how many free tickets one claim (or one order) may issue, across all tiers. */
export const MAX_FREE_TICKETS_PER_CLAIM = MAX_FREE_TICKETS_PER_PERSON

export const FREE_CLAIM_LOCKS_COLLECTION = 'free_claim_locks'

/**
 * A legacy lock (no recorded ticket_ids) younger than this is a claim in flight:
 * the double tap the lock exists for.
 */
export const FREE_CLAIM_LOCK_IN_FLIGHT_MS = 2 * 60 * 1000

/**
 * A guest who has already claimed gets a NEUTRAL answer. The email they typed is
 * unverified, so echoing the earlier order's tickets (QR payloads, phone number)
 * would hand anyone who knows an address that person's tickets. The real owner
 * already has them in their inbox.
 */
export const GUEST_ALREADY_CLAIMED_MESSAGE =
  'You already claimed a ticket for this event. Check your email for your tickets.'

export interface FreeClaimant {
  isGuest: boolean
  id: string
  email?: string | null
}

/**
 * The once-per-event free-claim lock for this claimant.
 *
 * Deterministic, so of two concurrent claims by the same account (or the same
 * guest email) exactly one gets it. A guest is keyed on a HASH of their email,
 * so the lock doc never stores the address itself.
 */
export function freeClaimLockId(eventId: string, identity: FreeClaimant): string {
  if (identity.isGuest) {
    const email = String(identity.email || '').trim().toLowerCase()
    const digest = crypto.createHash('sha256').update(email).digest('hex').slice(0, 40)
    return `${eventId}__guest_${digest}`
  }
  return `${eventId}__${identity.id}`
}

/** The claimant's LIVE free tickets for this event (lib/tickets/status vocabulary). */
export function liveFreeTicketsFor(docs: any[], eventId: string): any[] {
  return docs
    .map((d: any) => ({ id: d.id, ...d.data() }))
    .filter((t: any) => t.event_id === eventId && Number(t.price_paid ?? 0) === 0 && isLiveTicketStatus(t.status))
}

/** Statuses that void a free ticket for good. Anything else (transferred, unknown) is not void. */
const VOIDED_FREE_TICKET_STATUSES = new Set(['refunded', 'cancelled', 'canceled', 'voided', 'void'])

/** True only for a ticket that was refunded / cancelled and never used at the door. */
export function isVoidedFreeTicket(t: any): boolean {
  if (t?.checked_in === true || t?.checked_in_at) return false
  const status = String(t?.status ?? '').toLowerCase().trim()
  if (isLiveTicketStatus(status)) return false
  return VOIDED_FREE_TICKET_STATUSES.has(status)
}

export function isAlreadyExists(err: any): boolean {
  return err?.code === 6 || /ALREADY_EXISTS|already exists/i.test(String(err?.message || ''))
}

/**
 * Has this claimant already used their free claim for this event? READ-ONLY —
 * the card route asks it before taking money; nothing is reserved here.
 *
 * Mirrors the free-claim route's decision: a live free ticket (an account's; for
 * a guest, ANY earlier free ticket under their email) holds the claim, and so does
 * a lock whose recorded tickets are not all provably void. A lock with nothing
 * recorded is treated as held — it cannot be shown to be void.
 */
export async function freeClaimAlreadyUsed(eventId: string, identity: FreeClaimant): Promise<boolean> {
  const ticketsSnap = identity.isGuest
    ? await adminDb.collection('tickets').where('guest_email', '==', String(identity.email || '')).get()
    : await adminDb.collection('tickets').where('attendee_id', '==', identity.id).get()
  const existing = identity.isGuest
    ? (ticketsSnap?.docs || [])
        .map((d: any) => d.data() || {})
        .filter((t: any) => t.event_id === eventId && Number(t.price_paid ?? 0) === 0)
    : liveFreeTicketsFor(ticketsSnap?.docs || [], eventId)
  if (existing.length > 0) return true

  const lockSnap = await adminDb.collection(FREE_CLAIM_LOCKS_COLLECTION).doc(freeClaimLockId(eventId, identity)).get()
  if (!lockSnap?.exists) return false
  const lock = lockSnap.data() || {}
  const ids: string[] = Array.isArray(lock.ticket_ids) ? lock.ticket_ids.map(String).filter(Boolean) : []
  if (ids.length === 0) return true
  const snaps = await Promise.all(ids.map((id) => adminDb.collection('tickets').doc(id).get()))
  if (snaps.some((s: any) => !s?.exists)) return true
  return !snaps.every((s: any) => isVoidedFreeTicket(s.data() || {}))
}

export type FreeLinesRefusal = {
  status: 400 | 409
  error: string
  code: 'free_limit_exceeded' | 'already_claimed'
}

/** Free tickets in an order: lines whose LIST price (before any promo) is 0. */
export function freeQuantityOf(lines: Array<{ listPrice: number; quantity: number }>): number {
  return lines.reduce((sum, l) => sum + (Number(l.listPrice) > 0 ? 0 : Number(l.quantity) || 0), 0)
}

/** The pure half of the order-time check: more than MAX_FREE_TICKETS_PER_CLAIM free tickets. */
export function freeLimitRefusal(freeQuantity: number): FreeLinesRefusal | null {
  if (freeQuantity <= MAX_FREE_TICKETS_PER_CLAIM) return null
  return {
    status: 400,
    error: `You can add at most ${MAX_FREE_TICKETS_PER_CLAIM} free tickets to an order.`,
    code: 'free_limit_exceeded',
  }
}

/**
 * The order-time check every paid rail (card, MonCash, SogePay) runs on the free
 * lines of a cart, before any money moves. READ-ONLY: refuses more than
 * MAX_FREE_TICKETS_PER_CLAIM free tickets (400 free_limit_exceeded) and a buyer
 * whose free claim for the event is already used (409 already_claimed; a guest
 * gets the neutral GUEST_ALREADY_CLAIMED_MESSAGE). Null when the order may proceed.
 * Fulfillment re-takes the claim lock atomically before issuing.
 */
export async function freeLinesRefusal(
  eventId: string,
  identity: FreeClaimant,
  lines: Array<{ listPrice: number; quantity: number }>
): Promise<FreeLinesRefusal | null> {
  const freeQuantity = freeQuantityOf(lines)
  if (freeQuantity <= 0) return null
  const overLimit = freeLimitRefusal(freeQuantity)
  if (overLimit) return overLimit
  if (await freeClaimAlreadyUsed(String(eventId), identity)) {
    return {
      status: 409,
      // A guest's answer stays neutral: the email they typed is unverified.
      error: identity.isGuest
        ? GUEST_ALREADY_CLAIMED_MESSAGE
        : 'You already have a free ticket for this event. Remove the free tier to continue.',
      code: 'already_claimed',
    }
  }
  return null
}

/**
 * Take (or confirm) the claimant's free-claim lock for a PAID card order, inside a
 * transaction. Returns true when this order holds the claim: the lock was free,
 * it already belongs to this payment (a retry), or it only records void tickets.
 * False means the claim belongs to someone else's order — the free lines are not
 * issued.
 */
export async function takeFreeClaimForOrder(
  eventId: string,
  identity: FreeClaimant,
  paymentId: string,
  /** Which rail's order holds the claim, for support ('card_order', 'moncash_order', …). */
  source: string = 'card_order'
): Promise<boolean> {
  const lockRef = adminDb.collection(FREE_CLAIM_LOCKS_COLLECTION).doc(freeClaimLockId(eventId, identity))
  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(lockRef)
    const lock = snap?.exists ? snap.data() || {} : null
    if (lock && lock.payment_id !== paymentId) {
      const ids: string[] = Array.isArray(lock.ticket_ids) ? lock.ticket_ids.map(String).filter(Boolean) : []
      if (ids.length === 0) return false
      const tickets = await Promise.all(ids.map((id) => tx.get(adminDb.collection('tickets').doc(id))))
      if (tickets.some((s: any) => !s?.exists)) return false
      if (!tickets.every((s: any) => isVoidedFreeTicket(s.data() || {}))) return false
    }
    if (!lock || lock.payment_id !== paymentId) {
      tx.set(lockRef, {
        event_id: String(eventId),
        kind: identity.isGuest ? 'guest' : 'account',
        source,
        payment_id: paymentId,
        created_at: new Date().toISOString(),
      })
    }
    return true
  })
}

/** Record which tickets an order's free claim issued, so the claim can be shown void later. */
export async function recordFreeClaimTickets(eventId: string, identity: FreeClaimant, ticketIds: string[]) {
  await adminDb
    .collection(FREE_CLAIM_LOCKS_COLLECTION)
    .doc(freeClaimLockId(eventId, identity))
    .set({ ticket_ids: ticketIds, updated_at: new Date().toISOString() }, { merge: true })
}

/**
 * Give back a claim this order took but never used: the order was refunded
 * before any ticket was issued (sold out after payment). Only a lock that
 * belongs to THIS payment and records no tickets is removed, so a claim that
 * issued tickets, or someone else's, is never touched. Without this the buyer
 * could never claim the free tier for the event again.
 */
export async function releaseUnusedFreeClaimForOrder(eventId: string, identity: FreeClaimant, paymentId: string) {
  const lockRef = adminDb.collection(FREE_CLAIM_LOCKS_COLLECTION).doc(freeClaimLockId(eventId, identity))
  await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(lockRef)
    const lock = snap?.exists ? snap.data() || {} : null
    if (!lock || lock.payment_id !== paymentId) return
    const ids = Array.isArray(lock.ticket_ids) ? lock.ticket_ids.filter(Boolean) : []
    if (ids.length > 0) return
    tx.delete(lockRef)
  })
}
