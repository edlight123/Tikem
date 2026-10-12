// Shared ticket-inventory helpers used by every payment fulfillment path
// (MonCash Button, Stripe Checkout, Stripe PaymentIntents, and future providers),
// the free-claim route and organizer comps.
//
// The capacity gate itself lives in lib/tickets/inventoryShards.ts (sharded
// counters + seat holds); this module is the stable facade the callers use.

import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { randomUUID } from 'node:crypto'
import {
  convertHeldSeats,
  releaseSeats,
  reserveSeats,
  type ReserveOutcome,
  type TierSoldIncrement,
} from '@/lib/tickets/inventoryShards'

export type { TierSoldIncrement } from '@/lib/tickets/inventoryShards'

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
 * LEGACY — no live path calls this any more. Sold counts now live in the
 * inventory shards and `tickets_sold` / `sold_quantity` are a rollup of them
 * (lib/tickets/inventoryShards.ts), so a direct increment here would be
 * overwritten by the next rollup.
 *
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

export type InventoryReservationResult = ReserveOutcome

/**
 * Atomically reserve seats as SOLD right now (free claims, organizer comps): one
 * transaction on one inventory shard checks the event and every tier capacity
 * and records the sale, so the (N+1)th seat is refused instead of oversold.
 *
 * Capacity sources (0 / missing ⇒ unlimited):
 *   - event:  max_tickets ?? capacity ?? total_tickets
 *   - tier:   total_quantity ?? quantity
 *
 * Returns `reservationId` on success — pass it to releaseInventoryReservation to
 * give the seats back. On ok:false nothing was reserved and the caller must NOT
 * issue tickets. Never fails open: sustained contention returns
 * `reason: 'busy'` (retryable), never an unchecked increment.
 */
export async function reserveInventoryAtomic(params: {
  eventId: string
  quantity: number
  tierIncrements: TierSoldIncrement[]
  /** Idempotency key; a fresh one is minted when omitted. */
  reservationId?: string
  logPrefix?: string
}): Promise<InventoryReservationResult> {
  return reserveSeats({
    eventId: params.eventId,
    quantity: params.quantity,
    tierIncrements: params.tierIncrements,
    mode: 'sold',
    reservationId: params.reservationId || `res_${randomUUID().replace(/-/g, '')}`,
    source: 'direct',
    logPrefix: params.logPrefix,
  })
}

/**
 * Fulfillment's oversell gate for a PAID order: convert the order's seat hold
 * into sold seats, or — for an order with no usable hold (it expired, or the
 * order predates seat holds) — reserve them fresh, atomically.
 *
 * Idempotent per `reservationId` (the hold id, or a key derived from the
 * payment for an order without one), so a webhook redelivery never counts the
 * order twice. ok:false with an event/tier capacity reason means truly sold
 * out (refund); `reason: 'busy'` means retry later — never issue on it.
 */
export async function convertSeatHold(params: {
  eventId: string
  quantity: number
  tierIncrements: TierSoldIncrement[]
  reservationId: string
  logPrefix?: string
}): Promise<InventoryReservationResult> {
  return convertHeldSeats({
    eventId: params.eventId,
    quantity: params.quantity,
    tierIncrements: params.tierIncrements,
    reservationId: params.reservationId,
    source: 'order',
    logPrefix: params.logPrefix,
  })
}

/**
 * Give back seats a reservation took (ticket creation failed after the seats
 * were reserved / converted). Pass the quantities to release only part of it
 * (tickets that were never issued); omit them to release all of it.
 * Idempotent and never throws; a failure is logged (it can only undersell).
 */
export async function releaseInventoryReservation(params: {
  reservationId: string | null | undefined
  eventId?: string
  quantity?: number
  tierIncrements?: TierSoldIncrement[]
  logPrefix?: string
}): Promise<void> {
  if (!params.reservationId) {
    console.warn(`${params.logPrefix || '[inventory]'} release requested without a reservation id; nothing released`, {
      eventId: params.eventId,
    })
    return
  }
  try {
    await releaseSeats({
      reservationId: params.reservationId,
      quantity: params.quantity,
      tierIncrements: params.tierIncrements,
      logPrefix: params.logPrefix,
    })
  } catch (e) {
    console.warn(`${params.logPrefix || '[inventory]'} failed to release inventory reservation`, {
      reservationId: params.reservationId,
      message: (e as any)?.message,
    })
  }
}
