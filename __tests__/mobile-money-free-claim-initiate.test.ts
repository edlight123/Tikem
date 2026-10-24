/**
 * @jest-environment node
 *
 * Order creation on the MonCash and SogePay rails holds the FREE lines of a paid
 * cart to the free-claim limits, exactly as create-payment-intent does
 * (lib/tickets/free-claim-policy): more than the free-ticket cap → 400
 * free_limit_exceeded; a buyer whose free claim is used → 409 already_claimed
 * (a guest gets the neutral message). The MonCash quote applies only the pure
 * cap and takes no lock.
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const mockFake = new FakeFirestore()
const mockState: { user: any; inserted: any[]; tiers: Record<string, any>; event: any } = {
  user: { id: 'u1', email: 'u1@x.co' },
  inserted: [],
  tiers: {},
  event: {},
}

jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return mockFake
  },
}))
jest.mock('@/lib/firebase-db/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      const filters: Array<[string, unknown]> = []
      let inserted: any = null
      const b: any = {
        select: () => b,
        eq: (f: string, v: unknown) => {
          filters.push([f, v])
          return b
        },
        insert: (row: any) => {
          inserted = row
          mockState.inserted.push(row)
          return b
        },
        update: () => b,
        single: async () => {
          if (inserted) return { data: { id: 'p1', ...inserted }, error: null }
          if (table === 'events') return { data: mockState.event, error: null }
          if (table === 'ticket_tiers') {
            const id = filters.find(([f]) => f === 'id')?.[1] as string
            return { data: mockState.tiers[id] ?? null, error: null }
          }
          return { data: null, error: null }
        },
        then: (resolve: any) => {
          if (table === 'ticket_tiers') return resolve({ data: Object.values(mockState.tiers), error: null })
          return resolve({ data: null, error: null })
        },
      }
      return b
    },
  }),
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: async () => mockState.user }))
jest.mock('@/lib/guest/checkout', () => ({
  identityFromUser: (u: any) => ({ isGuest: false, id: u.id, email: u.email }),
  guestOrderFields: () => ({}),
  beginGuestCheckout: async ({ guestInput }: any) => ({
    ok: true,
    identity: { isGuest: true, id: 'guest_1', email: guestInput.email, guestToken: null },
  }),
}))
jest.mock('@/lib/promo-codes', () => ({
  resolvePromoCode: async () => null,
  promoBuyerKey: () => null,
  promoCanCoverOrder: async () => ({ ok: true }),
  calculateDiscount: (p: number) => ({ discountedPrice: p, discountAmount: 0 }),
}))
jest.mock('@/lib/promoters', () => ({ resolvePromoterCode: async () => null }))
jest.mock('@/lib/tracking-links', () => ({ resolveOrderAttribution: async () => null }))
jest.mock('@/lib/events/access-guard', () => ({ hasEventAccess: async () => true }))
jest.mock('@/lib/tickets/purchase-screens', () => ({
  screenPurchaseAttempt: async () => ({ ok: true, log: async () => undefined }),
}))
jest.mock('@/lib/admin/platform-settings', () => ({ getPlatformSettings: async () => ({ haiti: undefined }) }))
jest.mock('@/lib/ops/ops-events', () => ({ scheduleOpsEvent: () => undefined }))
jest.mock('@/lib/moncash-button', () => ({
  isMonCashButtonConfigured: () => true,
  createMonCashButtonCheckoutToken: async () => ({ token: 'tok' }),
  getMonCashButtonRedirectUrl: () => 'https://moncash.example/redirect',
}))
jest.mock('@/lib/moncash', () => ({ prewarmMonCashAccessToken: async () => undefined }))
jest.mock('@/lib/capacity', () => ({
  capacityFromEvent: () => ({ available: true }),
  checkEventCapacity: async () => ({ available: true }),
}))
jest.mock('@/lib/rate-limit', () => ({ clientIp: () => '1.1.1.1', consumeRateLimit: async () => ({ limited: false }) }))
jest.mock('@/lib/event-country', () => ({
  inferCountryFromEventText: () => 'HT',
  resolveEventCountry: async () => 'HT',
}))
jest.mock('@/lib/payment-provider', () => ({
  getPaymentProviderForEventCountry: () => 'sogepay',
  normalizeCountryCode: (c: any) => c,
}))
jest.mock('@/lib/tickets/purchasable', () => ({
  ...jest.requireActual('@/lib/tickets/purchasable'),
  checkEventPurchasable: () => ({ ok: true }),
}))
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: any, init?: any) => ({
      status: init?.status ?? 200,
      json: async () => body,
      cookies: { set: () => undefined },
    }),
  },
  after: () => undefined,
}))

import { POST as moncashInitiate } from '@/app/api/moncash-button/initiate/route'
import { POST as moncashQuote } from '@/app/api/moncash-button/quote/route'
import { POST as sogepayInitiate } from '@/app/api/sogepay/initiate/route'
import { freeClaimLockId } from '@/lib/tickets/free-claim-policy'

const EVENT = 'evt1'
const tier = (id: string, price: number) => ({
  id,
  event_id: EVENT,
  name: id,
  price,
  is_active: true,
  total_quantity: 500,
  sold_quantity: 0,
})

const req = (body: any) =>
  ({
    json: async () => body,
    headers: { get: () => null },
    url: 'https://www.tikem.co/api/x',
  }) as any

type Rail = { name: string; post: (r: any) => Promise<any> }
const rails: Rail[] = [
  { name: 'MonCash', post: moncashInitiate },
  { name: 'SogePay', post: sogepayInitiate },
]

beforeEach(() => {
  mockFake.store.clear()
  mockState.user = { id: 'u1', email: 'u1@x.co' }
  mockState.inserted = []
  mockState.tiers = { free: tier('free', 0), ga: tier('ga', 1000) }
  mockState.event = { id: EVENT, country: 'HT', currency: 'HTG', ticket_price: 1000, is_published: true }
  process.env.SOGEPAY_ENABLED = 'true'
  process.env.SOGEPAY_CHECKOUT_URL = 'https://sogepay.example/checkout'
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

describe.each(rails)('$name initiate: free lines in a paid cart', ({ post }) => {
  const cart = (free: number, paid = 1) => ({
    eventId: EVENT,
    tiers: [
      { tierId: 'free', quantity: free },
      { tierId: 'ga', quantity: paid },
    ],
  })

  it('a first free claim goes through, with the list price stamped on the order', async () => {
    const res = await post(req(cart(2)))
    expect(res.status).toBe(200)
    expect(mockState.inserted).toHaveLength(1)
    expect(mockState.inserted[0].tier_selections).toEqual([
      expect.objectContaining({ tierId: 'free', listUnitPrice: 0, unitPrice: 0 }),
      expect.objectContaining({ tierId: 'ga', listUnitPrice: 1000 }),
    ])
    // Order creation reserves nothing: the lock is taken at fulfillment.
    expect(mockFake.docsIn('free_claim_locks')).toHaveLength(0)
  })

  it('an all-free cart never becomes a mobile-money payment: 400 order_is_free', async () => {
    const res = await post(req({ eventId: EVENT, tiers: [{ tierId: 'free', quantity: 2 }] }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('order_is_free')
    expect(mockState.inserted).toHaveLength(0)
  })

  it('more than the free-ticket cap: 400 free_limit_exceeded, no order', async () => {
    const res = await post(req(cart(11)))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('free_limit_exceeded')
    expect(mockState.inserted).toHaveLength(0)
  })

  it('an account that already holds a free ticket: 409 already_claimed', async () => {
    mockFake.write('tickets/old', { attendee_id: 'u1', event_id: EVENT, price_paid: 0, status: 'valid' })
    const res = await post(req(cart(1)))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('already_claimed')
    expect(body.error).toMatch(/Remove the free tier/)
    expect(mockState.inserted).toHaveLength(0)
  })

  it('a guest whose claim lock is held gets the neutral message', async () => {
    mockState.user = null
    const guest = { isGuest: true, id: 'guest_1', email: 'g@x.co' }
    mockFake.write(`free_claim_locks/${freeClaimLockId(EVENT, guest)}`, { payment_id: 'pi_x' })
    const res = await post(req({ ...cart(1), guest: { name: 'G', email: 'g@x.co', phone: '+50900000000' } }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      code: 'already_claimed',
      error: 'You already claimed a ticket for this event. Check your email for your tickets.',
    })
  })

  it('a cart with no free line is not checked against the free claim', async () => {
    mockFake.write('tickets/old', { attendee_id: 'u1', event_id: EVENT, price_paid: 0, status: 'valid' })
    const res = await post(req({ eventId: EVENT, tiers: [{ tierId: 'ga', quantity: 2 }] }))
    expect(res.status).toBe(200)
  })

  it('the 50-ticket order cap counts free lines', async () => {
    const res = await post(req(cart(5, 46)))
    expect(res.status).toBe(400)
    expect(mockState.inserted).toHaveLength(0)
  })
})

describe('MonCash quote', () => {
  it('refuses more than the free-ticket cap, but takes no lock and reads no claim', async () => {
    mockFake.write('tickets/old', { attendee_id: 'u1', event_id: EVENT, price_paid: 0, status: 'valid' })
    const over = await moncashQuote(req({ eventId: EVENT, tiers: [{ tierId: 'free', quantity: 11 }, { tierId: 'ga', quantity: 1 }] }))
    expect(over.status).toBe(400)
    expect((await over.json()).code).toBe('free_limit_exceeded')

    // Already claimed is initiate's call; the quote just prices.
    const ok = await moncashQuote(req({ eventId: EVENT, tiers: [{ tierId: 'free', quantity: 2 }, { tierId: 'ga', quantity: 1 }] }))
    expect(ok.status).toBe(200)
    expect((await ok.json()).amountHtg).toBe(1000)
    expect(mockFake.docsIn('free_claim_locks')).toHaveLength(0)
  })
})
