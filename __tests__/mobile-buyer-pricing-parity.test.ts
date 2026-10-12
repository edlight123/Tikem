/**
 * The Expo app duplicates the fee model, because it is a separate bundle and
 * cannot import the web's `lib/checkout/buyer-pricing.ts`. Duplicated money logic
 * drifts — one side gets a new rate and the other quietly keeps charging
 * the old one, and the symptom is a price on a card that does not match the price
 * on the payment sheet.
 *
 * So this suite asserts the two implementations agree, to the cent, across the
 * cases that actually differ: both fee models, both markets, high-priced tickets
 * that the retired per-ticket cap used to bound (there is no cap any more, owner
 * decision 2026-10-05), multi-ticket orders, and the organizer's own override.
 *
 * If this fails, do not "fix" the test — reconcile mobile/lib/buyerPricing.ts with
 * lib/fees.ts + types/platform-settings.ts, which are the source of truth.
 */

import { priceOrder as webPriceOrder } from '@/lib/checkout/buyer-pricing'
import {
  setPlatformFeeConfig,
  resetPlatformFeeConfig,
} from '@/lib/checkout/fee-config-store'
import {
  priceOrder as mobilePriceOrder,
  advertisedPrice as mobileAdvertisedPrice,
  incidenceForEvent as mobileIncidence,
  setFeeConfig as mobileSetFeeConfig,
  resetFeeConfig as mobileResetFeeConfig,
} from '../mobile/lib/buyerPricing'

type Case = {
  label: string
  face: number
  event: { country?: string | null; currency?: string | null; fee_incidence?: string | null }
  quantity: number
}

const CASES: Case[] = [
  { label: 'US $20 single', face: 20, event: { country: 'US', currency: 'USD' }, quantity: 1 },
  { label: 'US $50', face: 50, event: { country: 'US', currency: 'USD' }, quantity: 1 },
  { label: 'US $100', face: 100, event: { country: 'US', currency: 'USD' }, quantity: 1 },
  { label: 'US $200', face: 200, event: { country: 'US', currency: 'USD' }, quantity: 1 },
  {
    label: 'US 4 × $100',
    face: 400,
    event: { country: 'US', currency: 'USD' },
    quantity: 4,
  },
  { label: 'US $500 high-priced', face: 500, event: { country: 'US', currency: 'USD' }, quantity: 1 },
  {
    label: 'Haiti 50,000 HTG passed on',
    face: 50_000,
    event: { country: 'HT', currency: 'HTG', fee_incidence: 'buyer' },
    quantity: 1,
  },
  { label: 'Canada C$40', face: 40, event: { country: 'CA', currency: 'CAD' }, quantity: 1 },
  { label: 'France €30', face: 30, event: { country: 'FR', currency: 'EUR' }, quantity: 1 },
  { label: 'Haiti 1,000 HTG absorbed', face: 1_000, event: { country: 'HT', currency: 'HTG' }, quantity: 1 },
  {
    label: 'Haiti 10,000 HTG passed on',
    face: 10_000,
    event: { country: 'HT', currency: 'HTG', fee_incidence: 'buyer' },
    quantity: 1,
  },
  {
    label: 'US event the organizer chose to absorb',
    face: 60,
    event: { country: 'US', currency: 'USD', fee_incidence: 'organizer' },
    quantity: 2,
  },
  { label: 'unknown country', face: 25, event: { country: 'ZZ', currency: 'USD' }, quantity: 1 },
  { label: 'free order', face: 0, event: { country: 'US', currency: 'USD' }, quantity: 1 },
  { label: 'France 3 × €15', face: 45, event: { country: 'FR', currency: 'EUR' }, quantity: 3 },
  { label: 'Canada 2 × C$25', face: 50, event: { country: 'CA', currency: 'CAD' }, quantity: 2 },
  {
    label: 'France event the organizer chose to absorb',
    face: 20,
    event: { country: 'FR', currency: 'EUR', fee_incidence: 'organizer' },
    quantity: 1,
  },
  { label: 'US event with no currency on it', face: 30, event: { country: 'US' }, quantity: 2 },
  { label: 'Haiti event priced in USD', face: 40, event: { country: 'HT', currency: 'USD', fee_incidence: 'buyer' }, quantity: 2 },
  // Stored country values are not always ISO codes: both sides normalize.
  { label: 'country "USA"', face: 50, event: { country: 'USA', currency: 'USD' }, quantity: 1 },
  { label: 'country "United States"', face: 50, event: { country: 'United States' }, quantity: 2 },
  { label: 'country "Canada"', face: 40, event: { country: 'Canada' }, quantity: 1 },
  { label: 'country "France"', face: 30, event: { country: 'France' }, quantity: 1 },
  { label: 'country "france" lower-case', face: 30, event: { country: 'france', currency: 'EUR' }, quantity: 2 },
  { label: 'country "Haiti"', face: 1_000, event: { country: 'Haiti', currency: 'HTG' }, quantity: 1 },
]

