/**
 * @jest-environment node
 *
 * lib/moncash/price-order.ts is the ONE pricing both /api/moncash-button/initiate
 * (which charges) and /api/moncash-button/quote (which shows the HTG figure
 * first) run. These pin the arithmetic, then prove the two routes agree.
 */

jest.mock('@/lib/firebase/admin', () => ({ adminDb: {}, adminAuth: {} }))
jest.mock('@/lib/rate-limit', () => ({
  clientIp: () => '127.0.0.1',
  consumeRateLimit: jest.fn(async () => ({ limited: false })),
}))

const RATE = {
  baseRate: 130,
  effectiveRate: 136.5,
  spreadPercent: 0.05,
  provider: 'https://open.er-api.com/v6/latest/USD',
  fetchedAtIso: '2026-10-12T00:02:31.000Z',
  source: 'live' as const,
}
jest.mock('@/lib/fx/usd-htg', () => ({
  ...jest.requireActual('@/lib/fx/usd-htg'),
  getUsdToHtgRateWithSpread: jest.fn(async () => RATE),
}))

// ── Fake Firestore-backed query builder (the routes' `supabase`) ──────────────
const db: Record<string, any[]> = { events: [], ticket_tiers: [], pending_transactions: [] }
function builder(collection: string) {
  const filters: Array<[string, any]> = []
  let inserted: any = null
  const run = () => {
    if (inserted) {
      db[collection].push(inserted)
      return { data: inserted, error: null }
    }
    const rows = db[collection].filter((r) => filters.every(([k, v]) => r[k] === v))
    return { data: rows, error: null }
  }
  const b: any = {
    select: () => b,
    eq: (k: string, v: any) => {
      filters.push([k, v])
      return b
    },
    update: () => b,
    insert: (row: any) => {
      inserted = row
      return b
    },
    single: async () => {
      const { data } = run()
      const row = Array.isArray(data) ? data[0] : data
      return row ? { data: row, error: null } : { data: null, error: { message: 'not found' } }
    },
    then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
  }
  return b
}
jest.mock('@/lib/firebase-db/server', () => ({
  createClient: async () => ({ from: (c: string) => builder(c) }),
}))

jest.mock('@/lib/auth', () => ({
  getCurrentUser: jest.fn(async () => ({ id: 'u1', email: 'buyer@example.com', full_name: 'Buyer' })),
}))
jest.mock('@/lib/guest/checkout', () => ({
  identityFromUser: (u: any) => ({ id: u.id, email: u.email, isGuest: false }),
  beginGuestCheckout: jest.fn(),
  guestOrderFields: () => ({}),
}))
const PROMO = { id: 'promo1', code: 'TEN', discount_type: 'percentage', discount_value: 10 }
jest.mock('@/lib/promo-codes', () => ({
  ...jest.requireActual('@/lib/promo-codes'),
  resolvePromoCode: jest.fn(async (_e: string, code: string) => (code === 'promo1' || code === 'TEN' ? PROMO : null)),
  promoCanCoverOrder: jest.fn(async () => ({ ok: true })),
  isPromoValidationLimited: jest.fn(async () => false),
  recordPromoValidationAttempt: jest.fn(async () => ({ limited: false })),
  recordFailedPromoValidation: jest.fn(async () => undefined),
}))
jest.mock('@/lib/promoters', () => ({ resolvePromoterCode: jest.fn(async () => null) }))
jest.mock('@/lib/tracking-links', () => ({ resolveOrderAttribution: jest.fn(async () => null) }))
jest.mock('@/lib/events/access-guard', () => ({ hasEventAccess: jest.fn(async () => true) }))
jest.mock('@/lib/tickets/purchase-screens', () => ({
  screenPurchaseAttempt: jest.fn(async () => ({ ok: true, log: async () => undefined })),
}))
jest.mock('@/lib/moncash-button', () => ({
  isMonCashButtonConfigured: () => true,
  createMonCashButtonCheckoutToken: jest.fn(),
  getMonCashButtonRedirectUrl: jest.fn(),
}))
jest.mock('@/lib/moncash', () => ({ prewarmMonCashAccessToken: jest.fn() }))
const HAITI_FEES = { platformFeePercentage: 0.1, settlementHoldDays: 7 }
jest.mock('@/lib/admin/platform-settings', () => ({ getPlatformSettings: jest.fn(async () => ({ haiti: HAITI_FEES })) }))
jest.mock('@/lib/tickets/orderAccess', () => ({ setOrderProofCookies: jest.fn() }))
jest.mock('@/lib/ops/ops-events', () => ({ scheduleOpsEvent: jest.fn(), recordOpsEvent: jest.fn() }))
jest.mock('next/server', () => ({ ...jest.requireActual('next/server'), after: jest.fn() }))

