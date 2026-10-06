import { isLiveTicketStatus } from '@/lib/tickets/status'
import { buyerFeeChargedMinor, ticketFeeIncidence } from '@/lib/payouts/fee-incidence'

/**
 * What an organizer-initiated refund of ONE ticket would do — decided from the
 * ticket document alone, so the order list (which shows the amount in the
 * confirmation sheet) and the refund route (which moves the money) can never
 * disagree about the figure or the rail.
 *
 * Rails:
 *   - `stripe`          platform charge — a plain Stripe refund
 *   - `stripe_connect`  destination charge — the refund pulls the money back out
 *                       of the organizer's connected account (reverse_transfer)
 *                       and returns Tikèm's application fee
 *   - `manual`          MonCash / NatCash / SogePay — no refund API, so the
 *                       ticket is voided now and the payout is queued for an
 *                       admin (the same path event cancellation uses)
 *
 * The amount is in the currency the buyer was charged in (`charged_amount` /
 * `charged_currency`). A Stripe sale for an HTG event is charged in USD, so
 * refunding `price_paid` (the HTG face value) would send the wrong number to
 * Stripe.
 *
 * THE SERVICE FEE IS NON-REFUNDABLE (owner decision, 2026-10). A refund the
 * buyer asked for, or one an organizer issues on their own, returns the FACE
 * value only: the buyer service fee (pass-on) stays with Tikèm, and so does
 * Tikèm's platform fee on an organizer-absorbs ticket. Only an event
 * cancellation or an organizer/admin "event changed" refund returns the whole
 * charge, fee included (`includeServiceFee`, see refundIncludesServiceFee).
 */

export type RefundRail = 'stripe' | 'stripe_connect' | 'manual'

export type RefundIneligibleReason =
  | 'free'
  | 'not_live'
  | 'already_refunded'
  | 'refund_in_progress'
  | 'no_payment_reference'
  | 'amount_unknown'

/**
 * Whether Tikèm's fee goes back with the refund.
 *   - 'retained'  buyer-requested / organizer-initiated: face value only, the
 *                 buyer service fee and Tikèm's platform fee stay earned
 *   - 'refunded'  event cancelled or changed: the whole charge, fee included
 */
export type RefundFeePolicy = 'retained' | 'refunded'

export type RefundPlan =
  | {
      eligible: true
      rail: RefundRail
      /** What goes back to the buyer, in `currency` (the charged currency). */
      amount: number
      currency: string
      paymentRef: string | null
      /** Absent on plans built by hand (legacy callers): read as 'refunded'. */
      feePolicy?: RefundFeePolicy
      /** The buyer service fee on this ticket, charged currency (0 when the organizer absorbed it). */
      buyerFee?: number
    }
  | { eligible: false; reason: RefundIneligibleReason }

export type PlanRefundOptions = {
  /** True only for an event cancellation or an "event changed" refund. */
  includeServiceFee?: boolean
}

const STRIPE_METHODS = new Set(['stripe', 'stripe_connect', 'card'])
const FREE_METHODS = new Set(['free', 'comp', 'complimentary', 'rsvp'])
// A refund that has started (or is waiting on a human) must not be started twice.
// 'admin_review': the organizer's balance could not cover it and a Tikèm admin
// decides (lib/tickets/refundExecution.ts); only that approval re-plans it.
export const IN_FLIGHT_REFUND_STATUSES = new Set(['processing', 'manual_required', 'approved', 'admin_review'])

