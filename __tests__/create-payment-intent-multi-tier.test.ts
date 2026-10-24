/**
 * POST /api/create-payment-intent with a multi-tier cart.
 *
 * The web checkout used to send only the FIRST tier with the cart's total
 * quantity: VIP $50 x1 + GA $25 x2 (US, fee passed on) showed $108.97 and
 * charged $161.97 for three VIP tickets, and a free tier listed first made the
 * PaymentIntent 0. The route now takes `tiers: [{ tierId, quantity }]`, prices
 * every line from its stored tier price, and writes the per-tier breakdown to
 * the PaymentIntent for fulfillment. The single-tier body is still accepted.
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
jest.mock('@/lib/currency', () => ({ fetchStripeHTGRate: jest.fn(async () => 0.0076) }))
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
jest.mock('@/lib/payment-provider', () => ({ getPaymentProviderForEventCountry: jest.fn(() => 'stripe') }))
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

/* eslint-disable @typescript-eslint/no-var-requires */
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
    country: 'US',
    currency: 'USD',
    fee_incidence: 'buyer',
    organizer_id: 'org1',
    status: 'published',
    is_published: true,
    start_datetime: new Date(Date.now() + 7 * 864e5).toISOString(),
    ticket_price: 25,
  })
  mockPromo.doc = null
  mockFreeClaim.used = false
  mockHold.outcome = null
  tier('vip', 50)
  tier('ga', 25)
  tier('free', 0)
})

