// Shared ticket-inventory helpers used by every payment fulfillment path
// (MonCash Button, Stripe Checkout, Stripe PaymentIntents, and future providers).
//
// Keeping the sold-count logic in one place ensures inventory is incremented
// consistently no matter which gateway settles the payment.

import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

export interface TierSoldIncrement {
  tierId: string
  quantity: number
}

/**
 * Normalize raw tier selections into per-tier sold-quantity increments.
 *
 * Rules:
 *  - Entries without a `tierId` (base-price / "General Admission" purchases) are ignored
 *    — those tickets only count toward the event-level `tickets_sold`.
 *  - Non-positive, non-finite, or missing quantities are ignored.
 *  - Duplicate `tierId`s are merged so a tier listed twice in one order is counted once.
 *
 * Pure and side-effect free so it can be unit tested without Firestore.
 */
export function buildTierSoldIncrements(
  selections:
    | Array<{ tierId?: string | null; quantity?: number | null }>
    | null
    | undefined
): TierSoldIncrement[] {
  const merged = new Map<string, number>()

  if (Array.isArray(selections)) {
    for (const selection of selections) {
      const tierId = selection?.tierId
      const qty = Number(selection?.quantity ?? 0)
      if (!tierId || !Number.isFinite(qty) || qty <= 0) continue
      merged.set(String(tierId), (merged.get(String(tierId)) || 0) + qty)
    }
  }

  return Array.from(merged.entries()).map(([tierId, quantity]) => ({ tierId, quantity }))
}

/**
 * Atomically increment an event's `tickets_sold` and each selected tier's `sold_quantity`.
 *
 * Uses `FieldValue.increment` so concurrent fulfillments (or webhook redeliveries) can't
 * clobber each other the way a read-modify-write would. Counter failures are logged rather
 * than thrown, so a transient Firestore hiccup never blocks an already-paid ticket from
 * being issued.
 *
 * IMPORTANT: callers MUST ensure this runs once per paid order (e.g. behind an idempotency
 * claim, or a verified + de-duplicated webhook) to avoid over-counting inventory.
 */
export async function applySoldCountIncrements(params: {
  eventId: string
  quantity: number
  tierIncrements: TierSoldIncrement[]
  /** Prefix for warning logs, e.g. "[moncash_button]" or "[stripe]". */
  logPrefix?: string
}): Promise<void> {
  const { eventId, quantity, tierIncrements } = params
  const logPrefix = params.logPrefix || '[inventory]'

  if (eventId && Number.isFinite(quantity) && quantity > 0) {
    try {
      await adminDb
        .collection('events')
        .doc(String(eventId))
        .set({ tickets_sold: FieldValue.increment(quantity) }, { merge: true })
    } catch (e) {
      console.warn(`${logPrefix} failed to increment event tickets_sold`, {
        eventId,
        message: (e as any)?.message,
      })
    }
  }

  for (const inc of tierIncrements) {
    if (!inc?.tierId || !(inc.quantity > 0)) continue
    try {
      await adminDb
        .collection('ticket_tiers')
        .doc(String(inc.tierId))
        .set(
          { sold_quantity: FieldValue.increment(inc.quantity), updated_at: new Date().toISOString() },
          { merge: true }
        )
    } catch (e) {
      console.warn(`${logPrefix} failed to increment tier sold_quantity`, {
        tierId: inc.tierId,
        message: (e as any)?.message,
      })
    }
  }
}

export interface InventoryReservationResult {
  /** Whether inventory was successfully reserved (and incremented). */
  ok: boolean
  /**
   * Why a reservation was refused (only set when ok === false), or 'error' on a fail-open.
   *  - invalid_quantity: a fractional / non-integer seat count (never reserved, never issued)
   *  - tier_mismatch:    a tier that belongs to a DIFFERENT event than the order
   */
  reason?: 'event_capacity' | 'tier_capacity' | 'invalid_quantity' | 'tier_mismatch' | 'error'
  /** The tier that was sold out (only for reason === 'tier_capacity'). */
  tierId?: string | null
  /** How many were still available for the blocking resource. */
  remaining?: number
  /** How many were requested for the blocking resource. */
  requested?: number
}

