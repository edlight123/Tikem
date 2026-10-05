/**
 * Stripe order fulfilment — the ONE path that turns a paid Stripe order into
 * tickets, inventory, earnings, promo/promoter bookkeeping and notifications.
 *
 * Called by:
 *  - the Stripe webhook (checkout.session.completed, payment_intent.succeeded)
 *  - the client "confirm payment" route (/api/tickets/create-from-payment)
 *
 * Before this module the two paths each carried their own copy of the pipeline
 * and drifted: the client path never booked earnings or withheld the promoter's
 * commission, and both could issue a second set of tickets when a claim was
 * released (or went stale) after some writes had already landed.
 *
 * EXACTLY-ONCE, RESUMABLY
 * -----------------------
 * Every order gets a ledger doc in `stripe_orders/{paymentId}`. Each side effect
 * is a named STEP recorded on it, so a retry (Stripe redelivery, a stale claim,
 * the other path) resumes where the last attempt stopped instead of starting over:
 *
 *  - inventory   reserved once; a second runner seeing it in flight backs off
 *  - tickets     ids are deterministic per (payment, index) and ALL of them are
 *                written in one transaction together with the ledger's
 *                `tickets_issued_at`, so an order is either fully issued or not at
 *                all, and re-running never creates a second set
 *  - promo / promoter / earnings
 *                money bookkeeping is AT MOST once: a step that started but never
 *                recorded completion (a crash mid-step) is NOT re-run — it is
 *                flagged `needs_reconcile` for an admin instead of double counting
 *  - attribution / guest attach
 *                idempotent on their own, so a stale one is simply re-run
 *  - notify      at most once (a buyer should not get the email twice)
 *
 * A step that THROWS is cleared (nothing was recorded) and the order reports
 * `partial`, so the caller fails the request and Stripe's retry finishes the job.
 *
 * AUTOMATIC REFUNDS
 * -----------------
 * When the event sold out between payment and fulfilment the buyer is refunded
 * through lib/refunds (reverse_transfer + refund_application_fee on a destination
 * charge, idempotency key per PaymentIntent). A refund that fails is recorded on
 * the ledger as `needs_refund` + `refund_error`, the order is NOT marked done, and
 * every retry re-attempts the refund (never re-checks capacity: once an order is
 * headed for a refund it stays headed for one).
 */

import { createHmac } from 'node:crypto'
import { adminDb } from '@/lib/firebase/admin'
import { addTicketToEarnings } from '@/lib/earnings'
import { sendTicketConfirmation } from '@/lib/tickets/confirmation'
import { notifyOrganizerTicketSale, notifyTicketPurchase } from '@/lib/notifications/helpers'
import { onSaleCompleted } from '@/lib/notifications/campaigns'
import { promoBuyerKey, redeemPromoInTransaction } from '@/lib/promo-codes'
import { recordPromoterSale } from '@/lib/promoters'
import { attributionFromStripeMetadata, ticketAttributionFields } from '@/lib/attribution'
import { recordAttributedSale } from '@/lib/tracking-links'
import { attachTicketsToGuestOrder } from '@/lib/guest/identity'
import type { GuestOrderRecipient } from '@/lib/guest/checkout'
import { buildTierSoldIncrements, reserveInventoryAtomic } from '@/lib/tickets/inventory'
import { isDestinationCharge, processStripeRefund } from '@/lib/refunds'
import { reversePromoterCommission } from '@/lib/tickets/refundExecution'
import { refundFaceAmount } from '@/lib/tickets/refundPlan'
import { parseTicketQuantity } from '@/lib/tickets/purchasable'

export const STRIPE_ORDERS_COLLECTION = 'stripe_orders'

/** An inventory step "in flight" longer than this is assumed to have crashed. */
const INVENTORY_STALE_MS = 10 * 60 * 1000
/** Any other step "in flight" longer than this is assumed to have crashed. */
const STEP_STALE_MS = 5 * 60 * 1000

/** Currencies an event can be listed in. Anything else is treated as USD. */
const EVENT_CURRENCIES = new Set(['HTG', 'USD', 'CAD', 'EUR'])

export function normalizeEventCurrency(raw: unknown): 'HTG' | 'USD' | 'CAD' | 'EUR' {
  const upper = String(raw ?? '').trim().toUpperCase()
  return (EVENT_CURRENCIES.has(upper) ? upper : 'USD') as 'HTG' | 'USD' | 'CAD' | 'EUR'
}