describe('full country names resolve to their market', () => {
  it.each([
    { country: 'USA', currency: 'USD', fee: 3.99 },
    { country: 'United States', currency: 'USD', fee: 3.99 },
    { country: 'Canada', currency: 'CAD', fee: 3.99 },
    { country: 'France', currency: 'EUR', fee: 1.75 },
  ])('$country uses its market fee on both sides', ({ country, currency, fee }) => {
    const event = { country, currency }
    expect(webPriceOrder(50, event, { quantity: 1, currency }).buyerFee).toBeCloseTo(fee, 2)
    expect(mobilePriceOrder(50, event, { quantity: 1 }).buyerFee).toBeCloseTo(fee, 2)
  })
})

describe('mobile and web price an order identically', () => {
  it.each(CASES)('$label', ({ face, event, quantity }) => {
    const web = webPriceOrder(face, event, { quantity, currency: event.currency })
    const mobile = mobilePriceOrder(face, event, { quantity })

    expect(mobile.incidence).toBe(web.incidence)
    expect(mobile.feeOnTop).toBe(web.feeOnTop)
    expect(mobile.faceValue).toBeCloseTo(web.faceValue, 2)
    expect(mobile.buyerFee).toBeCloseTo(web.buyerFee, 2)
    expect(mobile.total).toBeCloseTo(web.total, 2)
  })
})

describe('mobile advertised price', () => {
  it('is the single-ticket all-in total', () => {
    const event = { country: 'US', currency: 'USD' }
    expect(mobileAdvertisedPrice(20, event)).toBeCloseTo(
      webPriceOrder(20, event, { quantity: 1, currency: 'USD' }).total,
      2
    )
  })

  it('leaves a Haitian price untouched', () => {
    expect(mobileAdvertisedPrice(1_500, { country: 'HT', currency: 'HTG' })).toBe(1_500)
  })
})