function positive(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function upper(value: unknown, fallback: string): string {
  const s = String(value ?? '').trim().toUpperCase()
  return s || fallback
}

export function planTicketRefund(ticket: Record<string, any>, options: PlanRefundOptions = {}): RefundPlan {
  const feePolicy: RefundFeePolicy = options.includeServiceFee ? 'refunded' : 'retained'
  const status = String(ticket?.status ?? '').toLowerCase().trim()
  if (status === 'refunded') return { eligible: false, reason: 'already_refunded' }
  if (status === 'refund_pending') return { eligible: false, reason: 'refund_in_progress' }
  if (!isLiveTicketStatus(status)) return { eligible: false, reason: 'not_live' }

  const refundStatus = String(ticket?.refund_status ?? '').toLowerCase().trim()
  if (IN_FLIGHT_REFUND_STATUSES.has(refundStatus)) {
    return { eligible: false, reason: refundStatus === 'approved' ? 'already_refunded' : 'refund_in_progress' }
  }

  const method = String(ticket?.payment_method ?? '').toLowerCase().trim()
  const source = String(ticket?.source ?? '').toLowerCase().trim()
  const pricePaid = positive(ticket?.price_paid ?? ticket?.price)
  const charged = positive(ticket?.charged_amount)

  if (FREE_METHODS.has(method) || source === 'comp' || (pricePaid === 0 && charged === 0)) {
    return { eligible: false, reason: 'free' }
  }

  const ticketCurrency = upper(ticket?.original_currency ?? ticket?.currency, 'HTG')

  if (STRIPE_METHODS.has(method)) {
    const ref = String(ticket?.payment_intent_id || ticket?.payment_id || '').trim()
    // Only a PaymentIntent id can be refunded through processStripeRefund.
    if (!ref.startsWith('pi_')) return { eligible: false, reason: 'no_payment_reference' }

    let amount = charged
    let currency = upper(ticket?.charged_currency, 'USD')
    if (!amount) {
      // Older tickets carry no charged amount. Stripe charged in USD, so the face
      // value is only safe to send when the face value is itself USD.
      if (ticketCurrency !== 'USD') return { eligible: false, reason: 'amount_unknown' }
      amount = pricePaid
      currency = 'USD'
    }
    const buyerFee = charged ? ticketBuyerFeeCharged(ticket, amount, currency) : 0
    return {
      eligible: true,
      rail: method === 'stripe_connect' ? 'stripe_connect' : 'stripe',
      amount: roundMoney(feePolicy === 'refunded' ? amount : amount - buyerFee),
      currency,
      paymentRef: ref,
      feePolicy,
      buyerFee,
    }
  }

  const amount = charged || pricePaid
  const currency = charged ? upper(ticket?.charged_currency, ticketCurrency) : ticketCurrency
  const buyerFee = charged ? ticketBuyerFeeCharged(ticket, amount, currency) : 0
  return {
    eligible: true,
    rail: 'manual',
    amount: roundMoney(feePolicy === 'refunded' ? amount : amount - buyerFee),
    currency,
    paymentRef: String(ticket?.transaction_id || ticket?.payment_id || '').trim() || null,
    feePolicy,
    buyerFee,
  }
}

/**
 * The buyer service fee carried by ONE ticket, in the CHARGED currency (major
 * units), out of `total` (what the buyer paid for it). 0 when the organizer
 * absorbed the fee (lib/payouts/fee-incidence.ts is the one rule for that).
 *
 * Read, in order of trust:
 *   1. `buyer_fee_charged_amount`, stamped at fulfillment in the charged currency
 *   2. `buyer_fee_charged` (event-currency minor units, the server-stamped proof
 *      on MonCash / NatCash / SogePay pass-on): its share of face + fee, which
 *      is the same in any currency, applied to the charged total
 *   3. the charged total less the face value, when both are in one currency
 *   4. the charged total less face × `exchange_rate_used` (a USD card charge for
 *      an HTG event: the rate the face was converted at)
 * A fee that cannot be worked out is 0: the buyer gets the whole charge back
 * rather than a guessed figure.
 */
export function ticketBuyerFeeCharged(ticket: Record<string, any>, total: number, chargedCurrency: string): number {
  if (!(total > 0) || ticketFeeIncidence(ticket) !== 'buyer') return 0
  const clamp = (fee: number) => (fee > 0 && fee < total ? roundMoney(fee) : 0)

  const stamped = positive(ticket?.buyer_fee_charged_amount)
  if (stamped > 0) return clamp(Math.min(stamped, total))

  const face = positive(ticket?.price_paid ?? ticket?.price)
  const feeEventMinor = buyerFeeChargedMinor(ticket)
  if (feeEventMinor > 0 && face > 0) {
    return clamp((total * feeEventMinor) / (Math.round(face * 100) + feeEventMinor))
  }
  if (face <= 0) return 0

  const ticketCurrency = upper(ticket?.original_currency ?? ticket?.currency, 'HTG')
  if (ticketCurrency === chargedCurrency) return clamp(total - face)

  const rate = positive(ticket?.exchange_rate_used)
  if (rate > 0) return clamp(total - roundMoney(face * rate))
  return 0
}

/**
 * Does this refund return the service fee? Only for an event cancellation (the
 * sweep in lib/events/cancel.ts) or when a Tikèm admin approves a refund as
 * cancelled / "event changed". Everything else (a buyer's request, an
 * organizer's own refund) keeps it: "Service fee is non-refundable unless the
 * event is cancelled." Decided from TRUSTED flags only, never from a reason
 * string a client sent.
 */
export function refundIncludesServiceFee(input: {
  cancellation?: boolean
  adminApprovedServiceFeeRefund?: boolean
}): boolean {
  return input.cancellation === true || input.adminApprovedServiceFeeRefund === true
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

/** Sum eligible plans per currency — never across currencies. */
export function sumRefundsByCurrency(plans: RefundPlan[]): { currency: string; amount: number }[] {
  const totals = new Map<string, number>()
  for (const plan of plans) {
    if (!plan.eligible) continue
    totals.set(plan.currency, (totals.get(plan.currency) || 0) + plan.amount)
  }
  return Array.from(totals.entries())
    .map(([currency, amount]) => ({ currency, amount: roundMoney(amount) }))
    .sort((a, b) => b.amount - a.amount)
}

function positiveMoney(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * The FACE value a whole-ticket refund takes out of the organizer's gross, in
 * the EVENT currency (major units). `refund_amount` is what the buyer gets back
 * in the CHARGED currency (the buyer fee included only when the policy refunds it); the payout engine
 * (lib/payouts/availability.ts ticketRefundedFaceMinor) subtracts this instead.
 */
export function refundFaceAmount(ticket: Record<string, any> | null | undefined): number {
  return Math.round(positiveMoney(ticket?.price_paid ?? ticket?.pricePaid ?? ticket?.price) * 100) / 100
}