export interface StripeOrderInput {
  source: 'checkout_session' | 'payment_intent' | 'client_confirm'
  /**
   * The payment reference stamped on every ticket (`payment_id`) and the ledger
   * key: the PaymentIntent id, or the Checkout Session id when a hosted session
   * somehow has no PaymentIntent.
   */
  paymentId: string
  /** The PaymentIntent to refund against; null when there is none. */
  paymentIntentId: string | null
  /** Order metadata stamped at create-payment-intent / create-checkout-session. */
  metadata: Record<string, any>
  /** Ticket owner: an account uid or a per-order `guest_…` id. */
  buyerId: string
  /** Set for a guest order (details come off the order, never the request). */
  guestRecipient: GuestOrderRecipient | null
  /** Buyer email Stripe collected (hosted checkout), for the promo buyer key. */
  customerEmail?: string | null
  /** What Stripe charged, in the charged currency's minor units. */
  amountTotalCents: number
  chargedCurrency: string
  /**
   * Whether the charge was a destination charge (money already sent on to the
   * organizer's connected account). null = unknown; resolved from Stripe when a
   * refund needs it.
   */
  destinationCharge: boolean | null
  logPrefix?: string
}

export type StripeFulfillmentResult =
  | { outcome: 'fulfilled'; ticketIds: string[]; alreadyFulfilled: boolean }
  /** Tickets exist, but a bookkeeping step failed and must be retried. */
  | { outcome: 'partial'; ticketIds: string[]; failedSteps: string[] }
  /** Another runner is mid-way through this order. Retry later. */
  | { outcome: 'in_progress' }
  | { outcome: 'capacity_refunded'; refundId: string | null }
  /** Sold out and the automatic refund FAILED — flagged needs_refund. */
  | { outcome: 'refund_failed'; error: string }

type StepName =
  | 'inventory'
  | 'promo'
  | 'promoter'
  | 'attribution'
  | 'earnings'
  | 'guest_attach'
  | 'notify'

type StepClaim = 'run' | 'done' | 'in_progress' | 'stale'

// ── Ledger helpers ───────────────────────────────────────────────────────────

export function stripeOrderDocId(paymentId: string): string {
  return String(paymentId).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 1400)
}

function orderRefFor(paymentId: string) {
  return adminDb.collection(STRIPE_ORDERS_COLLECTION).doc(stripeOrderDocId(paymentId))
}

/**
 * Ticket ids for an order: deterministic per (payment, index), so a re-run
 * writes the SAME documents instead of a second set — but not guessable from the
 * PaymentIntent id alone. The ticket id is also what the door scanner reads off
 * the QR code, so a plain `${pi}_${i}` would let anyone holding one ticket of an
 * order derive its siblings' QR codes.
 */
export function deterministicTicketId(paymentId: string, index: number): string {
  const secret =
    process.env.TICKET_ID_SECRET || process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_SECRET_KEY || 'tikem'
  const tag = createHmac('sha256', secret).update(`${paymentId}:${index}`).digest('hex').slice(0, 16)
  return `${stripeOrderDocId(paymentId)}_${index}_${tag}`
}

/** Read the ledger for an order. Never throws. */
export async function getStripeOrderState(paymentId: string): Promise<Record<string, any> | null> {
  try {
    const snap = await orderRefFor(paymentId).get()
    return snap.exists ? (snap.data() as Record<string, any>) : null
  } catch {
    return null
  }
}

/** Ids of every ticket already carrying this payment reference. */
export async function findTicketIdsForPayment(paymentId: string): Promise<string[]> {
  const snap = await adminDb.collection('tickets').where('payment_id', '==', paymentId).get()
  return snap.docs.map((d: any) => String(d.id))
}

/**
 * True once any ticket exists for this payment. Callers use it to decide that a
 * claim must NOT be released after a failure: the ledger lets the next attempt
 * resume, so nothing is gained by inviting a concurrent one.
 */
export async function stripeOrderHasTickets(paymentId: string): Promise<boolean> {
  const state = await getStripeOrderState(paymentId)
  if (state?.tickets_issued_at) return true
  try {
    return (await findTicketIdsForPayment(paymentId)).length > 0
  } catch {
    // Can't tell: assume tickets exist, which is the side that never re-issues.
    return true
  }
}

async function claimStep(orderRef: any, step: StepName, staleMs: number): Promise<StepClaim> {
  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(orderRef)
    const data = snap.exists ? snap.data() || {} : {}
    const steps = { ...(data.steps || {}) }
    const cur = steps[step]
    if (cur?.done_at) return 'done' as StepClaim
    const now = new Date().toISOString()
    if (cur?.started_at) {
      const age = Date.now() - new Date(cur.started_at).getTime()
      if (Number.isFinite(age) && age < staleMs) return 'in_progress' as StepClaim
      steps[step] = { started_at: now, stale_from: cur.started_at }
      tx.set(orderRef, { steps, updated_at: now }, { merge: true })
      return 'stale' as StepClaim
    }
    steps[step] = { started_at: now }
    tx.set(orderRef, { steps, updated_at: now }, { merge: true })
    return 'run' as StepClaim
  })
}

