/**
 * lib/tickets/stripe-fulfillment, multi-tier card orders: a cart of VIP x1 +
 * GA x2 used to be issued as three VIP tickets. The per-tier breakdown now rides
 * on the PaymentIntent (metadata `t`, lib/checkout/card-order-lines) and every
 * tier is issued, priced and counted on its own. Legacy single-tier metadata is
 * covered here too, since older PaymentIntents and the mobile app still send it.
 *
 * @jest-environment node
 */

import { createFakeFirestore } from './helpers/fakeFirestoreTracking'

const mockFake = createFakeFirestore()

jest.mock('@/lib/firebase/admin', () => ({ adminDb: mockFake.db }))
jest.mock('firebase-admin/firestore', () => require('./helpers/fakeFirestoreTracking').fieldValueModule)
jest.mock('@/lib/earnings', () => ({ addTicketToEarnings: jest.fn(async () => undefined) }))
jest.mock('@/lib/tickets/confirmation', () => ({ sendTicketConfirmation: jest.fn(async () => ({})) }))
jest.mock('@/lib/notifications/helpers', () => ({
  notifyTicketPurchase: jest.fn(async () => undefined),
  notifyOrganizerTicketSale: jest.fn(async () => undefined),
}))
jest.mock('@/lib/notifications/campaigns', () => ({ onSaleCompleted: jest.fn(async () => undefined) }))
jest.mock('@/lib/tracking-links', () => ({ recordAttributedSale: jest.fn(async () => null) }))
jest.mock('@/lib/guest/identity', () => ({ attachTicketsToGuestOrder: jest.fn(async () => undefined) }))
jest.mock('@/lib/promo-codes', () => ({
  promoBuyerKey: jest.fn(() => 'uid:u1'),
  redeemPromoInTransaction: jest.fn(async () => ({ redeemed: true, capReached: false })),
}))
jest.mock('@/lib/tickets/inventory', () => ({
  buildTierSoldIncrements: jest.fn((lines: any[]) => lines),
  reserveInventoryAtomic: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/lib/refunds', () => ({
  isDestinationCharge: jest.fn(async () => null),
  processStripeRefund: jest.fn(async () => ({ success: true, refundId: 're_1' })),
}))
jest.mock('@/lib/tickets/refundExecution', () => ({ reversePromoterCommission: jest.fn(async () => true) }))

/* eslint-disable @typescript-eslint/no-var-requires */
const { addTicketToEarnings } = require('@/lib/earnings')
const { buildTierSoldIncrements, reserveInventoryAtomic } = require('@/lib/tickets/inventory')
const { redeemPromoInTransaction } = require('@/lib/promo-codes')
const { fulfillStripeOrder, planMultiTierTickets } =
  require('@/lib/tickets/stripe-fulfillment') as typeof import('@/lib/tickets/stripe-fulfillment')
type StripeOrderInput = import('@/lib/tickets/stripe-fulfillment').StripeOrderInput

function order(md: Record<string, any>, over: Partial<StripeOrderInput> = {}): StripeOrderInput {
  return {
    source: 'payment_intent',
    paymentId: 'pi_1',
    paymentIntentId: 'pi_1',
    metadata: { eventId: 'evt1', userId: 'u1', ...md },
    buyerId: 'u1',
    guestRecipient: null,
    amountTotalCents: 0,
    chargedCurrency: 'usd',
    destinationCharge: false,
    logPrefix: '[test]',
    ...over,
  }
}

// VIP $45 x1 + GA $22.50 x2 + a free tier x1, after a 10% promo; US, fee passed on.
// Face 90.00; fee 6% of 90 = 5.40 + 3 paid tickets x 0.99 = 8.37; charged 98.37.
const multi = (md: Record<string, any> = {}) =>
  order(
    {
      quantity: '4',
      tierId: '',
      tierName: '1x VIP, 2x GA, 1x Free RSVP',
      originalCurrency: 'USD',
      feeIncidence: 'buyer',
      buyerFeeCents: '837',
      t: JSON.stringify([
        ['vip', 1, 45, 50],
        ['ga', 2, 22.5, 25],
        ['free', 1, 0, 0],
      ]),
      ...md,
    },
    { amountTotalCents: 9837 }
  )

