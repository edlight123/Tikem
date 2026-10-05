/**
 * WHO PAID THE PLATFORM FEE ON ONE TICKET — the one rule.
 *
 * Shared by the payout engine (lib/payouts/availability.ts) and the derived
 * earnings view (lib/earnings.ts) so the two can never disagree about the same
 * ticket. 'buyer' means the buyer was charged the fee on top of face value, so
 * the organizer nets face value and no fee is deducted from them.
 *
 * A `fee_incidence: 'buyer'` stamp is honoured only with proof it was charged:
 *
 *  - the Stripe rails (stripe, stripe_connect), whose checkout has priced the
 *    fee on top of face value since buyer-pays shipped; or
 *  - `buyer_fee_charged` > 0: the per-ticket fee, in the EVENT currency's minor
 *    units, stamped server-side by lib/tickets/fulfillment.ts from the order the
 *    gateway was asked to collect (MonCash / NatCash / SogePay pass-on).
 *    Clients cannot write it (firestore.rules: ticket updates are check-in
 *    fields only, creates are denied).
 *
 * A 'buyer' stamp on any other ticket (the MonCash callback once copied it from
 * the client-editable event setting while charging face value) stays
 * 'organizer', so a fee nobody paid is never waived.
 */

export const BUYER_FEE_RAILS: ReadonlySet<string> = new Set(['stripe', 'stripe_connect'])

/** The server-stamped per-ticket buyer fee, event-currency minor units; 0 when absent. */
export function buyerFeeChargedMinor(ticket: any): number {
  const n = Number(ticket?.buyer_fee_charged ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

export function ticketFeeIncidence(ticket: any): 'buyer' | 'organizer' {
  const stamped = String(ticket?.fee_incidence ?? ticket?.feeIncidence ?? '').toLowerCase().trim()
  if (stamped !== 'buyer') return 'organizer'
  const rail = String(ticket?.payment_method ?? '').toLowerCase().trim()
  if (BUYER_FEE_RAILS.has(rail)) return 'buyer'
  return buyerFeeChargedMinor(ticket) > 0 ? 'buyer' : 'organizer'
}