/** Record a step's completion (value) or clear it (null) so a retry can run it. */
async function settleStep(orderRef: any, step: StepName, value: Record<string, any> | null, extra?: Record<string, any>) {
  await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(orderRef)
    const data = snap.exists ? snap.data() || {} : {}
    const steps = { ...(data.steps || {}) }
    const now = new Date().toISOString()
    if (value) steps[step] = { ...(steps[step] || {}), ...value, done_at: now }
    else delete steps[step]
    tx.set(orderRef, { steps, updated_at: now, ...(extra || {}) }, { merge: true })
  })
}

async function flagReconcile(orderRef: any, step: StepName, logPrefix: string, paymentId: string) {
  console.error(`${logPrefix} RECONCILE: step "${step}" started but never confirmed for ${paymentId}; not re-running money bookkeeping`)
  await settleStep(orderRef, step, { unconfirmed: true }, {
    needs_reconcile: true,
    [`reconcile_${step}`]: true,
  }).catch(() => undefined)
}

// ── Refund on sell-out ──────────────────────────────────────────────────────

/**
 * Refund a paid order that will never get tickets: sold out after payment, or
 * an order whose metadata cannot be honoured (an invalid quantity). The
 * `refundReason` is recorded on the order; `reason` is the capacity detail.
 */
