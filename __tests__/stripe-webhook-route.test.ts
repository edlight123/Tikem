/**
 * Stripe webhook route + the helpers it leans on: response codes per
 * fulfilment outcome, charge.refunded wiring, the per-user ticket limit and the
 * quantity-aware promo pricing check.
 *
 * @jest-environment node
 */

import { createFakeFirestore } from './helpers/fakeFirestoreTracking'

const mockFake = createFakeFirestore()
const mockEvent: any = { current: null }
const mockFulfil: any = { result: { outcome: 'fulfilled', ticketIds: ['a'], alreadyFulfilled: false } }

jest.mock('@/lib/firebase/admin', () => ({ adminDb: mockFake.db }))
jest.mock('firebase-admin/firestore', () => require('./helpers/fakeFirestoreTracking').fieldValueModule)
jest.mock('stripe', () => () => ({ webhooks: { constructEvent: jest.fn(() => mockEvent.current) } }), { virtual: true })
jest.mock('@/lib/disputes', () => ({ handleStripeDisputeEvent: jest.fn(async () => ({})) }))
jest.mock('@/lib/guest/checkout', () => ({ guestRecipientFromOrder: jest.fn(() => null) }))
jest.mock('@/lib/tickets/stripe-fulfillment', () => ({
  fulfillStripeOrder: jest.fn(async () => mockFulfil.result),
  applyStripeChargeRefund: jest.fn(async () => ({ paymentIntentId: 'pi_1', ticketsMatched: 1, markedRefunded: ['t'], unallocatedCents: 0 })),
  stripeOrderHasTickets: jest.fn(async () => true),
}))
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn() }))
jest.mock('@/lib/admin', () => ({ getAdminEmails: jest.fn(async () => []) }))
jest.mock('@/lib/firebase-db/server', () => ({
  createClient: async () => ({
    from: () => {
      const b: any = { select: () => b, eq: () => b, single: async () => ({ data: { max_tickets_per_user: 2 } }) }
      return b
    },
  }),
}))

/* eslint-disable @typescript-eslint/no-var-requires */
const { POST } = require('@/app/api/webhooks/stripe/route')
const { fulfillStripeOrder, applyStripeChargeRefund } = require('@/lib/tickets/stripe-fulfillment')
const { checkTicketLimit } = require('@/lib/security')
const { promoHasCapacity, promoCanCoverOrder } = require('@/lib/promo-codes')

const post = async () => {
  const res = await POST(
    new Request('https://www.tikem.co/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'sig' },
      body: '{}',
    })
  )
  return res.status as number
}

const webhookDoc = (id: string) => mockFake.get('webhook_events', `stripe__${id}`)

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x'
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

beforeEach(() => {
  jest.clearAllMocks()
  mockFake.reset()
})

const piEvent = (id: string) => ({
  id,
  type: 'payment_intent.succeeded',
  data: { object: { id: 'pi_1', amount: 2000, currency: 'eur', metadata: { eventId: 'evt1', userId: 'u1' }, transfer_data: { destination: 'acct_1' } } },
})

describe('webhook outcomes', () => {
  it('fulfilled → 200 and both claims completed; destination charge passed through', async () => {
    mockEvent.current = piEvent('evt_a')
    mockFulfil.result = { outcome: 'fulfilled', ticketIds: ['a'], alreadyFulfilled: false }
    expect(await post()).toBe(200)
    expect(fulfillStripeOrder.mock.calls[0][0]).toEqual(expect.objectContaining({ destinationCharge: true, paymentId: 'pi_1' }))
    expect(webhookDoc('evt_a')!.status).toBe('completed')
    expect(webhookDoc('pi_fulfill_pi_1')!.status).toBe('completed')
  })

  it('partial → 500, event claim released for retry, payment claim NOT released', async () => {
    mockEvent.current = piEvent('evt_b')
    mockFulfil.result = { outcome: 'partial', ticketIds: ['a'], failedSteps: ['earnings'] }
    expect(await post()).toBe(500)
    expect(webhookDoc('evt_b')!.status).toBe('failed')
    expect(webhookDoc('pi_fulfill_pi_1')!.status).toBe('processing')
  })

  it('refund_failed → 500 and both claims released so Stripe retries the refund', async () => {
    mockEvent.current = piEvent('evt_c')
    mockFulfil.result = { outcome: 'refund_failed', error: 'x' }
    expect(await post()).toBe(500)
    expect(webhookDoc('evt_c')!.status).toBe('failed')
    expect(webhookDoc('pi_fulfill_pi_1')!.status).toBe('failed')
  })

  it('payment claim held by the client-confirm path → 503, not a silent 200', async () => {
    mockFake.seed('webhook_events', 'stripe__pi_fulfill_pi_1', { status: 'processing', started_at: new Date().toISOString() })
    mockEvent.current = piEvent('evt_d')
    expect(await post()).toBe(503)
    expect(fulfillStripeOrder).not.toHaveBeenCalled()
    expect(webhookDoc('evt_d')!.status).toBe('failed')
  })

  it('charge.refunded is handled and deduped', async () => {
    mockEvent.current = { id: 'evt_r', type: 'charge.refunded', data: { object: { payment_intent: 'pi_1' } } }
    expect(await post()).toBe(200)
    expect(await post()).toBe(200)
    expect(applyStripeChargeRefund).toHaveBeenCalledTimes(1)
  })
})

describe('checkTicketLimit', () => {
  it('counts live tickets by attendee_id OR user_id, ignoring refunded ones', async () => {
    mockFake.seed('tickets', 'a', { event_id: 'e', attendee_id: 'u', status: 'confirmed' })
    mockFake.seed('tickets', 'b', { event_id: 'e', user_id: 'u', attendee_id: 'u', status: 'valid' })
    mockFake.seed('tickets', 'c', { event_id: 'e', attendee_id: 'u', status: 'refunded' })
    mockFake.seed('tickets', 'd', { event_id: 'other', attendee_id: 'u', status: 'valid' })
    const res = await checkTicketLimit('u', 'e')
    expect(res).toEqual({ exceeded: true, currentCount: 2, maxAllowed: 2 })
  })
})

describe('promo pricing capacity', () => {
  it('requires the whole order quantity to fit under the global cap', () => {
    const promo = { max_uses: 10, uses_count: 9 }
    expect(promoHasCapacity(promo)).toBe(true)
    expect(promoHasCapacity(promo, 1)).toBe(true)
    expect(promoHasCapacity(promo, 2)).toBe(false)
    expect(promoHasCapacity({ max_uses: null }, 50)).toBe(true)
  })

  it('checks the per-buyer cap against prior redemptions', async () => {
    const promo = { id: 'p1', max_uses: 100, uses_count: 0, max_uses_per_user: 2 }
    expect(await promoCanCoverOrder(promo, { qty: 2, buyerKey: 'uid:u' })).toEqual({ ok: true })
    expect(await promoCanCoverOrder(promo, { qty: 3, buyerKey: 'uid:u' })).toEqual({ ok: false, reason: 'buyer_cap' })
    expect(await promoCanCoverOrder(promo, { qty: 1, buyerKey: null })).toEqual({ ok: false, reason: 'buyer_unknown' })

    const { createHash } = require('node:crypto')
    const id = `p1__${createHash('sha256').update('uid:u').digest('hex').slice(0, 32)}`
    mockFake.seed('promo_buyer_usage', id, { qty: 2 })
    expect(await promoCanCoverOrder(promo, { qty: 1, buyerKey: 'uid:u' })).toEqual({ ok: false, reason: 'buyer_cap' })
  })
})