describe('both sides adopt a changed config identically', () => {
  // The rate is admin-editable. Web is seeded by FeeConfigProvider,
  // mobile by refreshFeeConfig from /api/platform/fee-config — two different
  // paths to the same numbers, which is exactly where they could diverge.
  const CHANGED = {
    // A cap table a server might still send is ignored by both sides.
    haiti: { platformFeePercentage: 0.08, platformFeeCapMinorByCurrency: { HTG: 50_000 } },
    usCanada: { platformFeePercentage: 0.06, platformFeeCapMinorByCurrency: { USD: 300 } },
    markets: {
      US: { platformFeePercentage: 0.05, fixedFeeMinorPerTicket: { USD: 79 } },
      FR: { platformFeePercentage: 0.03, fixedFeeMinorPerTicket: { EUR: 40 } },
    },
  }

  beforeEach(() => {
    setPlatformFeeConfig({
      haiti: { settlementHoldDays: 0, ...CHANGED.haiti },
      usCanada: { settlementHoldDays: 7, ...CHANGED.usCanada },
      markets: {
        US: { settlementHoldDays: 7, ...CHANGED.markets.US },
        FR: { settlementHoldDays: 7, ...CHANGED.markets.FR },
      },
    })
    mobileSetFeeConfig(CHANGED)
  })

  afterEach(() => {
    resetPlatformFeeConfig()
    mobileResetFeeConfig()
  })

  it.each([
    { label: 'US $20 at the lowered rate', face: 20, event: { country: 'US', currency: 'USD' }, quantity: 1 },
    { label: 'US $100 at the lowered rate', face: 100, event: { country: 'US', currency: 'USD' }, quantity: 1 },
    { label: 'US 3 × $80', face: 240, event: { country: 'US', currency: 'USD' }, quantity: 3 },
    { label: 'France 2 × €20 at the changed terms', face: 40, event: { country: 'FR', currency: 'EUR' }, quantity: 2 },
    { label: 'Canada keeps its shipped terms', face: 40, event: { country: 'CA', currency: 'CAD' }, quantity: 1 },
    { label: 'unknown country at the changed catch-all', face: 40, event: { country: 'ZZ', currency: 'USD' }, quantity: 1 },
    {
      label: 'Haiti 20,000 HTG passed on',
      face: 20_000,
      event: { country: 'HT', currency: 'HTG', fee_incidence: 'buyer' },
      quantity: 1,
    },
  ])('$label', ({ face, event, quantity }) => {
    const web = webPriceOrder(face, event, { quantity, currency: event.currency })
    const mobile = mobilePriceOrder(face, event, { quantity })
    expect(mobile.total).toBeCloseTo(web.total, 2)
    expect(mobile.buyerFee).toBeCloseTo(web.buyerFee, 2)
  })

  it('actually changed the price — otherwise this suite proves nothing', () => {
    const event = { country: 'US', currency: 'USD' }
    const seeded = mobilePriceOrder(100, event, { quantity: 1 }).total
    mobileResetFeeConfig()
    const shipped = mobilePriceOrder(100, event, { quantity: 1 }).total
    expect(seeded).not.toBeCloseTo(shipped, 2)
  })
})

describe('no per-ticket cap on either side', () => {
  it.each([
    { face: 500, event: { country: 'US', currency: 'USD' }, fee: 30.99 },
    { face: 200, event: { country: 'CA', currency: 'CAD' }, fee: 12.99 },
    { face: 200, event: { country: 'FR', currency: 'EUR' }, fee: 5.5 },
    { face: 50_000, event: { country: 'HT', currency: 'HTG', fee_incidence: 'buyer' }, fee: 5_000 },
  ])('$event.currency $face pays exactly its market fee', ({ face, event, fee }) => {
    expect(mobilePriceOrder(face, event, { quantity: 1 }).buyerFee).toBeCloseTo(fee, 2)
    expect(webPriceOrder(face, event, { quantity: 1, currency: event.currency }).buyerFee).toBeCloseTo(fee, 2)
  })

  it('ignores a cap table sent by the fee-config endpoint', () => {
    mobileSetFeeConfig({
      markets: { US: { platformFeePercentage: 0.06, platformFeeCapMinorByCurrency: { USD: 500 } } },
    } as any)
    try {
      expect(mobilePriceOrder(100, { country: 'US', currency: 'USD' }).buyerFee).toBeCloseTo(6.99, 2)
    } finally {
      mobileResetFeeConfig()
    }
  })
})

describe('mobile incidence resolution', () => {
  it('matches the web rules, including the organizer override', () => {
    expect(mobileIncidence({ country: 'US' })).toBe('buyer')
    expect(mobileIncidence({ country: 'HT' })).toBe('organizer')
    expect(mobileIncidence({ country: 'ZZ' })).toBe('organizer')
    expect(mobileIncidence({ country: null })).toBe('organizer')
    expect(mobileIncidence({ country: 'HT', fee_incidence: 'buyer' })).toBe('buyer')
    expect(mobileIncidence({ country: 'US', fee_incidence: 'organizer' })).toBe('organizer')
    expect(mobileIncidence({ country: 'US', fee_incidence: 'nonsense' })).toBe('buyer')
  })
})