async function refundSoldOutOrder(
  input: StripeOrderInput,
  orderRef: any,
  reason: string,
  refundReason: string = 'capacity_exceeded'
): Promise<StripeFulfillmentResult> {
  const logPrefix = input.logPrefix || '[stripe-fulfillment]'
  const now = new Date().toISOString()
  const pi = input.paymentIntentId

  // Record the decision FIRST: from here on every retry refunds, never issues.
  await orderRef.set(
    {
      status: 'refund_pending',
      refund_reason: refundReason,
      capacity_reason: reason,
      // Flagged until the refund is confirmed below, so a crash in between
      // still leaves the order in the refund queue.
      needs_refund: true,
      updated_at: now,
    },
    { merge: true }
  )

  if (!pi) {
    const error = 'no_payment_intent_to_refund'
    console.error(`${logPrefix} NEEDS MANUAL REFUND: sold out after payment and no PaymentIntent to refund`, {
      paymentId: input.paymentId,
    })
    await orderRef.set({ status: 'refund_failed', needs_refund: true, refund_error: error, updated_at: now }, { merge: true })
    return { outcome: 'refund_failed', error }
  }

  let destination = input.destinationCharge
  if (destination === null) destination = await isDestinationCharge(pi)
  if (destination === null) {
    destination = String(input.metadata?.payoutProvider || '').toLowerCase() === 'stripe_connect'
  }

  const res = await processStripeRefund(pi, undefined, {
    // A destination charge already sent the money to the organizer's connected
    // account: without these flags the refund would come out of Tikèm's balance
    // while the organizer kept the sale.
    reverseTransfer: destination,
    refundApplicationFee: destination,
    idempotencyKey: `tikem-capacity-refund-${pi}`,
  })

  if (!res.success) {
    const error = res.error || 'stripe_refund_failed'
    console.error(`${logPrefix} AUTO-REFUND FAILED for sold-out order — buyer was charged and holds no ticket`, {
      paymentIntentId: pi,
      error,
    })
    await orderRef.set(
      { status: 'refund_failed', needs_refund: true, refund_error: error, updated_at: new Date().toISOString() },
      { merge: true }
    )
    return { outcome: 'refund_failed', error }
  }

  await orderRef.set(
    {
      status: 'refunded_capacity',
      needs_refund: false,
      refund_error: null,
      refund_id: res.refundId || null,
      refund_reverse_transfer: destination,
      refunded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { merge: true }
  )
  return { outcome: 'capacity_refunded', refundId: res.refundId || null }
}

// ── The pipeline ────────────────────────────────────────────────────────────

export async function fulfillStripeOrder(input: StripeOrderInput): Promise<StripeFulfillmentResult> {
  const logPrefix = input.logPrefix || '[stripe-fulfillment]'
  const m = input.metadata || {}
  const eventId = String(m.eventId || '')
  const orderRef = orderRefFor(input.paymentId)

  const initialSnap = await orderRef.get()
  const initial: Record<string, any> = initialSnap.exists ? initialSnap.data() || {} : {}

  // The quantity the intent was priced for, validated exactly as checkout
  // validates it (lib/tickets/purchasable: a whole number in [1, 50]). It used
  // to be parseInt-clamped to >= 1, so an intent created for '0.01' tickets
  // before the checkout fix was issued a whole ticket. Metadata with no
  // quantity at all predates the field and means one ticket. An order whose
  // tickets were already issued keeps the count it was issued with.
  const rawQuantity = m.quantity
  const parsedQuantity =
    rawQuantity === undefined || rawQuantity === null || rawQuantity === '' ? 1 : parseTicketQuantity(rawQuantity)
  const issuedQuantity = Number(initial.quantity)
  const resolvedQuantity =
    parsedQuantity ??
    (initial.tickets_issued_at && Number.isInteger(issuedQuantity) && issuedQuantity > 0 ? issuedQuantity : null)

  if (initial.status === 'fulfilled') {
    return { outcome: 'fulfilled', ticketIds: initial.ticket_ids || [], alreadyFulfilled: true }
  }
  if (initial.status === 'refunded_capacity') {
    return { outcome: 'capacity_refunded', refundId: initial.refund_id || null }
  }
  if (['refund_pending', 'refund_failed'].includes(String(initial.status))) {
    return refundSoldOutOrder(
      input,
      orderRef,
      String(initial.capacity_reason || 'capacity_exceeded'),
      String(initial.refund_reason || 'capacity_exceeded')
    )
  }

  // Tickets issued by the pre-ledger code (random ids): that order was fulfilled
  // in full by the old pipeline. Adopt it rather than issuing a second set.
  if (!initial.tickets_issued_at) {
    const legacy = await findTicketIdsForPayment(input.paymentId)
    if (legacy.length > 0) {
      await orderRef.set(
        { status: 'fulfilled', ticket_ids: legacy, legacy_fulfilment: true, updated_at: new Date().toISOString() },
        { merge: true }
      )
      return { outcome: 'fulfilled', ticketIds: legacy, alreadyFulfilled: true }
    }
  }

  // A paid intent whose quantity is not a valid whole number: never issue.
  // Refunded through the same path as a sell-out, flagged needs_refund.
  if (resolvedQuantity === null) {
    console.error(`${logPrefix} refusing to issue tickets for an invalid metadata quantity — refunding`, {
      paymentId: input.paymentId,
      quantity: rawQuantity,
    })
    return refundSoldOutOrder(input, orderRef, 'invalid_quantity', 'invalid_quantity')
  }
  const quantity: number = resolvedQuantity

  // ── Derived order facts ──
  const eventCurrency = normalizeEventCurrency(m.originalCurrency)
  const chargedCurrency = String(input.chargedCurrency || 'usd').toUpperCase()
  const pricePerTicketCharged = (Number(input.amountTotalCents) || 0) / 100 / quantity
  const priceInOriginal = Number(m.priceInOriginalCurrency || m.finalPrice || 0)
  const unitFace = Number.isFinite(priceInOriginal) && priceInOriginal > 0 ? priceInOriginal : pricePerTicketCharged
  const orderGrossCents = Math.round(unitFace * quantity * 100)
  const exchangeRateUsed = m.exchangeRate ? parseFloat(String(m.exchangeRate)) : null
  const isConnect =
    String(m.payoutProvider || '').toLowerCase() === 'stripe_connect' || input.destinationCharge === true
  const paymentMethod = isConnect ? 'stripe_connect' : 'stripe'
  const feeIncidence = m.feeIncidence === 'buyer' ? 'buyer' : 'organizer'
  const attribution = attributionFromStripeMetadata(m)
  const guest = input.guestRecipient
  const tierId = String(m.tierId || '')
  const tierName = String(m.tierName || 'General Admission')

  // ── 1. Inventory: the authoritative oversell gate, reserved exactly once ──
  if (!initial.steps?.inventory?.done_at) {
    const claim = await claimStep(orderRef, 'inventory', INVENTORY_STALE_MS)
    if (claim === 'in_progress') return { outcome: 'in_progress' }
    if (claim === 'stale') {
      // A previous runner died between reserving and recording it. Whether the
      // seats were taken is unknowable here; the buyer has paid, so issue and
      // let an admin check the counter rather than risk a double increment.
      await flagReconcile(orderRef, 'inventory', logPrefix, input.paymentId)
    } else if (claim === 'run') {
      const reservation = await reserveInventoryAtomic({
        eventId,
        quantity,
        tierIncrements: buildTierSoldIncrements(tierId ? [{ tierId, quantity }] : []),
        logPrefix,
      })
      if (!reservation.ok) {
        console.error(`${logPrefix} capacity exceeded after payment — auto-refunding`, {
          paymentId: input.paymentId,
          reason: reservation.reason,
        })
        await settleStep(orderRef, 'inventory', null)
        return refundSoldOutOrder(input, orderRef, String(reservation.reason || 'capacity_exceeded'))
      }
      await settleStep(orderRef, 'inventory', { reserved: quantity })
    }
  }

  // ── 2. Tickets: all-or-nothing, deterministic ids ──
  const eventSnap = eventId ? await adminDb.collection('events').doc(eventId).get() : null
  const eventDetails: Record<string, any> | null = eventSnap?.exists ? { id: eventSnap.id, ...(eventSnap.data() as any) } : null

  const attendee: Record<string, any> | null = guest
    ? { email: guest.email, full_name: guest.name, phone: guest.phone }
    : await (async () => {
        if (!input.buyerId) return null
        const snap = await adminDb.collection('users').doc(String(input.buyerId)).get()
        return snap.exists ? { id: snap.id, ...(snap.data() as any) } : null
      })()

  const ticketIds = Array.from({ length: quantity }, (_, i) => deterministicTicketId(input.paymentId, i))
  const ticketsRef = adminDb.collection('tickets')
  const nowIso = new Date().toISOString()

  const buildTicket = (id: string) => ({
    id,
    event_id: eventId,
    attendee_id: input.buyerId,
    user_id: input.buyerId,
    attendee_name: attendee?.full_name || attendee?.email || 'Guest',
    ...(guest ? { is_guest: true, guest_email: guest.email, guest_phone: guest.phone || null } : {}),
    // Organizer-facing, event-currency face value.
    price_paid: unitFace,
    currency: eventCurrency,
    original_currency: eventCurrency,
    exchange_rate_used: exchangeRateUsed,
    charged_amount: pricePerTicketCharged,
    charged_currency: chargedCurrency,
    // Who paid the fee, from the payment that took the money (never the event's
    // editable setting). The earnings ledger and payout availability read it.
    fee_incidence: feeIncidence,
    // A destination charge is 'stripe_connect' so a refund knows to pull the
    // money back from the organizer's connected account.
    payment_method: paymentMethod,
    payment_id: input.paymentId,
    promoter_id: m.promoterId || null,
    promoter_code: m.promoterCode || null,
    ...ticketAttributionFields(attribution),
    status: 'valid',
    // The scanner looks a ticket up by its document id; the QR carries it.
    qr_code_data: id,
    ticket_type: tierName,
    tier_id: tierId,
    tier_name: tierName,
    start_datetime: eventDetails?.start_datetime || null,
    end_datetime: eventDetails?.end_datetime || null,
    event_date: eventDetails?.start_datetime || null,
    venue_name: eventDetails?.venue_name || null,
    city: eventDetails?.city || null,
    purchased_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
  })

  await adminDb.runTransaction(async (tx: any) => {
    const orderSnap = await tx.get(orderRef)
    if (orderSnap.exists && orderSnap.data()?.tickets_issued_at) return
    const refs = ticketIds.map((id) => ticketsRef.doc(id))
    const snaps = await Promise.all(refs.map((r) => tx.get(r)))
    refs.forEach((ref, i) => {
      if (!snaps[i].exists) tx.set(ref, buildTicket(ticketIds[i]))
    })
    tx.set(
      orderRef,
      {
        status: 'issued',
        payment_id: input.paymentId,
        payment_intent_id: input.paymentIntentId,
        source: input.source,
        event_id: eventId,
        buyer_id: input.buyerId,
        quantity,
        payment_method: paymentMethod,
        ticket_ids: ticketIds,
        tickets_issued_at: nowIso,
        // A retry after a failed sell-out refund can land here once capacity
        // frees up; the buyer then holds tickets and owes no refund.
        needs_refund: false,
        updated_at: nowIso,
      },
      { merge: true }
    )
  })

  // ── 3. Bookkeeping — each step at most once ──
  const failedSteps: string[] = []
  /** Steps left for an admin: started by a runner that never confirmed them. */
  const reconcileSteps = new Set<StepName>()
  let pendingElsewhere = false

  const runStep = async (
    step: StepName,
    opts: { idempotent: boolean },
    fn: () => Promise<Record<string, any> | void>
  ): Promise<Record<string, any> | null> => {
    const claim = await claimStep(orderRef, step, STEP_STALE_MS)
    if (claim === 'done') {
      const snap = await orderRef.get()
      return (snap.data()?.steps?.[step] as Record<string, any>) || {}
    }
    if (claim === 'in_progress') {
      pendingElsewhere = true
      return null
    }
    if (claim === 'stale' && !opts.idempotent) {
      await flagReconcile(orderRef, step, logPrefix, input.paymentId)
      reconcileSteps.add(step)
      return null
    }
    try {
      const result = (await fn()) || {}
      await settleStep(orderRef, step, result)
      return result
    } catch (err: any) {
      console.error(`${logPrefix} fulfilment step "${step}" failed for ${input.paymentId}`, err?.message || err)
      failedSteps.push(step)
      await settleStep(orderRef, step, null, { [`last_error_${step}`]: String(err?.message || err) }).catch(() => undefined)
      return null
    }
  }

  // Promo: the single redemption point for Stripe orders. The buyer key makes a
  // per-buyer cap count this order (a guest is keyed by email, not their
  // per-order id). Cap reached at confirm keeps the tickets — the buyer already
  // paid the discounted price — and is recorded for review.
  if (m.promoCodeId) {
    await runStep('promo', { idempotent: false }, async () => {
      const originalPrice = parseFloat(String(m.originalPrice || '0'))
      const finalPrice = parseFloat(String(m.finalPrice || '0'))
      const perTicketDiscount =
        Number.isFinite(originalPrice) && Number.isFinite(finalPrice) ? Math.max(0, originalPrice - finalPrice) : 0
      const redeem = await redeemPromoInTransaction({
        promoId: String(m.promoCodeId),
        qty: quantity,
        userId: input.buyerId,
        buyerKey: promoBuyerKey({
          isGuest: Boolean(guest) || m.isGuest === 'true',
          id: input.buyerId,
          email: guest?.email || m.guestEmail || input.customerEmail || null,
          phone: guest?.phone || m.guestPhone || null,
        }),
        eventId,
        discountApplied: perTicketDiscount * quantity,
      })
      if (redeem.capReached) {
        console.warn(`${logPrefix} promo cap reached at confirm; tickets kept, discount not counted`, {
          promoId: m.promoCodeId,
          eventId,
          buyerCap: Boolean(redeem.buyerCapReached),
        })
      }
      return { redeemed: redeem.redeemed, cap_reached: redeem.capReached, buyer_cap_reached: Boolean(redeem.buyerCapReached) }
    })
  }

  // Promoter. On a DESTINATION charge the organizer's connected account already
  // received the full net, so Tikèm holds nothing to pay the promoter from: the
  // row is recorded UNFUNDED (informational — organizer settles with the
  // promoter directly) and nothing is withheld from the organizer's earnings.
  let promoterCommissionCents = 0
  let promoterUnresolved: 'reconcile' | 'failed' | null = null
  if (m.promoterId) {
    const res = await runStep('promoter', { idempotent: false }, async () => {
      const sale = await recordPromoterSale({
        promoterId: String(m.promoterId),
        eventId,
        ticketIds,
        quantity,
        orderGrossCents,
        currency: eventCurrency,
        paymentMethod,
        paymentId: input.paymentId,
        buyerUserId: guest || m.isGuest === 'true' ? null : input.buyerId,
        buyerEmail: guest?.email || m.guestEmail || attendee?.email || null,
        // Written unfunded atomically for a destination charge (no post-hoc flip,
        // so no window where the promoter could withdraw it from Tikèm's pool).
        funded: !isConnect,
        unfundedReason: isConnect ? 'destination_charge' : null,
      })
      return {
        recorded: sale.recorded,
        funded: sale.recorded && !isConnect,
        commission_cents: sale.recorded ? sale.commissionCents : 0,
      }
    })
    if (res?.funded) promoterCommissionCents = Math.max(0, Number(res.commission_cents) || 0)
    // Whether a commission was recorded is UNKNOWN when the step is in reconcile
    // (a runner died mid-way, now or on an earlier run) or just failed. Booking
    // earnings then would withhold 0 commission from the organizer, for good.
    if (reconcileSteps.has('promoter') || res?.unconfirmed === true) promoterUnresolved = 'reconcile'
    else if (failedSteps.includes('promoter')) promoterUnresolved = 'failed'
  }

  await runStep('attribution', { idempotent: true }, async () => {
    await recordAttributedSale(attribution, {
      eventId,
      orderKey: input.paymentId,
      quantity,
      revenueCents: orderGrossCents,
      currency: eventCurrency,
      paymentMethod,
    })
  })

  // Earnings. Skipped while the promoter step is undecided elsewhere, because
  // the withheld commission depends on it. Deferred to an admin when the
  // promoter step is in reconcile (its commission is unknowable here), and left
  // for the retry when it failed (the outcome is already 'partial').
  if (promoterUnresolved === 'reconcile') {
    console.error(`${logPrefix} RECONCILE: earnings deferred for ${input.paymentId}; promoter step is unconfirmed`)
    await orderRef
      .set(
        {
          needs_reconcile: true,
          reconcile_earnings: true,
          earnings_deferred_reason: 'promoter_step_unconfirmed',
          updated_at: new Date().toISOString(),
        },
        { merge: true }
      )
      .catch(() => undefined)
  } else if (promoterUnresolved === 'failed') {
    // Nothing to do: the promoter step is retried first on the next run.
  } else if (!(m.promoterId && pendingElsewhere)) {
    await runStep('earnings', { idempotent: false }, async () => {
      await addTicketToEarnings(eventId, orderGrossCents, quantity, {
        currency: eventCurrency,
        paymentMethod,
        chargedAmountCents: Number(input.amountTotalCents) || 0,
        fxRate: exchangeRateUsed,
        chargedCurrency,
        feeIncidence,
        promoterCommissionCents,
      })
      return { gross_cents: orderGrossCents, promoter_commission_cents: promoterCommissionCents }
    })
  } else {
    pendingElsewhere = true
  }

  if (guest && m.guestOrderKey) {
    await runStep('guest_attach', { idempotent: true }, async () => {
      await attachTicketsToGuestOrder(String(m.guestOrderKey), ticketIds)
    })
  }

  // Delivery and notifications: best-effort, at most once. A failure here is
  // logged, never retried (a duplicate email is worse than a missing push).
  await runStep('notify', { idempotent: false }, async () => {
    const out: Record<string, any> = {}
    if (attendee) {
      try {
        await sendTicketConfirmation({
          ticketId: ticketIds[0],
          qrPayload: ticketIds[0],
          event: eventDetails as any,
          recipient: {
            email: attendee.email,
            name: attendee.full_name,
            phone: attendee.phone,
            isGuest: Boolean(guest),
          },
          quantity,
          guestToken: guest?.guestToken || null,
          logPrefix,
        })
        out.confirmation = true
      } catch (err: any) {
        console.error(`${logPrefix} failed to deliver ticket confirmation`, err?.message || err)
        out.confirmation_error = String(err?.message || err)
      }
    }
    try {
      if (!guest && !String(input.buyerId || '').startsWith('guest_')) {
        await notifyTicketPurchase(input.buyerId, eventId, eventDetails?.title || 'Event', quantity)
      }
      if (eventDetails) {
        await notifyOrganizerTicketSale(
          eventDetails.organizer_id,
          eventId,
          eventDetails.title,
          quantity,
          (Number(input.amountTotalCents) || 0) / 100,
          attendee?.full_name
        )
        await onSaleCompleted({ eventId, buyerId: attendee?.id ? String(attendee.id) : null })
      }
      out.notified = true
    } catch (err: any) {
      console.error(`${logPrefix} failed to send sale notifications`, err?.message || err)
      out.notify_error = String(err?.message || err)
    }
    return out
  })

  if (failedSteps.length > 0) {
    return { outcome: 'partial', ticketIds, failedSteps }
  }
  if (pendingElsewhere) {
    return { outcome: 'in_progress' }
  }

  await orderRef.set({ status: 'fulfilled', fulfilled_at: new Date().toISOString() }, { merge: true })
  return { outcome: 'fulfilled', ticketIds, alreadyFulfilled: false }
}

// ── Refunds made outside Tikèm (Stripe dashboard, Radar, support) ────────────

const ACCOUNTED_REFUND_STATUSES = new Set(['approved', 'processing', 'manual_required'])
const VOID_TICKET_STATUSES = new Set(['refunded', 'cancelled', 'canceled', 'refund_pending'])

export interface ChargeRefundResult {
  paymentIntentId: string | null
  ticketsMatched: number
  markedRefunded: string[]
  /** Refunded cents that did not add up to a whole ticket — left for an admin. */
  unallocatedCents: number
}

/**
 * Apply a `charge.refunded` event to the order's tickets.
 *
 * Tikèm's own refunds (lib/tickets/refundExecution) mark their ticket before or
 * while Stripe refunds it — those tickets are "accounted" here and left alone. A
 * refund made anywhere else (dashboard, support, Radar) used to leave the ticket
 * live and scannable and its money counted as payable to the organizer.
 *
 *  - full refund: every still-live ticket of the payment is marked refunded
 *  - partial:     the refunded amount not already accounted for is divided by
 *                 the per-ticket charge; that many tickets (unscanned first) are
 *                 marked refunded and any remainder is recorded for an admin
 *
 * Idempotent: it is recomputed from the tickets' current state, and a ticket is
 * re-checked inside its own transaction before it is marked.
 */
export async function applyStripeChargeRefund(charge: any, opts?: { logPrefix?: string }): Promise<ChargeRefundResult> {
  const logPrefix = opts?.logPrefix || '[stripe]'
  const pi: string | null =
    typeof charge?.payment_intent === 'string' ? charge.payment_intent : charge?.payment_intent?.id || null
  const result: ChargeRefundResult = { paymentIntentId: pi, ticketsMatched: 0, markedRefunded: [], unallocatedCents: 0 }
  if (!pi) return result

  const byId = new Map<string, any>()
  for (const field of ['payment_id', 'payment_intent_id']) {
    const snap = await adminDb.collection('tickets').where(field, '==', pi).get()
    snap.docs.forEach((d: any) => byId.set(String(d.id), { id: String(d.id), ref: d.ref, data: d.data() || {} }))
  }
  const tickets = Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id))
  result.ticketsMatched = tickets.length
  if (tickets.length === 0) return result

  const isAccounted = (t: any) =>
    String(t.data.status || '').toLowerCase() === 'refunded' ||
    ACCOUNTED_REFUND_STATUSES.has(String(t.data.refund_status || '').toLowerCase())
  const accounted = tickets.filter(isAccounted)
  const candidates = tickets
    .filter((t) => !isAccounted(t) && !VOID_TICKET_STATUSES.has(String(t.data.status || '').toLowerCase()))
    // A refund should void the seat nobody has used yet before one already scanned.
    .sort((a, b) => Number(Boolean(a.data.checked_in || a.data.checked_in_at)) - Number(Boolean(b.data.checked_in || b.data.checked_in_at)))

  const amount = Math.max(0, Number(charge?.amount) || 0)
  const refunded = Math.max(0, Number(charge?.amount_refunded) || 0)
  const fullyRefunded = charge?.refunded === true || (amount > 0 && refunded >= amount)

  let toMark: any[] = []
  if (fullyRefunded) {
    toMark = candidates
  } else if (amount > 0 && refunded > 0) {
    const perTicketCents = Math.round(amount / tickets.length)
    const remaining = Math.max(0, refunded - accounted.length * perTicketCents)
    const n = perTicketCents > 0 ? Math.min(candidates.length, Math.floor((remaining + 1) / perTicketCents)) : 0
    toMark = candidates.slice(0, n)
    result.unallocatedCents = Math.max(0, remaining - n * perTicketCents)
  }

  const refunds: any[] = Array.isArray(charge?.refunds?.data) ? charge.refunds.data : []
  const latestRefundId = refunds.length > 0 ? String(refunds[0]?.id || '') || null : null
  const nowIso = new Date().toISOString()

  for (const t of toMark) {
    const marked = await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(t.ref)
      const cur = snap.exists ? snap.data() || {} : {}
      if (isAccounted({ data: cur }) || VOID_TICKET_STATUSES.has(String(cur.status || '').toLowerCase())) return false
      tx.set(
        t.ref,
        {
          status: 'refunded',
          refund_status: 'approved',
          // Same units refundExecution records: what the buyer was charged.
          refund_amount: Number(cur.charged_amount) || Number(cur.price_paid) || 0,
          refund_currency: String(cur.charged_currency || cur.currency || charge?.currency || 'USD').toUpperCase(),
          // Face value in the EVENT currency (no buyer fee): what payouts subtract.
          refund_face_amount: refundFaceAmount(cur),
          refund_id: latestRefundId,
          refund_source: 'stripe_charge_refunded',
          refund_error: null,
          refund_processed_at: nowIso,
          updated_at: nowIso,
        },
        { merge: true }
      )
      return true
    })
    if (marked) result.markedRefunded.push(t.id)
  }

  // The promoter's commission goes with each refunded ticket. Reversal is per
  // ticket share (lib/promoters reversePromoterSaleForTicket), so every ticket
  // marked here is reversed — a partial refund takes back only its tickets'
  // share, and a full refund takes back the whole order.
  for (const id of result.markedRefunded) {
    await reversePromoterCommission(id, 'stripe_charge_refunded')
  }

  if (result.unallocatedCents > 0) {
    console.error(`${logPrefix} RECONCILE: partial Stripe refund does not map to whole tickets`, {
      paymentIntentId: pi,
      unallocatedCents: result.unallocatedCents,
    })
  }

  await orderRefFor(pi)
    .set(
      {
        stripe_amount_refunded: refunded,
        stripe_fully_refunded: fullyRefunded,
        refund_unallocated_cents: result.unallocatedCents,
        ...(result.unallocatedCents > 0 ? { needs_reconcile: true } : {}),
        updated_at: nowIso,
      },
      { merge: true }
    )
    .catch(() => undefined)

  return result
}
