/**
 * funds_rail: where a sale's money physically sits. New docs carry it; older
 * docs are placed by resolveFundsRail from the fields they do carry, so the
 * Money map works without a backfill.
 */
import { FUNDS_RAILS, fundsRailForPaymentMethod, isFundsRail, resolveFundsRail } from '@/lib/payouts/funds-rail'

describe('fundsRailForPaymentMethod (writers)', () => {
  it.each([
    ['moncash', {}, 'moncash'],
    ['natcash', {}, 'moncash'],
    ['sogepay', {}, 'sogepay'],
    ['paypal', {}, 'paypal'],
    ['stripe_connect', {}, 'stripe_connect'],
    ['stripe', {}, 'stripe_platform'],
    ['stripe', { destinationCharge: true }, 'stripe_connect'],
    ['card', {}, 'stripe_platform'],
    ['pay_at_door', {}, 'cash'],
    ['free', {}, 'free'],
    ['comp', {}, 'free'],
    ['STRIPE', {}, 'stripe_platform'],
  ] as const)('%s %j → %s', (method, opts, rail) => {
    expect(fundsRailForPaymentMethod(method, opts)).toBe(rail)
  })

  it('an unknown or empty method is not guessed', () => {
    expect(fundsRailForPaymentMethod('')).toBeNull()
    expect(fundsRailForPaymentMethod('bitcoin')).toBeNull()
  })
})

describe('resolveFundsRail (readers, historical docs)', () => {
  it('a stored funds_rail wins over everything else', () => {
    expect(resolveFundsRail({ funds_rail: 'paypal', payment_method: 'stripe' })).toBe('paypal')
  })

  it('ignores a stored value that is not a rail', () => {
    expect(resolveFundsRail({ funds_rail: 'nonsense', payment_method: 'moncash' })).toBe('moncash')
  })

  it('a card sale with a Connect destination on the doc is stripe_connect', () => {
    expect(resolveFundsRail({ payment_method: 'stripe', stripe_connect_account_id: 'acct_1' })).toBe('stripe_connect')
    expect(resolveFundsRail({ payment_method: 'card', payoutProvider: 'stripe_connect' })).toBe('stripe_connect')
  })

  it('a plain Stripe card sale (every Haiti card sale) is stripe_platform', () => {
    expect(resolveFundsRail({ payment_method: 'stripe', payment_id: 'pi_1', price_paid: 5000 })).toBe('stripe_platform')
  })

  it('a pending_transactions row is placed by its payment_method', () => {
    expect(resolveFundsRail({ order_id: 'o1', payment_method: 'natcash', amount: 1000 })).toBe('moncash')
    expect(resolveFundsRail({ order_id: 'o2', payment_method: 'sogepay', amount: 1000 })).toBe('sogepay')
  })

  it('door tickets are cash; comps and zero-price tickets are free', () => {
    expect(resolveFundsRail({ payment_method: 'pay_at_door', door_price: 500 })).toBe('cash')
    expect(resolveFundsRail({ source: 'comp', price_paid: 0 })).toBe('free')
    expect(resolveFundsRail({ price_paid: 0 })).toBe('free')
  })

  it('a paid doc with no method but a PaymentIntent is a Stripe platform charge', () => {
    expect(resolveFundsRail({ price_paid: 25, payment_intent_id: 'pi_9' })).toBe('stripe_platform')
  })

  it('a paid doc with nothing to go on is unknown, never guessed', () => {
    expect(resolveFundsRail({ price_paid: 25, payment_id: 'xyz' })).toBeNull()
    expect(resolveFundsRail(null)).toBeNull()
  })

  it('the rail list is the agreed vocabulary', () => {
    expect([...FUNDS_RAILS]).toEqual(['moncash', 'sogepay', 'stripe_platform', 'stripe_connect', 'paypal', 'cash', 'free'])
    expect(isFundsRail('stripe_platform')).toBe(true)
    expect(isFundsRail('stripe')).toBe(false)
  })
})
