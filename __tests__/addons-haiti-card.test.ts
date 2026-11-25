/**
 * Add-ons on the Haiti card rail (lib/addons/addOns.ts). Harness copied from
 * haiti-card-checkout.test.ts: an HTG event charged in USD on the Stripe
 * platform, at the guarded rate; add-ons convert at the same rate.
 * @jest-environment node
 */

const mockTiers: Record<string, any> = {}
const mockEvent: Record<string, any> = {}
const mockPromo = { doc: null as any }
const mockCreate = jest.fn(async (args: any) => ({ id: 'pi_test', client_secret: 'pi_test_secret', ...args }))

jest.mock('stripe', () => jest.fn(() => ({ paymentIntents: { create: mockCreate } })))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))
// Never a live rate lookup from a test: the guarded engine is scripted.
const mockFx = { result: null as any, error: null as any }
const mockGetRate = jest.fn(async (_opts?: any) => {
  if (mockFx.error) throw mockFx.error
  return mockFx.result
})
jest.mock('@/lib/fx/usd-htg', () => ({
  ...jest.requireActual('@/lib/fx/usd-htg'),
  getUsdToHtgBaseRate: (opts?: any) => mockGetRate(opts),
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => ({ id: 'u1', email: 'u@x.com' })) }))
jest.mock('@/lib/security', () => ({
  isBlacklisted: jest.fn(async () => ({ blacklisted: false })),
  shouldRateLimit: jest.fn(async () => ({ limited: false })),
  checkTicketLimit: jest.fn(async () => ({ exceeded: false, currentCount: 0, maxAllowed: 50 })),
  logPurchaseAttempt: jest.fn(async () => undefined),
  detectBotBehavior: jest.fn(async () => false),
  logSuspiciousActivity: jest.fn(async () => undefined),
}))
jest.mock('@/lib/firebase-db/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      const filters: Array<[string, any]> = []
      const rows = () => {
        const source: any[] = table === 'events' ? [mockEvent] : Object.values(mockTiers)
        return source.filter((r) => filters.every(([f, v]) => String(r[f]) === String(v)))
      }
      const q: any = {
        select: () => q,
        eq: (f: string, v: any) => {
          filters.push([f, v])
          return q
        },
        single: async () => ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'not found' } }),
        then: (resolve: any) => resolve({ data: rows(), error: null }),
      }
      return q
    },
  }),
}))
jest.mock('@/lib/promo-codes', () => ({
  resolvePromoCode: jest.fn(async () => mockPromo.doc),
  promoCanCoverOrder: jest.fn(async () => ({ ok: true })),
  promoBuyerKey: jest.fn(() => 'uid:u1'),
}))
jest.mock('@/lib/promoters', () => ({ resolvePromoterCode: jest.fn(async () => null) }))
jest.mock('@/lib/tracking-links', () => ({ resolveOrderAttribution: jest.fn(async () => null) }))
// The REAL rail decision (HT -> stripe_platform); only the kill switch is scripted.
const mockHaitiCard = { enabled: true }
jest.mock('@/lib/payment-provider', () => ({
  ...jest.requireActual('@/lib/payment-provider'),
  haitiCardEnabled: jest.fn(() => mockHaitiCard.enabled),
}))
jest.mock('@/lib/admin/platform-settings', () => ({
  getPlatformSettings: jest.fn(async () => require('@/types/platform-settings').DEFAULT_PLATFORM_SETTINGS),
}))
jest.mock('@/lib/firestore/payout-profiles', () => ({ getPayoutProfile: jest.fn(async () => null) }))
jest.mock('@/lib/events/payout-health-notice', () => ({ flagOrganizerCardCheckoutBlocked: jest.fn(async () => undefined) }))
jest.mock('@/lib/events/access-guard', () => ({ hasEventAccess: jest.fn(async () => true) }))
jest.mock('@/lib/guest/checkout', () => ({
  beginGuestCheckout: jest.fn(),
  identityFromUser: (u: any) => ({ isGuest: false, id: u.id, email: u.email, name: '', phone: '' }),
}))
jest.mock('@/lib/guest/identity', () => ({ guestTicketUrl: jest.fn(), validateGuestContact: jest.fn() }))
const mockFreeClaim = { used: false }
jest.mock('@/lib/tickets/free-claim-policy', () => ({
  ...jest.requireActual('@/lib/tickets/free-claim-policy'),
  freeClaimAlreadyUsed: jest.fn(async () => mockFreeClaim.used),
}))

// Seat holds (lib/tickets/seatHolds.ts) are exercised against a real-transaction fake in
// seat-holds-inventory.test.ts; here the hold's verdict is scripted.
const MOCK_HOLD_ID = `hold_${'a'.repeat(32)}`
const mockHold = { outcome: null as any }
jest.mock('@/lib/tickets/seatHolds', () => {
  const actual = jest.requireActual('@/lib/tickets/seatHolds')
  return {
    ...actual,
    createSeatHold: jest.fn(async () =>
      mockHold.outcome || { ok: true, reservationId: MOCK_HOLD_ID, holdId: MOCK_HOLD_ID, expiresAt: Date.now() + 480_000 }
    ),
    releaseSeatHold: jest.fn(async () => true),
  }
})

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'

