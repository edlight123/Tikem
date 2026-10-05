/**
 * Attribution end to end on the Stripe client-confirm path: PaymentIntent
 * metadata (as create-payment-intent stamps it) → `attribution` on every
 * ticket → the tracking link's order/revenue counters, counted exactly once.
 *
 * @jest-environment node
 */

import { createFakeFirestore } from './helpers/fakeFirestoreTracking'
import { attributionToStripeMetadata } from '@/lib/attribution'

const mockFake = createFakeFirestore()
const mockPI: any = { current: null }
const mockClaims = new Set<string>()

jest.mock('@/lib/firebase/admin', () => ({ adminDb: mockFake.db }))
jest.mock('firebase-admin/firestore', () => require('./helpers/fakeFirestoreTracking').fieldValueModule)
jest.mock('stripe', () => () => ({
  paymentIntents: { retrieve: jest.fn(async () => mockPI.current) },
  refunds: { create: jest.fn() },
}), { virtual: true })
jest.mock('@/lib/firebase-db/server', () => ({ createClient: jest.fn() }))
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => ({ id: 'u1', email: 'u@x.com' })) }))
jest.mock('@/lib/tickets/confirmation', () => ({ sendTicketConfirmation: jest.fn(async () => undefined) }))
jest.mock('@/lib/guest/checkout', () => ({ guestRecipientFromOrder: jest.fn(() => null) }))
jest.mock('@/lib/guest/identity', () => ({
  attachTicketsToGuestOrder: jest.fn(),
  guestTicketUrl: jest.fn(),
  isGuestId: jest.fn(() => false),
}))
jest.mock('@/lib/notifications/helpers', () => ({
  notifyTicketPurchase: jest.fn(async () => undefined),
  notifyOrganizerTicketSale: jest.fn(async () => undefined),
}))
jest.mock('@/lib/tickets/inventory', () => ({
  buildTierSoldIncrements: jest.fn(() => []),
  reserveInventoryAtomic: jest.fn(async () => ({ ok: true })),
  releaseInventoryReservation: jest.fn(async () => undefined),
}))
// The shared pi_fulfill_ claim, modelled: a second claim on the same key loses.
jest.mock('@/lib/webhooks/idempotency', () => ({
  claimWebhookEvent: jest.fn(async ({ eventId }: any) => {
    if (mockClaims.has(eventId)) return { outcome: 'already_completed' }
    mockClaims.add(eventId)
    return { outcome: 'claimed' }
  }),
  markWebhookEventCompleted: jest.fn(async () => undefined),
  releaseWebhookEvent: jest.fn(async ({ eventId }: any) => mockClaims.delete(eventId)),
}))
jest.mock('@/lib/promo-codes', () => ({ promoBuyerKey: jest.fn(), redeemPromoInTransaction: jest.fn() }))
jest.mock('@/lib/promoters', () => ({ recordPromoterSale: jest.fn(async () => ({ recorded: true, commissionCents: 0 })) }))
jest.mock('@/lib/earnings', () => ({ addTicketToEarnings: jest.fn(async () => undefined) }))
jest.mock('@/lib/notifications/campaigns', () => ({ onSaleCompleted: jest.fn(async () => undefined) }))
jest.mock('@/lib/tickets/refundExecution', () => ({ reversePromoterCommission: jest.fn(async () => false) }))

const LINK = 'LinkAAAAAAAAAAAAAAAA'

function pi(id: string, extra: Record<string, string> = {}) {
  return {
    id,
    status: 'succeeded',
    amount: 2400,
    currency: 'usd',
    metadata: {
      eventId: 'evt1',
      userId: 'u1',
      quantity: '2',
      tierId: '',
      tierName: 'GA',
      originalCurrency: 'HTG',
      priceInOriginalCurrency: '1500',
      finalPrice: '1500',
      promoterId: '',
      promoterCode: 'STEEVE',
      ...attributionToStripeMetadata({
        tracking_link_id: LINK,
        utm_source: 'instagram',
        utm_medium: 'story',
        utm_campaign: 'launch',
        promoter_ref: 'STEEVE',
      }),
      ...extra,
    },
  }
}

const call = async (paymentIntentId: string) => {
  const { POST } = require('@/app/api/tickets/create-from-payment/route')
  const res = await POST(
    new Request('https://www.tikem.co/api/tickets/create-from-payment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paymentIntentId }),
    })
  )
  return { status: res.status, body: await res.json() }
}

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
})

beforeEach(() => {
  mockFake.reset()
  mockClaims.clear()
  mockFake.seed('events', 'evt1', { title: 'Fèt', organizer_id: 'org1', currency: 'HTG' })
  mockFake.seed('users', 'u1', { email: 'u@x.com', full_name: 'U' })
  mockFake.seed('tracking_links', LINK, { event_id: 'evt1', clicks: 4, sales_count: 0, tickets_count: 0, revenue_by_currency: {} })
})

it('stamps the attribution on every ticket and counts the order on its link', async () => {
  mockPI.current = pi('pi_A')
  const res = await call('pi_A')
  expect(res.status).toBe(200)
  expect(res.body.ticketIds).toHaveLength(2)

  for (const id of res.body.ticketIds) {
    expect(mockFake.get('tickets', id)!.attribution).toEqual({
      tracking_link_id: LINK,
      utm_source: 'instagram',
      utm_medium: 'story',
      utm_campaign: 'launch',
      promoter_ref: 'STEEVE',
    })
  }

  const link = mockFake.get('tracking_links', LINK)!
  expect(link.sales_count).toBe(1)
  expect(link.tickets_count).toBe(2)
  // Face value in the event's own currency (HTG), not the USD charge.
  expect(link.revenue_by_currency).toEqual({ HTG: 300000 })
})

it('a repeated confirm for the same PaymentIntent never double counts', async () => {
  mockPI.current = pi('pi_B')
  await call('pi_B')
  await call('pi_B')
  // Even if the claim were released and the order fulfilled again, the
  // per-(link, order) marker keeps the count at one.
  mockClaims.clear()
  mockFake.all('tickets').forEach(([id]) => mockFake.db.collection('tickets').doc(id).delete())
  await call('pi_B')
  expect(mockFake.get('tracking_links', LINK)!.sales_count).toBe(1)
  expect(mockFake.get('tracking_links', LINK)!.revenue_by_currency).toEqual({ HTG: 300000 })
})

it('an unattributed order stamps nothing and counts nothing', async () => {
  mockPI.current = pi('pi_C', { trackingLinkId: '', utmSource: '', utmMedium: '', utmCampaign: '', promoterCode: '' })
  const res = await call('pi_C')
  for (const id of res.body.ticketIds) expect(mockFake.get('tickets', id)!.attribution).toBeUndefined()
  expect(mockFake.get('tracking_links', LINK)!.sales_count).toBe(0)
})
