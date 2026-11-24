/**
 * Haiti card checkout: an international Visa/Mastercard on a Haiti event is a
 * Stripe PLATFORM charge in USD (no Connect destination), priced from the HTG
 * tier at the day's rate, with 3DS requested when required. The sale then
 * counts in the organizer's HTG balance and refunds in USD.
 *
 * Harness copied from create-payment-intent-multi-tier.test.ts, whose header follows.
 *
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
  tier('vip', 5000)
  tier('ga', 2500)
  tier('free', 0)
})

const { computeEventAvailability } = require('@/lib/payouts/availability')
const { planTicketRefund, refundFaceAmount } = require('@/lib/tickets/refundPlan')
const { resolveFundsRail } = require('@/lib/payouts/funds-rail')
const { DEFAULT_PAYOUT_RELEASE_CONFIG } = require('@/types/platform-settings')

describe('Haiti card checkout (Stripe platform charge)', () => {
  it('charges USD at the Stripe rate, with no Connect destination', async () => {
    const { status } = await post({ tierId: 'vip', quantity: 1 })
    expect(status).toBe(200)
    const pi = lastIntent()
    // 5,000 HTG x 0.0076 = 38.00 USD; the Haiti fee is absorbed by the organizer.
    expect(pi.amount).toBe(3800)
    expect(pi.currency).toBe('usd')
    expect(pi.transfer_data).toBeUndefined()
    expect(pi.application_fee_amount).toBeUndefined()
    expect(pi.metadata).toEqual(
      expect.objectContaining({
        payoutProvider: 'stripe_platform',
        fundsRail: 'stripe_platform',
        originalCurrency: 'HTG',
        exchangeRate: '0.0076',
        priceInOriginalCurrency: '5000',
        localFaceTotal: '5000',
      })
    )
    expect(pi.description).toContain('(5,000 HTG)')
  })

  it('requests 3D Secure whenever the issuer or Radar asks', async () => {
    await post({ tierId: 'ga', quantity: 2 })
    expect(lastIntent().payment_method_options).toEqual({ card: { request_three_d_secure: 'automatic' } })
    expect(lastIntent().automatic_payment_methods).toEqual({ enabled: true })
  })

  it('quotes the buyer the HTG total beside the USD charge', async () => {
    const { data } = await post({ tiers: [{ tierId: 'vip', quantity: 1 }, { tierId: 'ga', quantity: 2 }] })
    expect(data.pricing.currency).toBe('USD')
    expect(data.pricing.total).toBe(76)
    expect(data.pricing.local).toEqual({ currency: 'HTG', faceValue: 10000, buyerFee: 0, total: 10000, ratePerUsd: 131.58 })
  })

  it("refuses a card total under Stripe's $0.50 minimum, before holding seats", async () => {
    tier('tiny', 50) // 50 HTG = 0.38 USD
    const { status, data } = await post({ tierId: 'tiny', quantity: 1 })
    expect(status).toBe(400)
    expect(data.code).toBe('card_amount_too_small')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('the kill switch pauses Haiti card checkout', async () => {
    mockHaitiCard.enabled = false
    const ht = await post({ tierId: 'vip', quantity: 1 })
    expect(ht.status).toBe(409)
    expect(ht.data.code).toBe('haiti_card_unavailable')
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('a Haiti card sale, once issued', () => {
  const NOW = new Date('2026-11-20T12:00:00.000Z')
  const ended = new Date(NOW.getTime() - 400 * 3_600_000).toISOString()
  // The ticket lib/tickets/stripe-fulfillment.ts writes for the 5,000 HTG intent above.
  const cardTicket = (over: Record<string, any> = {}) => ({
    id: 'c1',
    event_id: 'evt1',
    status: 'valid',
    payment_method: 'stripe',
    funds_rail: 'stripe_platform',
    payment_id: 'pi_test',
    price_paid: 5000,
    currency: 'HTG',
    original_currency: 'HTG',
    exchange_rate_used: 0.0076,
    charged_amount: 38,
    charged_currency: 'USD',
    buyer_fee_charged_amount: 0,
    fee_incidence: 'organizer',
    checked_in: true,
    check_in_method: 'scan',
    purchased_at: '2026-11-01T10:00:00.000Z',
    ...over,
  })
  const moncashTicket = () => ({
    ...cardTicket(),
    id: 'm1',
    payment_method: 'moncash',
    funds_rail: 'moncash',
    payment_id: 'mm_1',
    charged_amount: 5000,
    charged_currency: 'HTG',
    exchange_rate_used: null,
  })
  const availability = (tickets: any[]) =>
    computeEventAvailability({
      event: { id: 'evt1', organizer_id: 'org1', currency: 'HTG', country: 'HT', status: 'published', end_datetime: ended },
      tickets,
      fee: { platformFeePercentage: 0.1, legacyCapMinorPerTicket: 75_000 },
      release: {
        history: { completedEvents: 5, lifetimeGrossMinor: 0, currency: 'HTG' },
        config: DEFAULT_PAYOUT_RELEASE_CONFIG,
        reviewStatus: null,
      },
      now: NOW,
    } as any)

  it("counts in the organizer's HTG balance exactly like a MonCash sale", () => {
    const card = availability([cardTicket()])
    const mm = availability([moncashTicket()])
    expect(card.currency).toBe('HTG')
    expect(card.reason).not.toBe('ticket_currency_review')
    expect(card.grossMinor).toBe(500_000)
    expect(card.grossMinor).toBe(mm.grossMinor)
    expect(card.balanceMinor).toBe(mm.balanceMinor)
    expect(card.balanceMinor).toBeGreaterThan(0)
    expect(card.heldByStripeMinor || 0).toBe(0)
  })

  it('refunds through Stripe in USD and takes the HTG face out of the balance', () => {
    const plan: any = planTicketRefund(cardTicket(), { includeServiceFee: true })
    expect(plan).toEqual(
      expect.objectContaining({ eligible: true, rail: 'stripe', amount: 38, currency: 'USD', paymentRef: 'pi_test' })
    )
    expect(refundFaceAmount(cardTicket())).toBe(5000)
    const refunded = availability([
      cardTicket({ status: 'refunded', refund_status: 'approved', refund_amount: 38, refund_currency: 'USD', refund_face_amount: 5000 }),
    ])
    expect(refunded.balanceMinor).toBe(0)
  })

  it("is placed on Tikèm's Stripe balance, even on an older ticket with no funds_rail", () => {
    expect(resolveFundsRail(cardTicket())).toBe('stripe_platform')
    const legacy: Record<string, any> = cardTicket()
    delete legacy.funds_rail
    expect(resolveFundsRail(legacy)).toBe('stripe_platform')
  })
})