/**
 * Atomically reserve inventory for a paid order: within ONE Firestore transaction, re-read the
 * event capacity and each selected tier's capacity, refuse if the order would exceed either, and
 * otherwise increment `events.tickets_sold` and each `ticket_tiers.sold_quantity`.
 *
 * Why this exists: the per-route initiate checks read capacity, then the user pays (seconds to
 * minutes pass at the gateway), then we fulfill. Under load (e.g. 1000 concurrent buyers near
 * sold-out) many requests pass the same stale read and oversell. Doing the check-and-increment
 * inside a transaction makes it the single authoritative gate — Firestore serializes concurrent
 * transactions on the same document, so the (N+1)th seat is refused instead of oversold.
 *
 * Capacity sources (0 / missing ⇒ unlimited):
 *   - event:  max_tickets ?? capacity ?? total_tickets
 *   - tier:   total_quantity ?? quantity
 *
 * MUST be called once per paid order (behind the fulfillment claim) and BEFORE issuing tickets.
 * If it returns ok:false the caller must NOT issue tickets (and should refund/flag the payment).
 *
 * Fails OPEN on a transient Firestore error: an already-paid order is never stranded by an
 * infra hiccup — we fall back to a best-effort non-atomic increment and return ok:true so the
 * ticket is still issued (and log for reconciliation).
 */
