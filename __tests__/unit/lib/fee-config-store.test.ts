/**
 * An admin-edited rate has to reach the prices buyers READ, not only the charge.
 *
 * Display surfaces cannot await Firestore, so the resolved config is seeded into
 * a module-level store (by FeeConfigProvider on web, by refreshFeeConfig on
 * mobile) and read by `feeConfigForCountry`. These tests pin the two properties
 * that matter: a seeded change actually moves a displayed price, and a corrupt
 * setting can never move it to somewhere absurd.
 */

import {
  setPlatformFeeConfig,
  getPlatformFeeConfig,
  resetPlatformFeeConfig,
} from '@/lib/checkout/fee-config-store'
import { feeConfigForCountry, priceOrder } from '@/lib/checkout/buyer-pricing'
import { DEFAULT_MARKET_FEES, DEFAULT_PLATFORM_SETTINGS } from '@/types/platform-settings'

afterEach(() => resetPlatformFeeConfig())

const US_EVENT = { country: 'US', currency: 'USD' }
const US = DEFAULT_MARKET_FEES.US
const withUs = (us: Record<string, unknown>) => ({
  haiti: DEFAULT_PLATFORM_SETTINGS.haiti,
  usCanada: DEFAULT_PLATFORM_SETTINGS.usCanada,
  markets: { ...DEFAULT_MARKET_FEES, US: { ...US, ...us } as any },
})

describe('seeding the config in force', () => {
  it('starts from the compiled-in defaults', () => {
    expect(getPlatformFeeConfig().usCanada.platformFeePercentage).toBe(
      DEFAULT_PLATFORM_SETTINGS.usCanada.platformFeePercentage
    )
  })

  it('moves a DISPLAYED price when the rate changes', () => {
    const before = priceOrder(20, US_EVENT, { quantity: 1 }).total

    setPlatformFeeConfig(withUs({ platformFeePercentage: 0.03 }))

    const after = priceOrder(20, US_EVENT, { quantity: 1 }).total
    expect(after).toBeLessThan(before) // halving the rate has to show up
    expect(feeConfigForCountry('US').platformFeePercentage).toBe(0.03)
  })

  it('moves a DISPLAYED price when the fixed amount changes', () => {
    setPlatformFeeConfig(withUs({ fixedFeeMinorPerTicket: { USD: 49 } }))
    expect(priceOrder(20, US_EVENT, { quantity: 2 }).buyerFee).toBeCloseTo(1.2 + 0.98, 2)
  })

  it('leaves US prices alone when only the catch-all usCanada rate changes', () => {
    const before = priceOrder(20, US_EVENT, { quantity: 1 }).total
    setPlatformFeeConfig({
      haiti: DEFAULT_PLATFORM_SETTINGS.haiti,
      usCanada: { ...DEFAULT_PLATFORM_SETTINGS.usCanada, platformFeePercentage: 0.05 },
    })
    expect(priceOrder(20, US_EVENT, { quantity: 1 }).total).toBe(before)
    expect(feeConfigForCountry('GB').platformFeePercentage).toBe(0.05)
  })

  it('never moves a displayed price for a stored CAP: the per-ticket cap is retired', () => {
    const before = priceOrder(100, US_EVENT, { quantity: 1 }).total

    setPlatformFeeConfig(withUs({ platformFeeCapMinorByCurrency: { USD: 200 } })) // a stale $2.00 ceiling

    expect(priceOrder(100, US_EVENT, { quantity: 1 }).total).toBe(before)
    expect(priceOrder(100, US_EVENT, { quantity: 1 }).total).toBe(106.99)
  })

  it('returns to the defaults when cleared', () => {
    setPlatformFeeConfig(withUs({ platformFeePercentage: 0.02 }))
    setPlatformFeeConfig(null)
    expect(feeConfigForCountry('US').platformFeePercentage).toBe(US.platformFeePercentage)
  })
})

describe('a corrupt setting cannot poison a price', () => {
  const badRate = (platformFeePercentage: any) => setPlatformFeeConfig(withUs({ platformFeePercentage }))

  it.each([
    ['a percentage written as a whole number', 10],
    ['a negative rate', -0.5],
    ['not a number', 'ten'],
    ['undefined', undefined],
    ['NaN', NaN],
  ])('keeps the default rate for %s', (_label, value) => {
    badRate(value)
    expect(feeConfigForCountry('US').platformFeePercentage).toBe(US.platformFeePercentage)
  })

  it('drops junk fixed-fee entries instead of pricing them', () => {
    setPlatformFeeConfig(withUs({ fixedFeeMinorPerTicket: { usd: 99, CAD: -1, EUR: 'free' } as any }))
    expect(feeConfigForCountry('US').fixedFeeMinorPerTicket).toEqual({ USD: 99 })
  })

  it('keeps the default fixed amount when the stored table is not an object', () => {
    setPlatformFeeConfig(withUs({ fixedFeeMinorPerTicket: 'lots' as any }))
    expect(feeConfigForCountry('US').fixedFeeMinorPerTicket).toEqual({ USD: 99 })
  })

  it('drops a stored cap table entirely', () => {
    setPlatformFeeConfig(withUs({ platformFeeCapMinorByCurrency: { usd: 400, CAD: -1, EUR: 'free' } as any }))
    expect(feeConfigForCountry('US').platformFeeCapMinorByCurrency).toBeUndefined()
  })

  it('still prices an order when the config is nonsense', () => {
    setPlatformFeeConfig({ haiti: null as any, usCanada: undefined as any })
    const priced = priceOrder(20, US_EVENT, { quantity: 1 })
    expect(priced.total).toBeGreaterThan(20)
    expect(Number.isFinite(priced.total)).toBe(true)
  })
})