import {
  parseOrderLines,
  priceFaceSelections,
  priceMonCashCharge,
  type OrderLines,
  type PricingDocs,
} from '@/lib/moncash/price-order'
import { POST as initiate } from '@/app/api/moncash-button/initiate/route'
import { POST as quote } from '@/app/api/moncash-button/quote/route'

const future = new Date(Date.now() + 30 * 86_400_000).toISOString()
const event = (over: Record<string, any> = {}) => ({
  id: 'ev1',
  title: 'Konpa night',
  country: 'HT',
  currency: 'USD',
  is_published: true,
  status: 'published',
  start_datetime: future,
  ticket_price: 50,
  ...over,
})
const tier = (id: string, price: number, over: Record<string, any> = {}) => ({
  id,
  event_id: 'ev1',
  name: `Tier ${id}`,
  price,
  total_quantity: 100,
  sold_quantity: 0,
  is_active: true,
  ...over,
})

async function charge(ev: any, lines: OrderLines, docs: PricingDocs, opts: { tierId?: string; promo?: any } = {}) {
  const face = priceFaceSelections({ eventId: 'ev1', event: ev, lines, tierId: opts.tierId, docs, promo: opts.promo ?? null })
  if (!face.ok) throw new Error(face.error)
  const c = await priceMonCashCharge({ event: ev, face, feeConfig: HAITI_FEES })
  if (!c.ok) throw new Error(c.error)
  return { face, c }
}
const single = (qty: number) => parseOrderLines(undefined, qty) as OrderLines

describe('priceMonCashCharge', () => {
  it('USD, organizer absorbs: face only, converted per unit at base × 1.05', async () => {
    const { face, c } = await charge(event({ fee_incidence: 'organizer' }), single(2), {
      tierDocs: [],
      singleTier: tier('t1', 25),
      eventTiers: null,
    }, { tierId: 't1' })
    expect(face.originalAmount).toBe(50)
    expect(c.feeIncidence).toBe('organizer')
    expect(c.buyerFeeOriginal).toBe(0)
    expect(c.chargeSelections[0]).toMatchObject({ unitPrice: 3412.5, originalUnitPrice: 25 })
    expect(c.chargeAmount).toBe(6825)
    expect(c.exchange).toMatchObject({ base: 130, used: 136.5, spreadPercent: 0.05, source: 'live' })
    expect(c.exchange?.fetchedAt).toBe('2026-10-12T00:02:31.000Z')
  })

  it('USD, buyer pays: the 10% Haiti fee is ADDED and converted at the same rate', async () => {
    const { c } = await charge(event({ fee_incidence: 'buyer' }), single(2), {
      tierDocs: [],
      singleTier: tier('t1', 25),
      eventTiers: null,
    }, { tierId: 't1' })
    expect(c.feeIncidence).toBe('buyer')
    expect(c.buyerFeeOriginal).toBe(5)
    expect(c.buyerFeeCharged).toBe(682.5)
    expect(c.faceChargeAmount).toBe(6825)
    expect(c.chargeAmount).toBe(7507.5)
  })

  it('applies the promo before conversion', async () => {
    const { face, c } = await charge(event({ fee_incidence: 'organizer' }), single(1), {
      tierDocs: [],
      singleTier: tier('t1', 40),
      eventTiers: null,
    }, { tierId: 't1', promo: PROMO })
    expect(face.originalAmount).toBe(36)
    expect(face.promoDiscountTotal).toBe(4)
    expect(c.chargeAmount).toBe(4914) // 36 × 136.5
  })

  it('HTG event: no conversion, no rate recorded', async () => {
    const { c } = await charge(event({ currency: 'HTG', fee_incidence: 'organizer' }), single(3), {
      tierDocs: [],
      singleTier: tier('t1', 1500),
      eventTiers: null,
    }, { tierId: 't1' })
    expect(c.chargeCurrency).toBe('HTG')
    expect(c.chargeAmount).toBe(4500)
    expect(c.exchange).toBeNull()
  })

  it('multi-tier: rounds per unit, then sums without float drift', async () => {
    const lines = parseOrderLines(
      [
        { tierId: 'a', quantity: 2 },
        { tierId: 'b', quantity: 7 },
      ],
      undefined
    ) as OrderLines
    const { c } = await charge(event({ fee_incidence: 'organizer' }), lines, {
      tierDocs: [tier('a', 19.99), tier('b', 33.33)],
      singleTier: null,
      eventTiers: null,
    })
    // 19.99 × 136.5 = 2728.635 → 2728.64 ; 33.33 × 136.5 = 4549.545 → 4549.55 (per unit)
    expect(c.chargeSelections.map((s) => s.unitPrice)).toEqual([2728.64, 4549.55])
    expect(c.chargeAmount).toBe(Math.round((2 * 2728.64 + 7 * 4549.55) * 100) / 100)
    expect(String(c.chargeAmount).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2)
  })

  it('refuses a non-HTG/USD currency', async () => {
    const face = priceFaceSelections({
      eventId: 'ev1',
      event: event({ currency: 'EUR' }),
      lines: single(1),
      tierId: 't1',
      docs: { tierDocs: [], singleTier: tier('t1', 10), eventTiers: null },
      promo: null,
    })
    if (!face.ok) throw new Error('face')
    const c = await priceMonCashCharge({ event: event({ currency: 'EUR' }), face, feeConfig: HAITI_FEES })
    expect(c).toMatchObject({ ok: false, status: 400 })
  })

  it('turns "no trustworthy rate" into a translated 503, never the raw fetch error', async () => {
    const { FxRateUnavailableError } = jest.requireActual('@/lib/fx/usd-htg')
    const face = priceFaceSelections({
      eventId: 'ev1',
      event: event(),
      lines: single(1),
      tierId: 't1',
      docs: { tierDocs: [], singleTier: tier('t1', 10), eventTiers: null },
      promo: null,
    })
    if (!face.ok) throw new Error('face')
    const c = await priceMonCashCharge({
      event: event(),
      face,
      feeConfig: HAITI_FEES,
      lang: 'ht',
      getRate: async () => {
        throw new FxRateUnavailableError()
      },
    })
    expect(c).toMatchObject({ ok: false, status: 503, code: 'fx_rate_unavailable' })
    expect((c as any).error).toMatch(/to chanj/)
    expect((c as any).error).not.toMatch(/fetch failed/i)
  })
})

