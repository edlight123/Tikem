/**
 * lib/tickets/stripe-fulfillment with add-ons: the order's add-ons are booked
 * on its FIRST ticket (whose charge includes them, so the per-ticket refund
 * flow returns them), the rest of the charge is split over the tickets exactly
 * as before, stock converts with the seats, and the earnings ledger counts the
 * add-ons as part of what the organizer sold.
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
  convertSeatHold: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/lib/refunds', () => ({
  isDestinationCharge: jest.fn(async () => null),
  processStripeRefund: jest.fn(async () => ({ success: true, refundId: 're_1' })),
}))
jest.mock('@/lib/tickets/refundExecution', () => ({ reversePromoterCommission: jest.fn(async () => true) }))

/* eslint-disable @typescript-eslint/no-var-requires */
const { addTicketToEarnings } = require('@/lib/earnings')
const { convertSeatHold } = require('@/lib/tickets/inventory')
const { processStripeRefund } = require('@/lib/refunds')
const { fulfillStripeOrder } = require('@/lib/tickets/stripe-fulfillment') as typeof import('@/lib/tickets/stripe-fulfillment')
const { planTicketRefund } = require('@/lib/tickets/refundPlan')
type StripeOrderInput = import('@/lib/tickets/stripe-fulfillment').StripeOrderInput

// GA $25 x2 + Iftar meal $15 x2, CA, fee passed on: face 80, fee 3.98, charged 83.98.
// The add-ons' fee share is floor(398 x 3000 / 8000) = 149.
function order(md: Record<string, any> = {}, over: Partial<StripeOrderInput> = {}): StripeOrderInput {
  return {
    source: 'payment_intent',
    paymentId: 'pi_1',
    paymentIntentId: 'pi_1',
    metadata: {
      eventId: 'evt1',
      userId: 'u1',
      quantity: '2',
      tierId: '',
      tierName: '2x GA',
      originalCurrency: 'CAD',
      feeIncidence: 'buyer',
      faceValueCents: '8000',
      buyerFeeCents: '398',
      t: JSON.stringify([['ga', 2, 25, 25]]),
      ao: JSON.stringify([['ao_meal', '', 2, 15]]),
      aoFaceCents: '3000',
      aoFeeCents: '149',
      ...md,
    },
    buyerId: 'u1',
    guestRecipient: null,
    amountTotalCents: 8398,
    chargedCurrency: 'cad',
    destinationCharge: false,
    logPrefix: '[test]',
    ...over,
  }
}

const tickets = () =>
  mockFake
    .all('tickets')
    .map(([id, d]) => ({ id, ...d }))
    .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)))

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

beforeEach(() => {
  jest.clearAllMocks()
  mockFake.reset()
  mockFake.seed('events', 'evt1', {
    title: 'Iftar gala',
    organizer_id: 'org1',
    currency: 'CAD',
    country: 'CA',
    add_ons: [{ id: 'ao_meal', name: 'Iftar meal', price: 15, quantity: 100 }],
  })
  mockFake.seed('users', 'u1', { email: 'u@x.com', full_name: 'U' })
  mockFake.seed('ticket_tiers', 'ga', { name: 'GA', event_id: 'evt1' })
})

