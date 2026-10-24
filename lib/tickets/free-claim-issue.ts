/**
 * The core of FREE ticket issuance, shared by every path that hands out free
 * tickets on a claim:
 *
 *  - POST /api/tickets/claim-free (a guest or account claiming an RSVP);
 *  - the organizer approving a request on an approval-list event
 *    (app/api/organizer/events/[id]/requests, docs/specs/approval-lists-and-plus-ones.md).
 *
 * It was the body of the claim-free route, moved here verbatim so approval
 * cannot drift from it: tier resolution and the price gate, the one-claim lock
 * (lib/tickets/free-claim-policy), the atomic inventory reservation (shards;
 * tickets_sold is never written here), promo redemption, ticket creation,
 * attribution, delivery and notifications.
 *
 * The CALLER owns everything about who is asking: parsing the body, the
 * quantity cap, the event being purchasable, the claimant's identity, the
 * access-code gate, and resolving the promo / promoter / attribution.
 */

import { adminDb } from '@/lib/firebase/admin'
import { notifyTicketPurchase, notifyOrganizerTicketSale } from '@/lib/notifications/helpers'
import { FieldValue } from 'firebase-admin/firestore'
import {
  buildTierSoldIncrements,
  releaseInventoryReservation,
  reserveInventoryAtomic,
} from '@/lib/tickets/inventory'
import { calculateDiscount, promoBuyerKey, redeemPromoInTransaction, type PromoDoc } from '@/lib/promo-codes'
import { recordPromoterSale } from '@/lib/promoters'
import { ticketAttributionFields } from '@/lib/attribution'
import { recordAttributedSale } from '@/lib/tracking-links'
import { recordInvitePurchase } from '@/lib/invites/server'
import { computeSelectionTotal, toCents } from '@/lib/ticketPricing'
import { sendTicketConfirmation } from '@/lib/tickets/confirmation'
import type { CheckoutIdentity } from '@/lib/guest/checkout'
import { attachTicketsToGuestOrder } from '@/lib/guest/identity'
import type { TierLine } from '@/lib/tickets/purchasable'
import {
  FREE_CLAIM_LOCK_IN_FLIGHT_MS,
  GUEST_ALREADY_CLAIMED_MESSAGE,
  freeClaimLockId,
  isAlreadyExists,
  isVoidedFreeTicket,
  liveFreeTicketsFor,
} from '@/lib/tickets/free-claim-policy'
import type { PlusOne } from '@/lib/events/approval'

/** One validated line of a claim: which tier, how many, and what to name the tickets. */
export interface TierClaim {
  /** '' for a legacy event with no tier docs — those tickets carry no tier_id. */
  tierId: string
  tierName: string
  quantity: number
  /** The tier's OWN price, straight from Firestore (major units). Never client-supplied. */
  unitPrice: number
}

export type FreeClaimOutcome =
  | { ok: false; error: string; code: string; status: number }
  /** The claimant already holds live free tickets for this event (signed-in only). */
  | { ok: true; kind: 'existing'; tickets: any[] }
  | { ok: true; kind: 'issued'; tickets: any[]; claims: TierClaim[]; promoApplied: boolean }

export interface FreeClaimRequest {
  eventId: string
  /** The event doc, already loaded and already checked purchasable by the caller. */
  event: any
  identity: CheckoutIdentity
  /** Total tickets, already validated against MAX_FREE_TICKETS_PER_CLAIM. */
  ticketQuantity: number
  /** Multi-tier claim lines; empty for the single-tier shape. */
  selections?: TierLine[]
  /** Explicit tier for the single-tier shape. */
  tierId?: string | null
  promo?: PromoDoc | null
  promoter?: { id: string; code: string } | null
  attribution?: any
}

export interface FreeClaimOptions {
  /** Extra fields stamped on every issued ticket (e.g. approval_request_id). */
  ticketFields?: Record<string, any>
  /** Named plus-ones: ticket 1.. of the claim carries plus_one_name / plus_one_phone. */
  plusOnes?: PlusOne[]
  /** The buyer's "ticket purchased" in-app + push. Default on. */
  notifyBuyer?: boolean
  /** The organizer's "free ticket claimed" in-app + push. Default on. */
  notifyOrganizer?: boolean
  /** Head the confirmation email "Approved" (approval lists). */
  approved?: boolean
}

