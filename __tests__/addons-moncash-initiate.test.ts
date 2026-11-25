/**
 * @jest-environment node
 *
 * MonCash with add-ons (lib/addons/addOns.ts): initiate + quote price them from
 * the STORED event, hold their stock with the seats, store the lines on the
 * pending order, and run ONE fee over tickets + add-ons. Harness from moncash-price-order.test.ts.
 */

// An empty store: no earlier free ticket and no free-claim lock for this buyer.
jest.mock('@/lib/firebase/admin', () => {
  const empty: any = {
    where: () => empty,
    doc: () => empty,
    get: async () => ({ docs: [], exists: false, data: () => undefined }),
  }
  return { adminDb: { collection: () => empty }, adminAuth: {} }
})
jest.mock('@/lib/rate-limit', () => ({
  clientIp: () => '127.0.0.1', clientIpKey: () => '127.0.0.1',
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
// Seat holds have their own suite (seat-holds-inventory.test.ts); here a hold always succeeds.
jest.mock('@/lib/tickets/seatHolds', () => ({
  ...jest.requireActual('@/lib/tickets/seatHolds'),
  createSeatHold: jest.fn(async () => ({
    ok: true,
    reservationId: `hold_${'b'.repeat(32)}`,
    holdId: `hold_${'b'.repeat(32)}`,
    expiresAt: Date.now() + 480_000,
  })),
  releaseSeatHold: jest.fn(async () => true),
}))
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

import { createSeatHold } from '@/lib/tickets/seatHolds'

const future = new Date(Date.now() + 30 * 86_400_000).toISOString()
const event = (over: Record<string, any> = {}) => ({
  id: 'ev1',
  title: 'Konpa night',
  country: 'HT',
  currency: 'HTG',
  is_published: true,
  status: 'published',
  start_datetime: future,
  ticket_price: 1000,
  fee_incidence: 'buyer',
  add_ons_enabled: true,
  add_ons: [
    { id: 'ao_bottle', name: 'Bottle package', price: 5000, quantity: 10, tier_ids: ['vip'] },
    { id: 'ao_shirt', name: 'T-shirt', price: 1500, options: ['S', 'M', 'L'], max_per_order: 4 },
    { id: 'ao_park', name: 'Parking', price: 500 },
  ],
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

const post = (body: any) =>
  new Request('https://www.tikem.co/api/moncash-button/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  db.events = [event()]
  db.ticket_tiers = [tier('ga', 1000), tier('vip', 3000), tier('free', 0)]
  db.pending_transactions = []
  ;(createSeatHold as jest.Mock).mockClear()
})

describe('priceMonCashCharge with add-ons', () => {
  it('HTG event: add-ons join the face; ONE 10% fee over the whole subtotal; fee split by face', async () => {
    const ev = event()
    const lines = parseOrderLines([{ tierId: 'vip', quantity: 2 }], 1) as OrderLines
    const face = priceFaceSelections({
      eventId: 'ev1',
      event: ev,
      lines,
      docs: { tierDocs: [tier('vip', 3000)], singleTier: null, eventTiers: null } as PricingDocs,
      promo: null,
    })
    if (!face.ok) throw new Error(face.error)
    const c = await priceMonCashCharge({
      event: ev,
      face,
      feeConfig: HAITI_FEES,
      addOnLines: [{ addOnId: 'ao_bottle', name: 'Bottle package', option: null, quantity: 1, unitPrice: 5000 }],
    })
    if (!c.ok) throw new Error(c.error)
    // Tickets 6,000 + bottle 5,000 = 11,000 HTG face; 10% fee 1,100 on top.
    expect(c.faceChargeAmount).toBe(11000)
    expect(c.buyerFeeOriginal).toBe(1100)
    expect(c.chargeAmount).toBe(12100)
    expect(c.addOnFaceOriginal).toBe(5000)
    expect(c.addOnFaceCharged).toBe(5000)
    // 1,100 x 5,000 / 11,000 = 500
    expect(c.addOnFeeOriginal).toBe(500)
    expect(c.addOnFeeCharged).toBe(500)
    expect(c.addOnLines).toEqual([expect.objectContaining({ addOnId: 'ao_bottle', chargeUnitPrice: 5000 })])
  })

  it('USD event: each add-on is converted per unit at the same rate as the tickets', async () => {
    const ev = event({ currency: 'USD', add_ons: [{ id: 'ao_park', name: 'Parking', price: 10 }] })
    const lines = parseOrderLines([{ tierId: 'a', quantity: 1 }], 1) as OrderLines
    const face = priceFaceSelections({
      eventId: 'ev1',
      event: ev,
      lines,
      docs: { tierDocs: [tier('a', 25)], singleTier: null, eventTiers: null } as PricingDocs,
      promo: null,
    })
    if (!face.ok) throw new Error(face.error)
    const c = await priceMonCashCharge({
      event: ev,
      face,
      feeConfig: HAITI_FEES,
      addOnLines: [{ addOnId: 'ao_park', name: 'Parking', option: null, quantity: 2, unitPrice: 10 }],
    })
    if (!c.ok) throw new Error(c.error)
    // 10 USD x 136.5 = 1,365 HTG per unit
    expect(c.addOnLines[0].chargeUnitPrice).toBe(1365)
    expect(c.addOnFaceCharged).toBe(2730)
    expect(c.addOnFaceOriginal).toBe(20)
    expect(c.buyerFeeOriginal).toBe(4.5)
    expect(c.chargeAmount).toBeCloseTo(c.faceChargeAmount + c.buyerFeeCharged, 2)
  })

  it('without add-ons nothing changes', async () => {
    const ev = event()
    const lines = parseOrderLines(undefined, 2) as OrderLines
    const face = priceFaceSelections({
      eventId: 'ev1',
      event: ev,
      lines,
      tierId: 'ga',
      docs: { tierDocs: [], singleTier: tier('ga', 1000), eventTiers: null } as PricingDocs,
      promo: null,
    })
    if (!face.ok) throw new Error(face.error)
    const c = await priceMonCashCharge({ event: ev, face, feeConfig: HAITI_FEES })
    if (!c.ok) throw new Error(c.error)
    expect(c.chargeAmount).toBe(2200)
    expect(c.addOnLines).toEqual([])
    expect(c.addOnFeeCharged).toBe(0)
  })
})

describe('MonCash initiate + quote with add-ons', () => {
  it('stores the priced lines on the order, holds their stock with the seats, and the quote agrees', async () => {
    const body = {
      eventId: 'ev1',
      tiers: [{ tierId: 'vip', quantity: 2 }],
      addOns: [
        { id: 'ao_bottle', quantity: 1 },
        { id: 'ao_shirt', option: 'm', quantity: 2, price: 1 },
      ],
    }
    const q = await quote(post(body))
    expect(q.status).toBe(200)
    const qBody = await q.json()

    const i = await initiate(post({ ...body, mobileMoneyProvider: 'moncash' }))
    expect(i.status).toBe(200)
    const order = db.pending_transactions[0]
    // Tickets 6,000 + bottle 5,000 + 2 shirts 3,000 = 14,000; fee 1,400.
    expect(order.amount).toBe(15400)
    expect(qBody.amountHtg).toBe(order.amount)
    expect(qBody.addOnSubtotal).toBe(8000)
    expect(qBody.amountOriginal).toBe(15400)
    // original_amount stays the TICKETS' face; the add-ons ride separately.
    expect(order.original_amount).toBe(6000)
    expect(order.add_ons_face_amount).toBe(8000)
    expect(order.add_ons_charge_amount).toBe(8000)
    // 1,400 x 8,000 / 14,000 = 800
    expect(order.add_ons_buyer_fee).toBe(800)
    expect(order.add_ons_buyer_fee_original).toBe(800)
    expect(order.add_on_lines).toEqual([
      { addOnId: 'ao_bottle', name: 'Bottle package', option: null, quantity: 1, unitPrice: 5000, chargeUnitPrice: 5000 },
      // The option is matched to the stored label; the client's price is ignored.
      { addOnId: 'ao_shirt', name: 'T-shirt', option: 'M', quantity: 2, unitPrice: 1500, chargeUnitPrice: 1500 },
    ])
    expect(createSeatHold).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: 2,
        addOnIncrements: [
          { addOnId: 'ao_bottle', quantity: 1 },
          { addOnId: 'ao_shirt', quantity: 2 },
        ],
      })
    )
  })

  it('refuses a VIP-only bottle package with GA tickets, before any hold or order', async () => {
    const res = await initiate(
      post({ eventId: 'ev1', tiers: [{ tierId: 'ga', quantity: 1 }], addOns: [{ id: 'ao_bottle', quantity: 1 }], mobileMoneyProvider: 'moncash' })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('addon_needs_tier')
    expect(createSeatHold).not.toHaveBeenCalled()
    expect(db.pending_transactions).toHaveLength(0)
  })

  it('refuses a size that does not exist and a shirt with no size', async () => {
    const one = [{ tierId: 'ga', quantity: 1 }]
    const noSize = await initiate(post({ eventId: 'ev1', tiers: one, addOns: [{ id: 'ao_shirt', quantity: 1 }] }))
    expect((await noSize.json()).code).toBe('addon_option_required')
    const badSize = await initiate(post({ eventId: 'ev1', tiers: one, addOns: [{ id: 'ao_shirt', option: 'XXL', quantity: 1 }] }))
    expect((await badSize.json()).code).toBe('addon_option_invalid')
    expect(db.pending_transactions).toHaveLength(0)
  })

  it('a free ticket + paid parking is a MonCash order for the parking only', async () => {
    const res = await initiate(
      post({ eventId: 'ev1', tiers: [{ tierId: 'free', quantity: 1 }], addOns: [{ id: 'ao_park', quantity: 1 }], mobileMoneyProvider: 'moncash' })
    )
    expect(res.status).toBe(200)
    const order = db.pending_transactions[0]
    expect(order.original_amount).toBe(0)
    expect(order.amount).toBe(550)
  })

  it('a free ticket alone is still refused as free', async () => {
    const res = await initiate(post({ eventId: 'ev1', tiers: [{ tierId: 'free', quantity: 1 }], mobileMoneyProvider: 'moncash' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('order_is_free')
  })
})