export async function reserveInventoryAtomic(params: {
  eventId: string
  quantity: number
  tierIncrements: TierSoldIncrement[]
  /** Set false to skip the event-level capacity check (e.g. capacity enforced only per tier). */
  enforceEventCapacity?: boolean
  logPrefix?: string
}): Promise<InventoryReservationResult> {
  const { eventId, quantity, tierIncrements } = params
  const enforceEventCapacity = params.enforceEventCapacity !== false
  const logPrefix = params.logPrefix || '[inventory]'

  const qty = Number(quantity)
  // Bad input: nothing sensible to reserve. Don't block a paid order.
  if (!eventId || !Number.isFinite(qty) || qty <= 0) {
    return { ok: true }
  }

  const validTierIncrements = (tierIncrements || []).filter((t) => t?.tierId && t.quantity > 0)

  // Seats are whole. A fractional count is how a 0.01-ticket order got a full ticket:
  // refuse it here too, so no fulfillment path can issue against it.
  if (!Number.isInteger(qty) || validTierIncrements.some((t) => !Number.isInteger(Number(t.quantity)))) {
    console.error(`${logPrefix} refusing to reserve a non-integer quantity`, { eventId, quantity: qty })
    return { ok: false, reason: 'invalid_quantity', requested: qty }
  }

  try {
    return await adminDb.runTransaction(async (tx: any) => {
      const eventRef = adminDb.collection('events').doc(String(eventId))
      const tierRefs = validTierIncrements.map((inc) => ({
        inc,
        ref: adminDb.collection('ticket_tiers').doc(String(inc.tierId)),
      }))

      // Firestore requires all reads before any writes in a transaction.
      const eventSnap = await tx.get(eventRef)
      const tierSnaps = await Promise.all(tierRefs.map((t) => tx.get(t.ref)))

      // Event-level capacity.
      if (enforceEventCapacity && eventSnap.exists) {
        const ev = eventSnap.data() || {}
        const capacity = Number(ev.max_tickets ?? ev.capacity ?? ev.total_tickets ?? 0)
        if (Number.isFinite(capacity) && capacity > 0) {
          const sold = Number(ev.tickets_sold || 0)
          if (sold + qty > capacity) {
            return {
              ok: false,
              reason: 'event_capacity',
              remaining: Math.max(0, capacity - sold),
              requested: qty,
            } as InventoryReservationResult
          }
        }
      }

      // Tier-level capacity.
      for (let i = 0; i < tierRefs.length; i++) {
        const snap = tierSnaps[i]
        const inc = tierRefs[i].inc
        if (!snap.exists) continue
        const tier = snap.data() || {}
        // A tier from ANOTHER event must never be sold (or counted) under this one.
        const tierEventId = tier.event_id ?? tier.eventId
        if (tierEventId != null && String(tierEventId) !== String(eventId)) {
          return {
            ok: false,
            reason: 'tier_mismatch',
            tierId: inc.tierId,
            requested: inc.quantity,
          } as InventoryReservationResult
        }
        const total = Number(tier.total_quantity ?? tier.quantity ?? 0)
        if (Number.isFinite(total) && total > 0) {
          const sold = Number(tier.sold_quantity || 0)
          if (sold + inc.quantity > total) {
            return {
              ok: false,
              reason: 'tier_capacity',
              tierId: inc.tierId,
              remaining: Math.max(0, total - sold),
              requested: inc.quantity,
            } as InventoryReservationResult
          }
        }
      }

      // All checks passed — commit the increments inside the same transaction.
      tx.set(
        eventRef,
        { tickets_sold: FieldValue.increment(qty), updated_at: new Date().toISOString() },
        { merge: true }
      )
      for (let i = 0; i < tierRefs.length; i++) {
        const t = tierRefs[i]
        // Never conjure a tier doc that does not exist (a merge-set would create one
        // holding only a sold counter).
        if (!tierSnaps[i].exists) continue
        tx.set(
          t.ref,
          { sold_quantity: FieldValue.increment(t.inc.quantity), updated_at: new Date().toISOString() },
          { merge: true }
        )
      }
      return { ok: true } as InventoryReservationResult
    })
  } catch (e) {
    // Fail OPEN: never strand an already-paid order on a transient Firestore error. Move the
    // counters best-effort (non-atomic) so totals don't drift, and let fulfillment proceed.
    console.error(`${logPrefix} reserveInventoryAtomic failed; falling back to non-atomic increment`, {
      eventId,
      message: (e as any)?.message,
    })
    await applySoldCountIncrements({ eventId, quantity: qty, tierIncrements: validTierIncrements, logPrefix })
    return { ok: true, reason: 'error' }
  }
}

/**
 * Release a previously-reserved inventory increment (best-effort decrement). Used when ticket
 * creation fails AFTER a successful reserveInventoryAtomic, so reserved-but-unissued seats are
 * returned to inventory instead of leaking capacity.
 */
export async function releaseInventoryReservation(params: {
  eventId: string
  quantity: number
  tierIncrements: TierSoldIncrement[]
  logPrefix?: string
}): Promise<void> {
  const { eventId, tierIncrements } = params
  const qty = Number(params.quantity)
  const logPrefix = params.logPrefix || '[inventory]'

  if (eventId && Number.isFinite(qty) && qty > 0) {
    try {
      await adminDb
        .collection('events')
        .doc(String(eventId))
        .set({ tickets_sold: FieldValue.increment(-qty), updated_at: new Date().toISOString() }, { merge: true })
    } catch (e) {
      console.warn(`${logPrefix} failed to release event tickets_sold`, {
        eventId,
        message: (e as any)?.message,
      })
    }
  }

  for (const inc of tierIncrements || []) {
    if (!inc?.tierId || !(inc.quantity > 0)) continue
    try {
      await adminDb
        .collection('ticket_tiers')
        .doc(String(inc.tierId))
        .set(
          { sold_quantity: FieldValue.increment(-inc.quantity), updated_at: new Date().toISOString() },
          { merge: true }
        )
    } catch (e) {
      console.warn(`${logPrefix} failed to release tier sold_quantity`, {
        tierId: inc.tierId,
        message: (e as any)?.message,
      })
    }
  }
}
