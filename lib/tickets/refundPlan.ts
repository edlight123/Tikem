import { isLiveTicketStatus } from '@/lib/tickets/status'

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
 * The amount is what the BUYER paid for this ticket, in the currency they were
 * charged in (`charged_amount` / `charged_currency`). A Stripe sale for an HTG
 * event is charged in USD, so refunding `price_paid` (the HTG face value) would
 * send the wrong number to Stripe.
 */

export type RefundRail = 'stripe' | 'stripe_connect' | 'manual'

export type RefundIneligibleReason =
  | 'free'
  | 'not_live'
  | 'already_refunded'
  | 'refund_in_progress'
  | 'no_payment_reference'
  | 'amount_unknown'

export type RefundPlan =
  | { eligible: true; rail: RefundRail; amount: number; currency: string; paymentRef: string | null }
  | { eligible: false; reason: RefundIneligibleReason }

const STRIPE_METHODS = new Set(['stripe', 'stripe_connect', 'card'])
const FREE_METHODS = new Set(['free', 'comp', 'complimentary', 'rsvp'])
// A refund that has started (or is waiting on a human) must not be started twice.
const IN_FLIGHT_REFUND_STATUSES = new Set(['processing', 'manual_required', 'approved'])

function positive(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function upper(value: unknown, fallback: string): string {
  const s = String(value ?? '').trim().toUpperCase()
  return s || fallback
}

export function planTicketRefund(ticket: Record<string, any>): RefundPlan {
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
    return {
      eligible: true,
      rail: method === 'stripe_connect' ? 'stripe_connect' : 'stripe',
      amount: roundMoney(amount),
      currency,
      paymentRef: ref,
    }
  }

  const amount = charged || pricePaid
  const currency = charged ? upper(ticket?.charged_currency, ticketCurrency) : ticketCurrency
  return {
    eligible: true,
    rail: 'manual',
    amount: roundMoney(amount),
    currency,
    paymentRef: String(ticket?.transaction_id || ticket?.payment_id || '').trim() || null,
  }
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