describe('multi-tier card checkout', () => {
  it('VIP $50 x1 + GA $25 x2, fee passed on: charges $108.97, the total the cart showed', async () => {
    const { status, data } = await post({ tiers: [{ tierId: 'vip', quantity: 1 }, { tierId: 'ga', quantity: 2 }] })
    expect(status).toBe(200)
    const pi = lastIntent()
    expect(pi.amount).toBe(10897)
    expect(pi.currency).toBe('usd')
    expect(data.pricing).toEqual(expect.objectContaining({ faceValue: 100, buyerFee: 8.97, total: 108.97, quantity: 3 }))
    expect(pi.metadata.quantity).toBe('3')
    expect(pi.metadata.tierId).toBe('')
    expect(pi.metadata.faceValueCents).toBe('10000')
    expect(pi.metadata.buyerFeeCents).toBe('897')
  })

  it('writes a per-tier breakdown that fulfillment decodes back to the same cart', async () => {
    await post({ tiers: [{ tierId: 'vip', quantity: 1 }, { tierId: 'ga', quantity: 2 }] })
    const { metadata } = lastIntent()
    for (const v of Object.values(metadata)) expect(String(v).length).toBeLessThanOrEqual(500)
    expect(decodeCardOrderLines(metadata)).toEqual({
      present: true,
      ok: true,
      quantity: 3,
      lines: [
        { tierId: 'vip', quantity: 1, unitPrice: 50, unitOriginal: 50 },
        { tierId: 'ga', quantity: 2, unitPrice: 25, unitOriginal: 25 },
      ],
    })
  })

  it('free + paid: the free line is $0 and carries no fixed fee', async () => {
    await post({ tiers: [{ tierId: 'free', quantity: 2 }, { tierId: 'ga', quantity: 2 }] })
    const pi = lastIntent()
    // 50.00 face + 6% (3.00) + 2 paid x 0.99
    expect(pi.amount).toBe(5498)
    expect(pi.metadata.quantity).toBe('4')
    const decoded = decodeCardOrderLines(pi.metadata)
    expect(decoded.lines.map((l: any) => [l.tierId, l.quantity, l.unitPrice])).toEqual([
      ['free', 2, 0],
      ['ga', 2, 25],
    ])
  })

  it('an all-free cart never reaches Stripe', async () => {
    const { status, data } = await post({ tiers: [{ tierId: 'free', quantity: 2 }] })
    expect(status).toBe(400)
    expect(data.code).toBe('order_is_free')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('applies the promo per ticket on every line, and the fee on the result', async () => {
    mockPromo.doc = { id: 'promo1', discount_type: 'percentage', discount_value: 10 }
    await post({ tiers: [{ tierId: 'vip', quantity: 1 }, { tierId: 'ga', quantity: 2 }], promoCodeId: 'SAVE10' })
    const pi = lastIntent()
    expect(pi.amount).toBe(9837)
    expect(pi.metadata.promoCodeId).toBe('promo1')
    const decoded = decodeCardOrderLines(pi.metadata)
    expect(decoded.lines).toEqual([
      { tierId: 'vip', quantity: 1, unitPrice: 45, unitOriginal: 50 },
      { tierId: 'ga', quantity: 2, unitPrice: 22.5, unitOriginal: 25 },
    ])
  })

  it('a promo that zeroes some lines counts only the still-paid tickets for the fixed fee', async () => {
    mockPromo.doc = { id: 'promo2', discount_type: 'fixed_amount', discount_value: 30 }
    await post({ tiers: [{ tierId: 'vip', quantity: 1 }, { tierId: 'ga', quantity: 2 }], promoCodeId: 'X' })
    // VIP 20.00 + 6% (1.20) + 1 x 0.99
    expect(lastIntent().amount).toBe(2219)
  })

  it('absorbed fee: charges face value only', async () => {
    mockEvent.fee_incidence = 'organizer'
    await post({ tiers: [{ tierId: 'vip', quantity: 1 }, { tierId: 'ga', quantity: 2 }] })
    expect(lastIntent().amount).toBe(10000)
  })

  it('refuses a tier from another event, an inactive tier and an oversold line', async () => {
    tier('other', 1, { event_id: 'evt2' })
    expect((await post({ tiers: [{ tierId: 'vip', quantity: 1 }, { tierId: 'other', quantity: 1 }] })).status).toBe(404)
    tier('off', 10, { is_active: false })
    expect((await post({ tiers: [{ tierId: 'vip', quantity: 1 }, { tierId: 'off', quantity: 1 }] })).status).toBe(400)
    tier('few', 10, { total_quantity: 3, sold_quantity: 2 })
    const oversold = await post({ tiers: [{ tierId: 'vip', quantity: 1 }, { tierId: 'few', quantity: 2 }] })
    expect(oversold.status).toBe(400)
    expect(oversold.data.error).toBe('Only 1 ticket(s) remaining for FEW.')
    tier('later', 10, { sales_start: new Date(Date.now() + 864e5).toISOString() })
    expect((await post({ tiers: [{ tierId: 'vip', quantity: 1 }, { tierId: 'later', quantity: 1 }] })).status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('refuses fractional quantities on any line', async () => {
    const res = await post({ tiers: [{ tierId: 'vip', quantity: 1 }, { tierId: 'ga', quantity: 0.5 }] })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('free lines in a paid cart obey the free-claim limits', () => {
  const { freeClaimAlreadyUsed } = jest.requireMock('@/lib/tickets/free-claim-policy')

  it('a buyer who already used their free claim cannot get more free tickets by paying for one', async () => {
    mockFreeClaim.used = true
    const res = await post({ tiers: [{ tierId: 'free', quantity: 2 }, { tierId: 'ga', quantity: 1 }] })
    expect(res.status).toBe(409)
    expect(res.data.code).toBe('already_claimed')
    expect(freeClaimAlreadyUsed).toHaveBeenCalledWith('evt1', expect.objectContaining({ id: 'u1', isGuest: false }))
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('more free tickets than the per-person cap in one order are refused, as on the free-claim route', async () => {
    const res = await post({ tiers: [{ tierId: 'free', quantity: 11 }, { tierId: 'ga', quantity: 1 }] })
    expect(res.status).toBe(400)
    expect(res.data.code).toBe('free_limit_exceeded')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('free lines are held to inventory and the sales window like any line', async () => {
    tier('freefew', 0, { total_quantity: 1, sold_quantity: 1 })
    expect((await post({ tiers: [{ tierId: 'freefew', quantity: 1 }, { tierId: 'ga', quantity: 1 }] })).status).toBe(400)
    tier('freeclosed', 0, { sales_end: new Date(Date.now() - 864e5).toISOString() })
    expect((await post({ tiers: [{ tierId: 'freeclosed', quantity: 1 }, { tierId: 'ga', quantity: 1 }] })).status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('a cart with no free line never consults the free claim', async () => {
    mockFreeClaim.used = true
    expect((await post({ tiers: [{ tierId: 'vip', quantity: 1 }, { tierId: 'ga', quantity: 1 }] })).status).toBe(200)
  })

  it('the whole order, free lines included, is capped at 50 tickets', async () => {
    const res = await post({ tiers: [{ tierId: 'free', quantity: 5 }, { tierId: 'ga', quantity: 46 }] })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('minimum paid price at checkout', () => {
  it('refuses a paid line whose stored list price is below the US minimum', async () => {
    tier('cheap', 1.5)
    const res = await post({ tiers: [{ tierId: 'vip', quantity: 1 }, { tierId: 'cheap', quantity: 1 }] })
    expect(res.status).toBe(400)
    expect(res.data.code).toBe('tier_price_below_minimum')
    expect(res.data.error).toContain('2.00 USD')
    expect((await post({ tierId: 'cheap', quantity: 1 })).data.code).toBe('tier_price_below_minimum')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('checks the list price BEFORE the promo, so a discount below the minimum still sells', async () => {
    mockPromo.doc = { id: 'p', discount_type: 'fixed_amount', discount_value: 24 }
    const res = await post({ tiers: [{ tierId: 'ga', quantity: 1 }, { tierId: 'vip', quantity: 1 }], promoCodeId: 'X' })
    expect(res.status).toBe(200)
  })

  it('free tiers and Haiti have no minimum', async () => {
    expect((await post({ tiers: [{ tierId: 'free', quantity: 1 }, { tierId: 'ga', quantity: 1 }] })).status).toBe(200)
    Object.assign(mockEvent, { country: 'HT', currency: 'HTG' })
    tier('htcheap', 1)
    jest.requireMock('@/lib/payment-provider').getPaymentProviderForEventCountry.mockReturnValueOnce('stripe')
    const res = await post({ tierId: 'htcheap', quantity: 1 })
    expect(res.data.code).not.toBe('tier_price_below_minimum')
  })
})

describe('single-tier body (older web builds, the mobile app)', () => {
  it('tierId + quantity still prices and stamps exactly as before', async () => {
    const { status } = await post({ tierId: 'ga', quantity: 3 })
    expect(status).toBe(200)
    const pi = lastIntent()
    // 75.00 + 6% (4.50) + 3 x 0.99
    expect(pi.amount).toBe(8247)
    expect(pi.metadata).toEqual(
      expect.objectContaining({ quantity: '3', tierId: 'ga', tierName: 'GA', finalPrice: '25', originalPrice: '25', priceInOriginalCurrency: '25' })
    )
    expect(pi.metadata.t).toBeUndefined()
  })

  it('a one-line `tiers` cart writes the same single-tier metadata', async () => {
    await post({ tiers: [{ tierId: 'ga', quantity: 3 }] })
    const pi = lastIntent()
    expect(pi.amount).toBe(8247)
    expect(pi.metadata.tierId).toBe('ga')
    expect(pi.metadata.t).toBeUndefined()
  })
})

describe('seat hold at checkout start', () => {
  const { createSeatHold, releaseSeatHold } = require('@/lib/tickets/seatHolds')

  it('holds the cart before creating the PaymentIntent and returns the hold', async () => {
    const { status, data } = await post({ tiers: [{ tierId: 'vip', quantity: 1 }, { tierId: 'ga', quantity: 2 }] })
    expect(status).toBe(200)
    expect(createSeatHold).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventId: 'evt1',
        quantity: 3,
        tierIncrements: [
          { tierId: 'vip', quantity: 1 },
          { tierId: 'ga', quantity: 2 },
        ],
        ownerKey: 'user:u1',
      })
    )
    expect(lastIntent().metadata.seatHoldId).toBe(MOCK_HOLD_ID)
    expect(data.seatHold).toEqual(expect.objectContaining({ id: MOCK_HOLD_ID, releaseToken: expect.any(String) }))
  })

  it('sold out at start: 409 sold_out and no PaymentIntent is created', async () => {
    mockHold.outcome = { ok: false, reason: 'tier_capacity', tierId: 'vip', remaining: 0, holdId: MOCK_HOLD_ID }
    const { status, data } = await post({ tiers: [{ tierId: 'vip', quantity: 1 }] })
    expect(status).toBe(409)
    expect(data.code).toBe('sold_out')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('fewer left than asked: 409 only_n_left with the count', async () => {
    mockHold.outcome = { ok: false, reason: 'event_capacity', remaining: 2, holdId: MOCK_HOLD_ID }
    const { status, data } = await post({ tiers: [{ tierId: 'ga', quantity: 3 }] })
    expect(status).toBe(409)
    expect(data).toEqual(expect.objectContaining({ code: 'only_n_left', remaining: 2 }))
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('contention: 503 busy_try_again and no PaymentIntent', async () => {
    mockHold.outcome = { ok: false, reason: 'busy', holdId: MOCK_HOLD_ID }
    const { status, data } = await post({ tiers: [{ tierId: 'ga', quantity: 1 }] })
    expect(status).toBe(503)
    expect(data.code).toBe('busy_try_again')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('a PaymentIntent that fails to create gives the hold back', async () => {
    mockCreate.mockRejectedValueOnce(new Error('stripe down'))
    const { status } = await post({ tiers: [{ tierId: 'ga', quantity: 1 }] })
    expect(status).toBeGreaterThanOrEqual(400)
    expect(releaseSeatHold).toHaveBeenCalledWith(MOCK_HOLD_ID, expect.anything())
  })

  it('an old single-tier client (tierId + quantity) still holds and checks out', async () => {
    const { status } = await post({ tierId: 'ga', quantity: 2 })
    expect(status).toBe(200)
    expect(createSeatHold).toHaveBeenLastCalledWith(
      expect.objectContaining({ quantity: 2, tierIncrements: [{ tierId: 'ga', quantity: 2 }] })
    )
  })
})