/**
 * Sale-window / active / sold-out gate for a tier, mirroring the paid initiate
 * routes so a FREE tier is held to exactly the same rules as a paid one.
 */
function tierIsOnSale(
  tier: any,
  now: Date
): { ok: true } | { ok: false; reason: string; code: string } {
  if (tier?.is_active === false) {
    return { ok: false, reason: 'This ticket tier is not available.', code: 'tier_inactive' }
  }

  const salesStart = tier?.sales_start ? new Date(tier.sales_start) : null
  const salesEnd = tier?.sales_end ? new Date(tier.sales_end) : null

  if (salesStart && !Number.isNaN(salesStart.getTime()) && salesStart > now) {
    return {
      ok: false,
      reason: 'Ticket sales for this tier have not started yet.',
      code: 'tier_not_started',
    }
  }
  if (salesEnd && !Number.isNaN(salesEnd.getTime()) && salesEnd < now) {
    return { ok: false, reason: 'Ticket sales for this tier have ended.', code: 'tier_sales_ended' }
  }

  // 0 / missing total ⇒ unlimited (matches reserveInventoryAtomic's convention).
  const total = Number(tier?.total_quantity ?? tier?.quantity ?? 0)
  if (Number.isFinite(total) && total > 0) {
    const sold = Number(tier?.sold_quantity || 0)
    if (total - sold <= 0) {
      return { ok: false, reason: 'This ticket tier is sold out.', code: 'tier_sold_out' }
    }
  }

  return { ok: true }
}