describe('quote == initiate', () => {
  const post = (body: any) =>
    new Request('https://www.tikem.co/api/moncash-button/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  beforeEach(() => {
    db.events = [event({ fee_incidence: 'buyer' })]
    db.ticket_tiers = [tier('a', 25), tier('b', 33.33)]
    db.pending_transactions = []
  })

  it.each([
    ['single tier with promo', { quantity: 2, tierId: 'a' }, 'TEN'],
    ['multi tier', { tiers: [{ tierId: 'a', quantity: 1 }, { tierId: 'b', quantity: 3 }] }, null],
  ])('%s', async (_label, lines, promo) => {
    const q = await quote(post({ eventId: 'ev1', ...lines, promoCodeId: promo }))
    expect(q.status).toBe(200)
    const qBody = await q.json()

    const i = await initiate(post({ eventId: 'ev1', ...lines, promoCode: promo, mobileMoneyProvider: 'moncash' }))
    expect(i.status).toBe(200)
    const order = db.pending_transactions[0]

    expect(qBody.amountHtg).toBe(order.amount)
    expect(qBody.originalCurrency).toBe('USD')
    expect(qBody.baseRate).toBe(order.exchange_rate_base)
    expect(qBody.effectiveRate).toBe(order.exchange_rate_used)
    expect(qBody.spreadPercent).toBe(order.exchange_rate_spread_percent)
    expect(qBody.buyerFeeOriginal).toBe(order.buyer_fee_original)
    expect(qBody.rateSource).toBe('live')
    expect(order.exchange_rate_source).toBe('live')
    expect(order.exchange_rate_fetched_at).toBe('2026-10-12T00:02:31.000Z')
    // The quote wrote nothing: exactly one pending order, from initiate.
    expect(db.pending_transactions).toHaveLength(1)
  })

  it('quote for an HTG event returns null rates', async () => {
    db.events = [event({ currency: 'HTG', fee_incidence: 'organizer' })]
    db.ticket_tiers = [tier('a', 1500)]
    const q = await quote(post({ eventId: 'ev1', quantity: 2, tierId: 'a' }))
    const body = await q.json()
    expect(body).toMatchObject({ amountHtg: 3000, originalCurrency: 'HTG', baseRate: null, effectiveRate: null, rateSource: null })
    expect(db.pending_transactions).toHaveLength(0)
  })
})