const { POST } = require('@/app/api/create-payment-intent/route')
const { decodeCardOrderLines } = require('@/lib/checkout/card-order-lines')

function tier(id: string, price: number, extra: Record<string, any> = {}) {
  mockTiers[id] = { id, event_id: 'evt1', name: id.toUpperCase(), price, total_quantity: 100, sold_quantity: 0, ...extra }
}

async function post(body: Record<string, any>) {
  const res = await POST(new Request('http://localhost/api/create-payment-intent', { method: 'POST', body: JSON.stringify({ eventId: 'evt1', ...body }) }))
  return { status: res.status, data: await res.json() }
}

const lastIntent = () => mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0]

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

beforeEach(() => {
  mockCreate.mockClear()
  for (const k of Object.keys(mockTiers)) delete mockTiers[k]
  for (const k of Object.keys(mockEvent)) delete mockEvent[k]
  Object.assign(mockEvent, {
    id: 'evt1',
    title: 'Show',
    country: 'HT',
    currency: 'HTG',
    fee_incidence: null,
    organizer_id: 'org1',
    status: 'published',
    is_published: true,
    start_datetime: new Date(Date.now() + 7 * 864e5).toISOString(),
    ticket_price: 2500,
  })
  mockPromo.doc = null
  mockFreeClaim.used = false
  mockHold.outcome = null
  mockHaitiCard.enabled = true
  mockFx.error = null
  mockFx.result = { baseRate: 131.58, provider: 'https://open.er-api.com/v6/latest/USD', fetchedAtIso: '2026-11-24T00:00:00Z', source: 'live' }
  mockGetRate.mockClear()
  delete process.env.HAITI_CARD_MIN_USD
  tier('vip', 5000)
  tier('ga', 2500)
  tier('free', 0)
})

const { decodeAddOnLines } = require('@/lib/addons/addOns')
const { createSeatHold } = require('@/lib/tickets/seatHolds')

const HAITI_ADD_ONS = [
  { id: 'ao_bottle', name: 'Bottle package', price: 5000, quantity: 10, tier_ids: ['vip'] },
  { id: 'ao_park', name: 'Parking', price: 500 },
]

describe('Haiti card checkout with add-ons (HTG priced, USD charged)', () => {
  beforeEach(() => {
    Object.assign(mockEvent, { add_ons_enabled: true, add_ons: HAITI_ADD_ONS })
    ;(createSeatHold as jest.Mock).mockClear()
  })

  it('converts the add-ons at the same guarded rate and charges them on the platform rail', async () => {
    const { status, data } = await post({
      tiers: [{ tierId: 'vip', quantity: 1 }],
      addOns: [{ id: 'ao_bottle', quantity: 1 }],
    })
    expect(status).toBe(200)
    const pi = lastIntent()
    // 5,000 HTG ticket + 5,000 HTG bottle at 131.58 = 38.00 + 38.00 USD.
    expect(pi.amount).toBe(7600)
    expect(pi.currency).toBe('usd')
    expect(pi.transfer_data).toBeUndefined()
    expect(pi.metadata).toEqual(
      expect.objectContaining({
        payoutProvider: 'stripe_platform',
        fundsRail: 'stripe_platform',
        originalCurrency: 'HTG',
        aoFaceCents: '3800',
        // The Haiti fee is absorbed by the organizer: nothing on top.
        aoFeeCents: '0',
        localFaceTotal: '10000',
      })
    )
    // The add-on lines keep their HTG price; fulfillment converts with the stamped rate.
    expect(decodeAddOnLines(pi.metadata)).toEqual({
      present: true,
      ok: true,
      lines: [{ addOnId: 'ao_bottle', option: null, quantity: 1, unitPrice: 5000 }],
    })
    expect(pi.description).toContain('(10,000 HTG)')
    expect(data.pricing.local).toEqual(expect.objectContaining({ currency: 'HTG', faceValue: 10000, total: 10000 }))
    expect(data.pricing.addOnSubtotal).toBe(38)
    expect(createSeatHold).toHaveBeenCalledWith(
      expect.objectContaining({ addOnIncrements: [{ addOnId: 'ao_bottle', quantity: 1 }] })
    )
  })

  it('the Haiti card minimum counts the add-ons (a small ticket + parking can clear it)', async () => {
    tier('small', 300) // 300 HTG = 2.28 USD on its own: under USD 5
    const alone = await post({ tierId: 'small', quantity: 1 })
    expect(alone.data.code).toBe('card_amount_below_minimum')
    // + 2 parking (1,000 HTG): 1,300 HTG = 9.88 USD
    const withParking = await post({ tiers: [{ tierId: 'small', quantity: 1 }], addOns: [{ id: 'ao_park', quantity: 2 }] })
    expect(withParking.status).toBe(200)
    expect(lastIntent().amount).toBe(988)
  })

  it('a VIP-only bottle package is refused with a GA ticket', async () => {
    const { status, data } = await post({ tiers: [{ tierId: 'ga', quantity: 1 }], addOns: [{ id: 'ao_bottle', quantity: 1 }] })
    expect(status).toBe(400)
    expect(data.code).toBe('addon_needs_tier')
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