/** A tier/event price as stored in Firestore, coerced to a finite non-negative number. */
function storedPrice(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function fail(error: string, code: string, status = 400): FreeClaimOutcome {
  return { ok: false, error, code, status }
}

/** The fields that name a plus-one on ticket `index` of a claim (0 = the claimant's own). */
export function plusOneTicketFields(plusOnes: PlusOne[] | undefined, index: number): Record<string, any> {
  if (index < 1 || !plusOnes || !plusOnes[index - 1]) return {}
  const p = plusOnes[index - 1]
  return { plus_one_name: p.first_name, ...(p.phone ? { plus_one_phone: p.phone } : {}) }
}

export async function issueFreeClaim(
  req: FreeClaimRequest,
  options: FreeClaimOptions = {}
): Promise<FreeClaimOutcome> {
  const { eventId, event, identity, ticketQuantity } = req
  const requestedSelections = req.selections || []
  const useSelections = requestedSelections.length > 0
  const tierId = req.tierId || null
  const promo = req.promo || null
  const promoter = req.promoter || null
  const attribution = req.attribution ?? null
  const plusOneFieldsFor = (index: number) => plusOneTicketFields(options.plusOnes, index)

  /**
   * What the SERVER says one ticket of this tier costs after the promo.
   * The only pricing authority in this route — `calculateDiscount` is the exact
   * function both paid initiators use, so a code discounts identically here.
   */
  const chargedUnitPrice = (price: number): number =>
    promo ? calculateDiscount(price, promo).discountedPrice : price

  /** True when the server's own math makes this tier cost exactly nothing. */
  const zeroesToFree = (price: number): boolean => toCents(chargedUnitPrice(price)) === 0

  // Resolve WHICH tier is being claimed, and prove it is actually free.
  //
  // An event may offer a free tier alongside paid ones. `event.ticket_price` is
  // the LOWEST tier price, so it is 0 for such an event and cannot be used to
  // decide whether this claim is legitimate — that would let a buyer claim a
  // free ticket on any event whose cheapest tier happens to be 0. The tier's
  // OWN price is the authority, and it is held to the same sale-window /
  // is_active / sold-out gate as the paid routes.
  //
  // Both payload shapes end up as the same list of validated `TierClaim` lines.
  let claims: TierClaim[] = []

  let tierDocs: any[] = []
  try {
    const tiersSnap = await adminDb
      .collection('ticket_tiers')
      .where('event_id', '==', eventId)
      .get()
    tierDocs = tiersSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
  } catch (tierErr) {
    console.warn('[claim-free] failed to load tiers', { message: (tierErr as any)?.message })
  }

  if (useSelections) {
    // Multi-tier claim. EVERY line is held to exactly the same gate as the
    // single-tier path: belongs to this event, its OWN price is 0, is_active,
    // inside the sale window, and not sold out. One bad line fails the claim —
    // partial issuance would charge the buyer's per-event free allowance for an
    // order they didn't get.
    const now = new Date()
    for (const sel of requestedSelections) {
      const tier = tierDocs.find((t: any) => String(t.id) === sel.tierId)
      if (!tier) {
        return fail('Ticket tier not found for this event', 'tier_not_found', 404)
      }
      const price = storedPrice(tier.price)
      if (!zeroesToFree(price)) {
        // With a promo the buyer's expectation was "this is free", so name the
        // real reason: the promo does not fully cover this tier. Partial
        // discounts belong on the paid checkout path.
        return promo
          ? fail(
              'This promo code does not make these tickets free.',
              'promo_not_free',
              400
            )
          : fail('This ticket tier is not free', 'tier_not_free', 400)
      }
      const onSale = tierIsOnSale(tier, now)
      if (!onSale.ok) {
        return fail(onSale.reason, onSale.code, 400)
      }
      claims.push({
        tierId: String(tier.id),
        tierName: String(tier.name || 'General Admission'),
        quantity: sel.quantity,
        unitPrice: price,
      })
    }
  } else if (tierId) {
    // Explicit tier: it must belong to THIS event, price out at 0 (on its own or
    // via the promo), and be on sale.
    const tier = tierDocs.find((t: any) => String(t.id) === String(tierId))
    if (!tier) {
      return fail('Ticket tier not found for this event', 'tier_not_found', 404)
    }
    const price = storedPrice(tier.price)
    if (!zeroesToFree(price)) {
      return promo
        ? fail('This promo code does not make these tickets free.', 'promo_not_free', 400)
        : fail('This ticket tier is not free', 'tier_not_free', 400)
    }
    const onSale = tierIsOnSale(tier, new Date())
    if (!onSale.ok) {
      return fail(onSale.reason, onSale.code, 400)
    }
    claims = [{
      tierId: String(tier.id),
      tierName: String(tier.name || 'General Admission'),
      quantity: ticketQuantity,
      unitPrice: price,
    }]
  } else if (tierDocs.length > 0) {
    // No explicit tier: pick the event's free tier. If NO tier is free, the
    // event has nothing to give away — refuse rather than issuing a ticket for
    // a paid tier at no charge.
    //
    // A promo deliberately does NOT widen this branch: choosing which PAID tier a
    // 100%-off code should zero is a decision only the buyer can make, and
    // guessing would hand out (say) the VIP tier because it happened to sort
    // first. The caller must name the tier.
    const freeTiers = tierDocs
      .filter((t: any) => storedPrice(t.price) === 0)
      .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
    if (freeTiers.length === 0) {
      return promo
        ? fail('Select a ticket type to use this promo code.', 'promo_requires_tier', 400)
        : fail('This is not a free event', 'event_not_free', 400)
    }
    const onSaleFree = freeTiers.find((t: any) => tierIsOnSale(t, new Date()).ok)
    if (!onSaleFree) {
      const reason = tierIsOnSale(freeTiers[0], new Date())
      return reason.ok
        ? fail('No tickets available', 'no_tickets_available', 400)
        : fail(reason.reason, reason.code, 400)
    }
    claims = [{
      tierId: String(onSaleFree.id),
      tierName: String(onSaleFree.name || 'General Admission'),
      quantity: ticketQuantity,
      unitPrice: storedPrice(onSaleFree.price),
    }]
  } else {
    // Legacy event with no tier docs at all: fall back to the event-level price.
    const price = storedPrice(event.ticket_price)
    if (!zeroesToFree(price)) {
      return promo
        ? fail('This promo code does not make these tickets free.', 'promo_not_free', 400)
        : fail('This is not a free event', 'event_not_free', 400)
    }
    // Empty tierId — these tickets carry no tier and only count toward the
    // event-level tickets_sold (buildTierSoldIncrements skips them).
    claims = [{ tierId: '', tierName: 'General Admission', quantity: ticketQuantity, unitPrice: price }]
  }

  // ── Final price gate ────────────────────────────────────────────────────────
  // Independent of every branch above: recompute the whole order from the prices
  // this route READ OUT OF FIRESTORE and refuse unless the server's own total is
  // exactly 0. Money math runs on integer cents (computeSelectionTotal) so a
  // percentage promo can't leave a fraction of a gourde behind and slip through
  // as "close enough to free".
  const grossTotalCents = toCents(
    computeSelectionTotal(claims.map((c) => ({ price: c.unitPrice, quantity: c.quantity })))
  )
  const netTotalCents = toCents(
    computeSelectionTotal(
      claims.map((c) => ({ price: chargedUnitPrice(c.unitPrice), quantity: c.quantity }))
    )
  )
  if (netTotalCents !== 0) {
    console.warn('[claim-free] refusing non-zero claim', { eventId, netTotalCents })
    return promo
      ? fail('This promo code does not make these tickets free.', 'promo_not_free', 400)
      : fail('This ticket tier is not free', 'tier_not_free', 400)
  }
  // How much the promo actually took off. 0 means the tiers were already free and
  // the promo did nothing — in that case we must NOT burn one of its uses below.
  const promoDiscountCents = Math.max(0, grossTotalCents - netTotalCents)

  // Per-user dedup: never issue a second FREE ticket to the same user for the same
  // event (prevents refresh/double-click and scripted abuse from claiming unlimited
  // free inventory). Query by attendee_id only (single-field, auto-indexed) and
  // filter in memory — a user holds few tickets, so this avoids a composite index.
  //
  // Scoped to free tickets: on an event with free AND paid tiers, a buyer who
  // already PAID must not be told they "already claimed" the free tier, and their
  // paid ticket must not be returned as if it were the claim.
  //
  // A GUEST has a freshly-minted id, so `attendee_id` would never match anything.
  // Their dedup key is the EMAIL they just gave — the one identifier that survives
  // across their (session-less) visits. Both are single-field equality queries, so
  // neither needs a composite index.
  const userTicketsSnap = identity.isGuest
    ? await adminDb.collection('tickets').where('guest_email', '==', identity.email).get()
    : await adminDb.collection('tickets').where('attendee_id', '==', identity.id).get()
  // A signed-in claimant is deduped on their LIVE free tickets only: one that
  // was refunded, cancelled or voided no longer holds the claim. (A guest's
  // answer is neutral either way, so any earlier ticket still counts.)
  const existing = identity.isGuest
    ? userTicketsSnap.docs
        .map((d: any) => ({ id: d.id, ...d.data() }))
        .filter((t: any) => t.event_id === eventId && Number(t.price_paid ?? 0) === 0)
    : liveFreeTicketsFor(userTicketsSnap.docs, String(eventId))
  if (existing.length > 0) {
    console.log('User already has free ticket(s) for event:', eventId, 'count:', existing.length)
    if (identity.isGuest) {
      return fail(GUEST_ALREADY_CLAIMED_MESSAGE, 'already_claimed', 409)
    }
    return { ok: true, kind: 'existing', tickets: existing }
  }

  // Take the once-per-event lock BEFORE reserving, so two simultaneous claims by
  // the same claimant cannot both pass the query above and both be issued.
  const lockRef = adminDb.collection('free_claim_locks').doc(freeClaimLockId(String(eventId), identity))
  let lockHeld = false
  try {
    await lockRef.create({
      event_id: String(eventId),
      kind: identity.isGuest ? 'guest' : 'account',
      created_at: new Date().toISOString(),
    })
    lockHeld = true
  } catch (lockErr: any) {
    if (isAlreadyExists(lockErr)) {
      console.log('[claim-free] concurrent/previous claim holds the lock', { eventId })
      if (identity.isGuest) {
        return fail(GUEST_ALREADY_CLAIMED_MESSAGE, 'already_claimed', 409)
      }
      // Signed in: the claim reopens ONLY when every ticket it issued has been
      // voided (refunded / cancelled). A ticket transferred to someone else
      // still holds it, or a claimant could farm free tickets: claim, transfer,
      // claim again. Decided inside a transaction on the lock:
      //  - the lock records its ticket_ids → read each by id; any one still live
      //    (whoever holds it now) or checked in, or missing → the claim holds
      //  - a legacy lock (no ticket_ids) → the claimant's tickets for this
      //    event by their claimant fields; any live one holds it, and if none
      //    can be found the claim also holds (it cannot be shown to be void)
      //  - a fresh lock with nothing issued yet → a concurrent claim mid-way
      // When the claim holds, the claimant's own live tickets come back, or a
      // 409 — never "success" with zero tickets (build 44 read that as
      // "N tickets claimed").
      const takeover = await adminDb.runTransaction(async (tx: any) => {
        const lockSnap = await tx.get(lockRef)
        const ownSnap = await tx.get(
          adminDb.collection('tickets').where('attendee_id', '==', identity.id)
        )
        const ownLive = liveFreeTicketsFor(ownSnap?.docs || [], String(eventId))
        const held = () =>
          ownLive.length > 0
            ? ({ outcome: 'has_tickets' as const, tickets: ownLive })
            : ({ outcome: 'held' as const })

        const lock = lockSnap?.exists ? lockSnap.data() || {} : null
        if (!lock) {
          // Released between our create() and now: take it fresh.
          tx.set(lockRef, {
            event_id: String(eventId),
            kind: 'account',
            created_at: new Date().toISOString(),
          })
          return { outcome: 'taken' as const }
        }

        const recordedIds: string[] = Array.isArray(lock.ticket_ids)
          ? lock.ticket_ids.map((id: any) => String(id)).filter(Boolean)
          : []
        let issuedTickets: any[]
        if (recordedIds.length > 0) {
          const snaps = await Promise.all(
            recordedIds.map((id) => tx.get(adminDb.collection('tickets').doc(id)))
          )
          // A recorded ticket that no longer exists cannot be shown void.
          if (snaps.some((snap: any) => !snap?.exists)) return held()
          issuedTickets = snaps.map((snap: any) => snap.data() || {})
        } else {
          const createdAt = lock.created_at ? new Date(lock.created_at).getTime() : NaN
          if (Number.isFinite(createdAt) && Date.now() - createdAt < FREE_CLAIM_LOCK_IN_FLIGHT_MS) {
            return held()
          }
          const eventTicketsSnap = await tx.get(
            adminDb.collection('tickets').where('event_id', '==', String(eventId))
          )
          issuedTickets = (eventTicketsSnap?.docs || [])
            .map((d: any) => d.data() || {})
            .filter(
              (t: any) =>
                t.event_id === String(eventId) &&
                Number(t.price_paid ?? 0) === 0 &&
                [t.attendee_id, t.user_id, t.original_attendee_id, t.claimed_by].some(
                  (v: any) => v != null && String(v) === String(identity.id)
                )
            )
          if (issuedTickets.length === 0) return held()
        }
        if (!issuedTickets.every(isVoidedFreeTicket)) return held()

        tx.set(lockRef, {
          event_id: String(eventId),
          kind: 'account',
          created_at: new Date().toISOString(),
          replaced_voided_claim_at: new Date().toISOString(),
          previous_ticket_ids: recordedIds,
        })
        return { outcome: 'taken' as const }
      })
      if (takeover.outcome === 'has_tickets') {
        return { ok: true, kind: 'existing', tickets: takeover.tickets }
      }
      if (takeover.outcome === 'held') {
        return fail('You already claimed a ticket for this event.', 'already_claimed', 409)
      }
      lockHeld = true
    } else {
      // A transient failure to write the lock must not block a legitimate claim;
      // the per-claimant query above already ran.
      console.warn('[claim-free] could not take claim lock (continuing)', { message: lockErr?.message })
    }
  }
  /** Give the claimant their one claim back when this attempt issues nothing. */
  const releaseLock = async () => {
    if (!lockHeld) return
    lockHeld = false
    try {
      await lockRef.delete()
    } catch (e) {
      console.warn('[claim-free] failed to release claim lock', { message: (e as any)?.message })
    }
  }

  // Atomic capacity gate + increment (same helper the paid paths use). Reserving BEFORE issuing
  // tickets serializes concurrent claims through a Firestore transaction so the event can't be
  // oversold, and the increment is done here (no separate non-atomic update below).
  //
  // ALL-OR-NOTHING for a multi-tier claim: one call with every tier increment, so
  // the whole order is checked and committed inside a single transaction. If any
  // one tier lacks capacity the buyer gets nothing and can retry, rather than
  // being left with a partial order that has already burned their one free claim
  // for this event.
  const tierIncrements = buildTierSoldIncrements(
    claims.map((c) => ({ tierId: c.tierId, quantity: c.quantity }))
  )
  const reservation = await reserveInventoryAtomic({
    eventId,
    quantity: ticketQuantity,
    tierIncrements,
    logPrefix: '[claim-free]',
  })
  if (!reservation.ok && reservation.reason === 'busy') {
    // Contention outlasted the bounded retries: nothing was reserved. Retryable.
    await releaseLock()
    return fail(
      'So many people are claiming right now that we could not hold your tickets. Please try again in a moment.',
      'busy_try_again',
      503
    )
  }
  if (!reservation.ok) {
    await releaseLock()
    const remaining = Number(reservation.remaining ?? 0)
    if (remaining <= 0) {
      return fail('No tickets available', 'no_tickets_available', 400)
    }
    return fail(
      `Only ${remaining} ticket${remaining !== 1 ? 's' : ''} remaining`,
      'limited_availability',
      400
    )
  }

  // ── Promo redemption: the authoritative usage-cap gate ──────────────────────
  // Same helper the paid pipeline calls (lib/tickets/fulfillment.ts:335), which
  // re-reads uses_count/max_uses inside a Firestore transaction and only then
  // increments + writes the `promo_code_usage` record. Two differences from the
  // paid path, both deliberate:
  //   • it runs BEFORE tickets exist, so a cap-reached code can still be refused
  //     cleanly (the paid path has already taken money, so it keeps the tickets
  //     and just logs);
  //   • ANY non-redemption is fatal here. If we cannot record the redemption we
  //     must not give the ticket away, otherwise a single-use code would issue
  //     unlimited free tickets.
  // The reservation made just above is released so the refusal doesn't leak
  // inventory.
  if (promo && promoDiscountCents > 0) {
    const redeem = await redeemPromoInTransaction({
      promoId: promo.id,
      qty: ticketQuantity,
      userId: identity.id,
      // A guest's `guest_…` id is minted per claim, so it cannot carry a per-buyer
      // cap. Their EMAIL can — the same identifier the free-ticket dedup above
      // keys on.
      buyerKey: promoBuyerKey(identity),
      eventId,
      discountApplied: promoDiscountCents / 100,
    })
    if (!redeem.redeemed) {
      await releaseLock()
      await releaseInventoryReservation({
        reservationId: reservation.reservationId,
        eventId,
        quantity: ticketQuantity,
        tierIncrements,
        logPrefix: '[claim-free]',
      })
      console.warn('[claim-free] promo redemption refused', {
        eventId,
        promoId: promo.id,
        capReached: redeem.capReached,
      })
      if (redeem.buyerCapReached) {
        return fail('You have already used this promo code.', 'promo_already_used', 400)
      }
      return redeem.capReached
        ? fail('This promo code has reached its usage limit.', 'promo_exhausted', 400)
        : fail('Could not apply this promo code. Please try again.', 'promo_redeem_failed', 400)
    }
  }

  // Create tickets one at a time to ensure each gets a unique ID, tier by tier so
  // every ticket carries the tier it was actually claimed against.
  const createdTickets: any[] = []
  /** Position across the whole claim: ticket 0 is the claimant's own, 1.. are plus-ones. */
  let issuedIndex = 0
  try {
    for (const claim of claims) {
      for (let i = 0; i < claim.quantity; i++) {
        const ticketData = {
          event_id: eventId,
          attendee_id: identity.id,
          attendee_name: identity.name || identity.email || 'Guest',
          // A guest ticket carries its buyer's contact details so support and refunds
          // can find it by email or phone without a uid to join on.
          ...(identity.isGuest
            ? { is_guest: true, guest_email: identity.email, guest_phone: identity.phone || null }
            : {}),
          status: 'valid',
          price_paid: 0,
          currency: event.currency || 'HTG',
          payment_method: 'free',
          purchased_at: FieldValue.serverTimestamp(),
          tier_name: claim.tierName || 'General Admission',
          tier_id: claim.tierId,
          // Include event date fields for scanner
          start_datetime: event.start_datetime || null,
          end_datetime: event.end_datetime || null,
          event_date: event.start_datetime || null,
          venue_name: event.venue_name || null,
          city: event.city || null,
          // Audit trail for a promo-zeroed ticket. Added ONLY when a promo actually
          // paid for it, so a plain free claim keeps its exact historical doc shape.
          ...(promo && promoDiscountCents > 0
            ? { promo_code_id: promo.id, original_price: claim.unitPrice }
            : {}),
          // Promoter attribution — added only when a valid ref arrived, keeping the
          // plain claim's doc shape unchanged. Free claims earn no commission; the
          // promoter still gets credit for driving the RSVP.
          ...(promoter ? { promoter_id: promoter.id, promoter_code: promoter.code } : {}),
          // Visit attribution — likewise only when there is any.
          ...ticketAttributionFields(attribution),
          // Approval lists / plus-ones (lib/events/approval). Added only when
          // present, so a plain claim keeps its exact historical doc shape.
          ...(options.ticketFields || {}),
          ...plusOneFieldsFor(issuedIndex),
        }
        issuedIndex += 1

        const ticketRef = await adminDb.collection('tickets').add(ticketData)

        // Now update with QR code data using the actual ticket ID
        await ticketRef.update({ qr_code_data: ticketRef.id })

        const createdTicketDoc = await ticketRef.get()
        const createdTicket = { id: createdTicketDoc.id, ...createdTicketDoc.data() }
        createdTickets.push(createdTicket)
        console.log('Created ticket:', createdTicket.id, 'with QR:', createdTicket.id)
      }
    }
  } catch (issueErr) {
    // Nothing issued: hand the seats and the claimant's one claim back so a retry
    // can succeed. (A partial issue keeps both — the claimant holds tickets.)
    if (createdTickets.length === 0) {
      await releaseInventoryReservation({
        reservationId: reservation.reservationId,
        eventId,
        quantity: ticketQuantity,
        tierIncrements,
        logPrefix: '[claim-free]',
      })
      await releaseLock()
    }
    throw issueErr
  }
  
  console.log('Created tickets:', createdTickets.length)

  // Record WHICH tickets this claim issued. A later claim reads exactly these by
  // id and reopens only once every one is refunded / cancelled (see the takeover
  // above); one transferred away keeps the claim taken.
  if (lockHeld) {
    try {
      await lockRef.set(
        { issued_at: new Date().toISOString(), ticket_ids: createdTickets.map((t: any) => String(t.id)) },
        { merge: true }
      )
    } catch (e) {
      console.warn('[claim-free] failed to stamp claim lock', { message: (e as any)?.message })
    }
  }

  // NOTE: the seats were already reserved as sold, atomically, by reserveInventoryAtomic above
  // (tickets_sold is a rollup of the inventory shards), so nothing is incremented here.

  // Record the tickets against the guest order so the retrieval link renders them.
  if (identity.isGuest && identity.guestOrderKey) {
    await attachTicketsToGuestOrder(
      identity.guestOrderKey,
      createdTickets.map((t: any) => String(t.id))
    )
  }

  // Attribute the claim to its promoter. Zero-revenue order ⇒ zero commission
  // (both commission types), but the tickets/orders counters still credit them.
  if (promoter && createdTickets.length > 0) {
    await recordPromoterSale({
      promoterId: promoter.id,
      eventId,
      ticketIds: createdTickets.map((t: any) => String(t.id)),
      quantity: ticketQuantity,
      orderGrossCents: 0,
      currency: event.currency || 'HTG',
      paymentMethod: 'free',
      paymentId: null,
      buyerUserId: identity.isGuest ? null : identity.id,
      buyerEmail: identity.email || null,
    })
  }

  // Count the claim on its tracking link. A claim has no gateway id; its first
  // ticket's id is unique to this one request, so the marker still makes the
  // count exactly-once.
  if (attribution?.tracking_link_id && createdTickets.length > 0) {
    await recordAttributedSale(attribution, {
      eventId: String(eventId),
      orderKey: `free_${createdTickets[0].id}`,
      quantity: ticketQuantity,
      revenueCents: 0,
      currency: String(event.currency || 'HTG'),
      paymentMethod: 'free',
    })
  }

  // Friend-invite credit (lib/invites). Never throws; guests have no account.
  if (!identity.isGuest && createdTickets.length > 0) {
    await recordInvitePurchase({
      buyerUid: identity.id,
      eventId: String(eventId),
      ticketIds: createdTickets.map((t: any) => String(t.id)),
      orderKey: `free_${createdTickets[0].id}`,
    })
  }

  // ── DELIVER THE TICKET ──────────────────────────────────────────────────────
  // This route used to import no email module at all: an attendee of a free/RSVP
  // event got an in-app notification and nothing else — no confirmation, no QR code,
  // nothing to show at the door unless they happened to open the app again. A free
  // ticket is still a ticket, so it goes out over the same pipeline the paid paths
  // use (email with the QR; SMS for a guest, WhatsApp for an account holder).
  //
  // Best-effort: the tickets are already issued and are the buyer's regardless of
  // whether the mail provider is reachable.
  try {
    await sendTicketConfirmation({
      ticketId: String(createdTickets[0].id),
      qrPayload: (createdTickets[0] as any).qr_code_data || createdTickets[0].id,
      event,
      recipient: {
        // Resolved from the session or from the guest record created above — never
        // from an address the request body could name for someone else's order.
        email: identity.email,
        name: identity.name,
        phone: identity.phone,
        isGuest: identity.isGuest,
      },
      quantity: ticketQuantity,
      tierName: claims[0]?.tierName,
      ticketPrice: 0,
      currency: event.currency || 'HTG',
      guestToken: identity.guestToken || null,
      approved: options.approved === true,
      logPrefix: '[claim-free]',
    })
  } catch (error) {
    console.error('[claim-free] failed to deliver ticket confirmation', error)
  }

  // Send in-app notification for free ticket claim
  try {
    // A guest has no account for an in-app notification to land in.
    if (!identity.isGuest && options.notifyBuyer !== false) {
      await notifyTicketPurchase(
        identity.id,
        eventId,
        event.title,
        ticketQuantity
      )
    }

    // Notify organizer (not when they approved it themselves: they know).
    if (options.notifyOrganizer !== false) await notifyOrganizerTicketSale(
      event.organizer_id,
      eventId,
      event.title,
      ticketQuantity,
      0, // free event
      identity.name
    )
  } catch (error) {
    console.error('Failed to send notification:', error)
    // Don't fail the claim if notification fails
  }


  return {
    ok: true,
    kind: 'issued',
    tickets: createdTickets,
    claims,
    promoApplied: Boolean(promo && promoDiscountCents > 0),
  }
}
