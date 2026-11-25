/**
 * POST /api/create-payment-intent with add-ons (lib/addons/addOns.ts).
 *
 * The server prices add-ons from the event's STORED add-ons, validates every
 * rule (option, sale window, tier restriction, per-order limit, stock) before
 * any hold, holds their stock in the same inventory transaction as the seats,
 * and charges ONE fee over the full subtotal. Stripe is mocked.
 *
 * @jest-environment node
 */

const mockTiers: Record<string, any> = {}
const mockEvent: Record<string, any> = {}
const mockPromo = { doc: null as any }
const mockCreate = jest.fn(async (args: any) => ({ id: 'pi_test', client_secret: 'pi_test_secret', ...args }))

jest.mock('stripe', () => jest.fn(() => ({ paymentIntents: { create: mockCreate } })))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))
// Never a live rate lookup from a test.
jest.mock('@/lib/fx/usd-htg', () => ({
  ...jest.requireActual('@/lib/fx/usd-htg'),
  getUsdToHtgBaseRate: jest.fn(async () => ({ baseRate: 131.58, provider: 'test', fetchedAtIso: '2026-11-24T00:00:00Z', source: 'live' })),
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
jest.mock('@/lib/payment-provider', () => ({
  cardChargeRailForEventCountry: jest.fn(() => 'stripe'),
  haitiCardEnabled: jest.fn(() => true),
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

/* eslint-disable @typescript-eslint/no-var-requires */
const { POST } = require('@/app/api/create-payment-intent/route')
const { createSeatHold } = require('@/lib/tickets/seatHolds')
const { decodeAddOnLines } = require('@/lib/addons/addOns')

function tier(id: string, price: number, extra: Record<string, any> = {}) {
  mockTiers[id] = { id, event_id: 'evt1', name: id.toUpperCase(), price, total_quantity: 100, sold_quantity: 0, ...extra }
}

async function post(body: Record<string, any>) {
  const res = await POST(
    new Request('http://localhost/api/create-payment-intent', { method: 'POST', body: JSON.stringify({ eventId: 'evt1', ...body }) })
  )
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
  ;(createSeatHold as jest.Mock).mockClear()
  for (const k of Object.keys(mockTiers)) delete mockTiers[k]
  for (const k of Object.keys(mockEvent)) delete mockEvent[k]
  Object.assign(mockEvent, {
    id: 'evt1',
    title: 'Iftar gala',
    country: 'CA',
    currency: 'CAD',
    fee_incidence: 'buyer',
    organizer_id: 'org1',
    status: 'published',
    is_published: true,
    start_datetime: new Date(Date.now() + 7 * 864e5).toISOString(),
    ticket_price: 0,
    add_ons_enabled: true,
    add_ons: [
      { id: 'ao_meal', name: 'Iftar meal', price: 15, quantity: 100 },
      { id: 'ao_shirt', name: 'T-shirt', price: 25, options: ['S', 'M', 'L'], max_per_order: 2 },
      { id: 'ao_park', name: 'Parking', price: 10, tier_ids: ['vip'] },
    ],
  })
  mockPromo.doc = null
  mockFreeClaim.used = false
  mockHold.outcome = null
  tier('ga', 25)
  tier('vip', 50)
  tier('free', 0)
})

describe('create-payment-intent with add-ons', () => {
  it('charges tickets + add-ons with ONE fee over the full subtotal', async () => {
    const { status, data } = await post({
      tiers: [{ tierId: 'ga', quantity: 2 }],
      addOns: [{ id: 'ao_meal', quantity: 2 }],
    })
    expect(status).toBe(200)
    const pi = lastIntent()
    // The same as a C$80 face, 2-paid-ticket order (CA 6% + C$0.99 per paid
    // ticket): 80.00 + 4.80 + 2 x 0.99 = 86.78
    expect(pi.amount).toBe(8678)
    expect(pi.metadata.faceValueCents).toBe('8000')
    expect(pi.metadata.buyerFeeCents).toBe('678')
    expect(pi.metadata.aoFaceCents).toBe('3000')
    // 678 x 3000 / 8000, rounded down.
    expect(pi.metadata.aoFeeCents).toBe('254')
    expect(data.pricing).toEqual(expect.objectContaining({ faceValue: 80, total: 86.78, addOnSubtotal: 30 }))
    expect(decodeAddOnLines(pi.metadata)).toEqual({
      present: true,
      ok: true,
      lines: [{ addOnId: 'ao_meal', option: null, quantity: 2, unitPrice: 15 }],
    })
  })

  it('ignores any client price and reprices from the stored add-on', async () => {
    await post({ tiers: [{ tierId: 'ga', quantity: 1 }], addOns: [{ id: 'ao_meal', quantity: 1, price: 0.01, unitPrice: 0.01 }] })
    expect(lastIntent().metadata.faceValueCents).toBe('4000')
  })

  it('holds the add-on stock in the same hold as the seats', async () => {
    await post({ tiers: [{ tierId: 'ga', quantity: 1 }], addOns: [{ id: 'ao_shirt', option: 'M', quantity: 2 }] })
    expect(createSeatHold).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 1, addOnIncrements: [{ addOnId: 'ao_shirt', quantity: 2 }] })
    )
  })

  it('a single-tier order with add-ons still carries the tier breakdown', async () => {
    await post({ tierId: 'ga', quantity: 1, addOns: [{ id: 'ao_meal', quantity: 1 }] })
    const pi = lastIntent()
    expect(pi.metadata.tierId).toBe('')
    expect(JSON.parse(pi.metadata.t)).toEqual([['ga', 1, 25, 25]])
  })

  it('a FREE ticket + a paid add-on is a card order for the add-on only', async () => {
    const { status } = await post({ tiers: [{ tierId: 'free', quantity: 1 }], addOns: [{ id: 'ao_meal', quantity: 1 }] })
    expect(status).toBe(200)
    const pi = lastIntent()
    expect(pi.metadata.faceValueCents).toBe('1500')
    // 15.00 + 6% (0.90) + the fixed fee once (an order that costs anything carries one).
    expect(pi.amount).toBe(1689)
    expect(JSON.parse(pi.metadata.t)).toEqual([['free', 1, 0, 0]])
  })

  it('refuses a tier-restricted add-on without that tier, before any hold', async () => {
    const { status, data } = await post({ tiers: [{ tierId: 'ga', quantity: 1 }], addOns: [{ id: 'ao_park', quantity: 1 }] })
    expect(status).toBe(400)
    expect(data.code).toBe('addon_needs_tier')
    expect(createSeatHold).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('refuses over the per-order limit, unknown add-ons and missing options', async () => {
    const one = [{ tierId: 'ga', quantity: 1 }]
    expect((await post({ tiers: one, addOns: [{ id: 'ao_shirt', option: 'S', quantity: 3 }] })).data.code).toBe('addon_limit')
    expect((await post({ tiers: one, addOns: [{ id: 'ao_x', quantity: 1 }] })).data.code).toBe('addon_unavailable')
    expect((await post({ tiers: one, addOns: [{ id: 'ao_shirt', quantity: 1 }] })).data.code).toBe('addon_option_required')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('a sold-out add-on at hold time is a 409 and nothing is created at Stripe', async () => {
    mockHold.outcome = { ok: false, reason: 'addon_capacity', addOnId: 'ao_meal', remaining: 0, holdId: MOCK_HOLD_ID }
    const { status, data } = await post({ tiers: [{ tierId: 'ga', quantity: 1 }], addOns: [{ id: 'ao_meal', quantity: 1 }] })
    expect(status).toBe(409)
    expect(data).toEqual(expect.objectContaining({ code: 'addon_sold_out', addOnId: 'ao_meal' }))
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('without add-ons the intent is exactly as before (no add-on metadata)', async () => {
    await post({ tiers: [{ tierId: 'ga', quantity: 2 }] })
    const pi = lastIntent()
    expect(pi.metadata.ao).toBeUndefined()
    expect(pi.metadata.aoFaceCents).toBeUndefined()
    expect(pi.amount).toBe(5498)
  })
})