describe('fulfilment with add-ons', () => {
  it('books the add-ons on the first ticket; every cent of the charge lands on a ticket', async () => {
    const res = await fulfillStripeOrder(order())
    expect(res.outcome).toBe('fulfilled')
    const all = tickets()
    expect(all).toHaveLength(2)
    const lead = all.find((t: any) => Array.isArray(t.add_ons))!
    const other = all.find((t: any) => t !== lead)!
    expect(lead.add_ons).toEqual([
      expect.objectContaining({ id: 'ao_meal', name: 'Iftar meal', option: null, quantity: 2, unit_price: 15, face_total: 30 }),
    ])
    expect(other.add_ons_ticket_id).toBe(lead.id)
    // The tickets keep their own face value; only the lead ticket's charge grows.
    expect(all.map((t: any) => t.price_paid)).toEqual([25, 25])
    const chargedCents = all.reduce((s: number, t: any) => s + Math.round(t.charged_amount * 100), 0)
    const feeCents = all.reduce((s: number, t: any) => s + Math.round(t.buyer_fee_charged_amount * 100), 0)
    expect(chargedCents).toBe(8398)
    expect(feeCents).toBe(398)
    expect(Math.round(lead.add_ons_charged_amount * 100)).toBe(3149)
    const order1 = mockFake.get('stripe_orders', 'pi_1')!
    expect(order1.add_on_lines).toHaveLength(1)
    expect(order1.add_ons_ticket_id).toBe(lead.id)
  })

  it('converts the add-on stock with the seats', async () => {
    await fulfillStripeOrder(order())
    expect(convertSeatHold).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 2, addOnIncrements: [{ addOnId: 'ao_meal', quantity: 2 }] })
    )
  })

  it('counts the add-ons in the organizer’s earnings (tickets 50 + add-ons 30)', async () => {
    await fulfillStripeOrder(order())
    expect(addTicketToEarnings).toHaveBeenCalledWith('evt1', 8000, 2, expect.objectContaining({ chargedAmountCents: 8398 }))
  })

  it('a refund of the first ticket returns its face AND its add-ons (fee retained)', async () => {
    await fulfillStripeOrder(order())
    const lead = tickets().find((t: any) => Array.isArray(t.add_ons))!
    const plan = planTicketRefund({ ...lead, payment_intent_id: 'pi_1' })
    expect(plan.eligible).toBe(true)
    // 25 face + 30 add-ons; the service fee stays non-refundable.
    expect(plan.amount).toBe(55)
    expect(planTicketRefund({ ...lead, payment_intent_id: 'pi_1' }, { includeServiceFee: true }).amount).toBe(
      Math.round(lead.charged_amount * 100) / 100
    )
  })

  it('refunds instead of guessing when the add-on lines are unreadable', async () => {
    const res = await fulfillStripeOrder(order({ ao: 'garbage' }))
    expect(res.outcome).toBe('capacity_refunded')
    expect(processStripeRefund).toHaveBeenCalled()
    expect(tickets()).toHaveLength(0)
  })

  it('an order without add-ons is untouched', async () => {
    await fulfillStripeOrder(
      order({ ao: undefined, aoFaceCents: undefined, aoFeeCents: undefined, faceValueCents: '5000', buyerFeeCents: '293' }, { amountTotalCents: 5293 })
    )
    const all = tickets()
    expect(all.every((t: any) => t.add_ons === undefined && t.add_ons_ticket_id === undefined)).toBe(true)
    expect(all.reduce((s: number, t: any) => s + Math.round(t.charged_amount * 100), 0)).toBe(5293)
  })

  it('Haiti card (HTG priced, USD charged on the platform): add-ons convert at the stamped rate', async () => {
    mockFake.seed('events', 'evt1', {
      title: 'Konpa night',
      organizer_id: 'org1',
      currency: 'HTG',
      country: 'HT',
      add_ons: [{ id: 'ao_bottle', name: 'Bottle package', price: 5000, quantity: 10 }],
    })
    mockFake.seed('ticket_tiers', 'vip', { name: 'VIP', event_id: 'evt1' })
    const res = await fulfillStripeOrder(
      order(
        {
          quantity: '1',
          tierName: '1x VIP',
          originalCurrency: 'HTG',
          feeIncidence: 'organizer',
          faceValueCents: '7600',
          buyerFeeCents: '0',
          exchangeRate: String(1 / 131.58),
          fxBaseRate: '131.58',
          payoutProvider: 'stripe_platform',
          fundsRail: 'stripe_platform',
          t: JSON.stringify([['vip', 1, 5000, 5000]]),
          ao: JSON.stringify([['ao_bottle', '', 1, 5000]]),
          aoFaceCents: '3800',
          aoFeeCents: '0',
        },
        { amountTotalCents: 7600, chargedCurrency: 'usd' }
      )
    )
    expect(res.outcome).toBe('fulfilled')
    const [lead] = tickets()
    // The ticket and its add-ons: face in HTG (what the organizer sold), charge in USD.
    expect(lead.price_paid).toBe(5000)
    expect(lead.add_ons_face_total).toBe(5000)
    expect(lead.add_ons).toEqual([expect.objectContaining({ id: 'ao_bottle', face_total: 5000, charged_amount: 38 })])
    expect(lead.charged_amount).toBe(76)
    expect(lead.funds_rail).toBe('stripe_platform')
    // Earnings in the EVENT currency: 5,000 + 5,000 HTG.
    expect(addTicketToEarnings).toHaveBeenCalledWith('evt1', 1_000_000, 1, expect.objectContaining({ chargedAmountCents: 7600 }))
  })

  it('a free ticket on a single-price event + a paid add-on takes the free claim; the same buyer cannot repeat it', async () => {
    // A legacy single-price event (no tiers): no per-tier breakdown on the intent.
    const legacy = (paymentId: string) =>
      order(
        {
          quantity: '1',
          tierName: 'General Admission',
          t: undefined,
          originalPrice: '0',
          finalPrice: '0',
          priceInOriginalCurrency: '0',
          faceValueCents: '1500',
          buyerFeeCents: '0',
          feeIncidence: 'organizer',
          ao: JSON.stringify([['ao_meal', '', 1, 15]]),
          aoFaceCents: '1500',
          aoFeeCents: '0',
        },
        { paymentId, paymentIntentId: paymentId, amountTotalCents: 1500 }
      )
    const first = await fulfillStripeOrder(legacy('pi_a'))
    expect(first.outcome).toBe('fulfilled')
    expect(mockFake.all('free_claim_locks')).toHaveLength(1)

    const second = await fulfillStripeOrder(legacy('pi_b'))
    expect(second.outcome).toBe('capacity_refunded')
    expect(processStripeRefund).toHaveBeenCalled()
    // Only the first order's ticket exists.
    expect(tickets().filter((t: any) => t.payment_id === 'pi_b' || t.payment_intent_id === 'pi_b')).toHaveLength(0)
  })
})