const tickets = () => mockFake.all('tickets').map(([id, d]) => ({ id, ...d }))

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

beforeEach(() => {
  jest.clearAllMocks()
  mockFake.reset()
  mockFake.seed('events', 'evt1', { title: 'Show', organizer_id: 'org1', currency: 'USD', country: 'US' })
  mockFake.seed('users', 'u1', { email: 'u@x.com', full_name: 'U' })
  mockFake.seed('ticket_tiers', 'vip', { name: 'VIP', event_id: 'evt1' })
  mockFake.seed('ticket_tiers', 'ga', { name: 'GA', event_id: 'evt1' })
  mockFake.seed('ticket_tiers', 'free', { name: 'Free RSVP', event_id: 'evt1' })
})

describe('multi-tier issuance', () => {
  it('issues N tickets of EACH tier at its own price, not N copies of the first tier', async () => {
    const res = await fulfillStripeOrder(multi())
    expect(res.outcome).toBe('fulfilled')
    const all = tickets()
    expect(all).toHaveLength(4)
    const byTier = (id: string) => all.filter((t) => t.tier_id === id)
    expect(byTier('vip')).toHaveLength(1)
    expect(byTier('ga')).toHaveLength(2)
    expect(byTier('free')).toHaveLength(1)
    expect(byTier('vip')[0]).toEqual(expect.objectContaining({ price_paid: 45, tier_name: 'VIP', ticket_type: 'VIP' }))
    expect(byTier('ga').map((t) => t.price_paid)).toEqual([22.5, 22.5])
    expect(byTier('free')[0]).toEqual(
      expect.objectContaining({ price_paid: 0, charged_amount: 0, buyer_fee_charged_amount: 0, tier_name: 'Free RSVP' })
    )
    expect(mockFake.get('stripe_orders', 'pi_1')!.tier_lines).toHaveLength(3)
  })

  it('spreads the buyer fee over PAID tickets only, summing exactly to what the card paid', async () => {
    await fulfillStripeOrder(multi())
    const all = tickets()
    const feeCents = all.reduce((s, t) => s + Math.round(t.buyer_fee_charged_amount * 100), 0)
    const chargedCents = all.reduce((s, t) => s + Math.round(t.charged_amount * 100), 0)
    expect(feeCents).toBe(837)
    expect(chargedCents).toBe(9837)
    for (const t of all) {
      expect(t.fee_incidence).toBe('buyer')
      expect(Math.round(t.charged_amount * 100)).toBe(Math.round((t.price_paid + t.buyer_fee_charged_amount) * 100))
    }
  })

  it('drops the free lines when the buyer already holds a live free ticket (race with a free claim)', async () => {
    mockFake.seed('tickets', 'earlier-free', { event_id: 'evt1', attendee_id: 'u1', price_paid: 0, status: 'valid' })
    const res = await fulfillStripeOrder(multi())
    expect(res.outcome).toBe('fulfilled')
    const issued = tickets().filter((t) => t.id !== 'earlier-free')
    expect(issued).toHaveLength(3)
    expect(issued.some((t) => t.tier_id === 'free')).toBe(false)
    // The charge is untouched: the paid tickets still account for every cent.
    expect(issued.reduce((s, t) => s + Math.round(t.charged_amount * 100), 0)).toBe(9837)
  })

  it('reserves inventory per tier', async () => {
    await fulfillStripeOrder(multi())
    expect(buildTierSoldIncrements).toHaveBeenCalledWith([
      { tierId: 'vip', quantity: 1 },
      { tierId: 'ga', quantity: 2 },
      { tierId: 'free', quantity: 1 },
    ])
    expect((reserveInventoryAtomic as jest.Mock).mock.calls[0][0].quantity).toBe(4)
  })

  it('books earnings on the post-promo face total with PAID tickets only', async () => {
    await fulfillStripeOrder(multi())
    const [, grossCents, qty, opts] = (addTicketToEarnings as jest.Mock).mock.calls[0]
    expect(grossCents).toBe(9000)
    // The market's fixed fee is per paid ticket; the free RSVP must not carry one.
    expect(qty).toBe(3)
    expect(opts.feeIncidence).toBe('buyer')
  })

  it('records the promo discount summed per line', async () => {
    await fulfillStripeOrder(multi({ promoCodeId: 'promo1' }))
    const call = (redeemPromoInTransaction as jest.Mock).mock.calls[0][0]
    // VIP 5.00 + 2 x GA 2.50; the free line has nothing to discount.
    expect(call.discountApplied).toBe(10)
    expect(call.qty).toBe(4)
  })

  it('is idempotent: a re-run issues nothing more', async () => {
    await fulfillStripeOrder(multi())
    const again = await fulfillStripeOrder(multi())
    expect(again).toEqual(expect.objectContaining({ outcome: 'fulfilled', alreadyFulfilled: true }))
    expect(tickets()).toHaveLength(4)
  })

  it('unreadable tier lines are refunded, never issued', async () => {
    const res = await fulfillStripeOrder(multi({ t: '[["vip","x",45,50]]' }))
    expect(res.outcome).toBe('capacity_refunded')
    expect(tickets()).toHaveLength(0)
    expect(mockFake.get('stripe_orders', 'pi_1')!.refund_reason).toBe('invalid_order_lines')
  })

  it('a deleted tier still issues, named "Ticket"', async () => {
    mockFake.reset()
    mockFake.seed('events', 'evt1', { title: 'Show', organizer_id: 'org1', currency: 'USD' })
    mockFake.seed('users', 'u1', { email: 'u@x.com' })
    await fulfillStripeOrder(multi())
    expect(tickets().every((t) => t.tier_name === 'Ticket')).toBe(true)
  })
})

