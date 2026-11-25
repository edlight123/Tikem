/**
 * WHERE A SALE'S MONEY PHYSICALLY SITS — the funds rail.
 *
 * `payment_method` says how the buyer paid. It does not say whose account the
 * money landed in, and two sales with the same method can land in different
 * places: a card sale on a US event is a destination charge (the organizer's
 * own Stripe account), a card sale on a Haiti event is a plain platform charge
 * (Tikèm's Stripe balance, paid out to the organizer later over MonCash or a
 * bank wire). Reconciliation (Money → Money map) needs the second answer.
 *
 *  - moncash          Tikèm's MonCash merchant account (Digicel). NatCash over
 *                     the MonCash Button gateway settles here too.
 *  - sogepay          Tikèm's Sogebank merchant account.
 *  - stripe_platform  Tikèm's own Stripe balance (no Connect destination).
 *  - stripe_connect   The organizer's connected Stripe account. Tikèm holds none of it.
 *  - paypal           Tikèm's PayPal balance.
 *  - cash             Paid in person at the door. The organizer holds it.
 *  - free             No money moved.
 *
 * Every order and ticket written from 2026-11-24 carries `funds_rail`.
 * Older docs do not; `resolveFundsRail` infers it from the fields they do
 * carry, so reports work without a backfill (scripts/backfill-funds-rail.mjs
 * writes the inferred value when you want it stored).
 */

export const FUNDS_RAILS = [
  'moncash',
  'sogepay',
  'stripe_platform',
  'stripe_connect',
  'paypal',
  'cash',
  'free',
] as const

export type FundsRail = (typeof FUNDS_RAILS)[number]

/** Rails whose money Tikèm holds and must pay out to the organizer itself. */
export const TIKEM_HELD_RAILS: ReadonlySet<FundsRail> = new Set<FundsRail>([
  'moncash',
  'sogepay',
  'stripe_platform',
  'paypal',
])

export function isFundsRail(value: unknown): value is FundsRail {
  return typeof value === 'string' && (FUNDS_RAILS as readonly string[]).includes(value)
}

const FREE_METHODS = new Set(['free', 'comp', 'complimentary', 'rsvp', 'guest_list'])
const CASH_METHODS = new Set(['pay_at_door', 'cash', 'door', 'door_cash'])
const MONCASH_METHODS = new Set(['moncash', 'natcash', 'moncash_button', 'mobile_money'])
const STRIPE_METHODS = new Set(['stripe', 'card', 'stripe_platform'])

/**
 * The rail for a sale being written NOW, from what the writer knows.
 * `destinationCharge` is true when the card charge carried a Connect destination.
 */
export function fundsRailForPaymentMethod(
  method: unknown,
  opts: { destinationCharge?: boolean | null } = {}
): FundsRail | null {
  const m = String(method ?? '').toLowerCase().trim()
  if (!m) return null
  if (FREE_METHODS.has(m)) return 'free'
  if (CASH_METHODS.has(m)) return 'cash'
  if (MONCASH_METHODS.has(m)) return 'moncash'
  if (m === 'sogepay') return 'sogepay'
  if (m === 'paypal') return 'paypal'
  if (m === 'stripe_connect') return 'stripe_connect'
  if (STRIPE_METHODS.has(m)) return opts.destinationCharge ? 'stripe_connect' : 'stripe_platform'
  return null
}

function positive(value: unknown): boolean {
  const n = Number(value)
  return Number.isFinite(n) && n > 0
}

/**
 * The rail of any stored order or ticket doc (tickets, stripe_orders,
 * pending_transactions). A stored `funds_rail` wins; otherwise it is inferred:
 *
 *  1. `payment_method` / `paymentMethod` / `method` (+ a Connect destination
 *     on the doc for a card sale: `stripe_connect_account_id`,
 *     `stripeConnectAccountId`, `transfer_destination`, or
 *     `payout_provider: 'stripe_connect'`);
 *  2. a comp source, or nothing paid at all → free;
 *  3. a `pi_` payment reference with no method → stripe_platform (pre-Connect
 *     card sales were platform charges);
 *  4. otherwise null — the caller reports it as unknown rather than guessing.
 */
export function resolveFundsRail(doc: Record<string, any> | null | undefined): FundsRail | null {
  if (!doc) return null
  if (isFundsRail(doc.funds_rail)) return doc.funds_rail

  const destination =
    Boolean(doc.stripe_connect_account_id || doc.stripeConnectAccountId || doc.transfer_destination) ||
    String(doc.payout_provider ?? doc.payoutProvider ?? '').toLowerCase() === 'stripe_connect'

  const method = doc.payment_method ?? doc.paymentMethod ?? doc.method
  const fromMethod = fundsRailForPaymentMethod(method, { destinationCharge: destination })
  if (fromMethod) return fromMethod

  const source = String(doc.source ?? '').toLowerCase().trim()
  if (source === 'comp' || source === 'guest_list') return 'free'

  const paid = positive(doc.price_paid ?? doc.pricePaid ?? doc.price) || positive(doc.charged_amount) || positive(doc.amount)
  if (!paid) return 'free'

  const ref = String(doc.payment_intent_id || doc.payment_id || doc.paymentIntentId || '').trim()
  if (ref.startsWith('pi_') || ref.startsWith('cs_')) return destination ? 'stripe_connect' : 'stripe_platform'

  return null
}