describe('planMultiTierTickets', () => {
  it('converts an HTG face value at the charge rate for charged_amount; price_paid stays in HTG', async () => {
    const plan = await planMultiTierTickets(
      [
        { tierId: 'vip', quantity: 1, unitPrice: 3000, unitOriginal: 3000 },
        { tierId: 'ga', quantity: 1, unitPrice: 1500, unitOriginal: 1500 },
      ],
      { chargeRate: 0.0076, buyerFeeCentsTotal: 0 }
    )
    expect(plan.map((p) => p.unitFace)).toEqual([3000, 1500])
    expect(plan.map((p) => p.charged)).toEqual([22.8, 11.4])
  })
})

describe('legacy single-tier metadata (old PaymentIntents, the mobile app)', () => {
  it('still issues N identical tickets of that one tier', async () => {
    const res = await fulfillStripeOrder(
      order(
        { tierId: 'ga', tierName: 'GA', quantity: '2', originalCurrency: 'EUR', priceInOriginalCurrency: '20', finalPrice: '20' },
        { amountTotalCents: 4400, chargedCurrency: 'eur' }
      )
    )
    expect(res.outcome).toBe('fulfilled')
    const all = tickets()
    expect(all).toHaveLength(2)
    for (const t of all) {
      expect(t).toEqual(expect.objectContaining({ tier_id: 'ga', tier_name: 'GA', price_paid: 20, charged_amount: 22 }))
    }
    expect(buildTierSoldIncrements).toHaveBeenCalledWith([{ tierId: 'ga', quantity: 2 }])
    expect((addTicketToEarnings as jest.Mock).mock.calls[0][1]).toBe(4000)
    expect((addTicketToEarnings as jest.Mock).mock.calls[0][2]).toBe(2)
  })
})
