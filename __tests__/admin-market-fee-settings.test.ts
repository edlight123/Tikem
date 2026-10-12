/**
 * @jest-environment node
 *
 * The admin settings form edits per-market terms (US, CA, FR) — the `markets`
 * field checkout, earnings and payouts actually price from — not the legacy
 * `usCanada` rate, which no longer affects those markets.
 */

import { parseMarketsInput, FEE_MARKET_CURRENCY } from '@/lib/admin/market-fee-settings'
import { setPlatformFeeConfig, resetPlatformFeeConfig, getPlatformFeeConfig } from '@/lib/checkout/fee-config-store'
import { locationFeesForCountry, fixedFeeMinorFor } from '@/types/platform-settings'

const valid = {
  US: { platformFeePercentage: 0.05, settlementHoldDays: 5, fixedFeeMinorPerTicket: { USD: 89 } },
  CA: { platformFeePercentage: 0.06, settlementHoldDays: 7, fixedFeeMinorPerTicket: { CAD: 99 } },
  FR: { platformFeePercentage: 0.025, settlementHoldDays: 7, fixedFeeMinorPerTicket: { EUR: 50 } },
}

describe('parseMarketsInput', () => {
  it('accepts complete per-market rows', () => {
    const r = parseMarketsInput(valid)
    expect(r).toEqual({ ok: true, value: valid })
  })

  it('accepts a subset of markets', () => {
    const r = parseMarketsInput({ FR: valid.FR })
    expect(r.ok && Object.keys(r.value)).toEqual(['FR'])
  })

  it.each([
    ['unknown market', { HT: valid.US }],
    ['rate of 100%', { US: { ...valid.US, platformFeePercentage: 1 } }],
    ['negative rate', { US: { ...valid.US, platformFeePercentage: -0.01 } }],
    ['fractional hold days', { US: { ...valid.US, settlementHoldDays: 1.5 } }],
    ['fixed fee in the wrong currency', { FR: { ...valid.FR, fixedFeeMinorPerTicket: { USD: 50 } } }],
    ['fixed fee in two currencies', { CA: { ...valid.CA, fixedFeeMinorPerTicket: { CAD: 99, USD: 99 } } }],
    ['fractional minor units', { US: { ...valid.US, fixedFeeMinorPerTicket: { USD: 0.99 } } }],
    ['missing fixed fee', { US: { platformFeePercentage: 0.06, settlementHoldDays: 7 } }],
    ['unknown field', { US: { ...valid.US, platformFeeCapMinorByCurrency: { USD: 500 } } }],
    ['empty object', {}],
    ['not an object', 'US'],
  ])('refuses %s', (_label, input) => {
    expect(parseMarketsInput(input).ok).toBe(false)
  })

  it('keys each market by its own currency', () => {
    expect(FEE_MARKET_CURRENCY).toEqual({ US: 'USD', CA: 'CAD', FR: 'EUR' })
  })
})

describe('what the form saves is what checkout prices', () => {
  afterEach(() => resetPlatformFeeConfig())

  it('a saved market row reaches locationFeesForCountry through sanitizeMarkets', () => {
    const parsed = parseMarketsInput(valid)
    if (!parsed.ok) throw new Error(parsed.error)
    // The legacy usCanada rate is left as stored and does not price US/CA/FR.
    setPlatformFeeConfig({
      haiti: { platformFeePercentage: 0.1, settlementHoldDays: 0 },
      usCanada: { platformFeePercentage: 0.1, settlementHoldDays: 7 },
      markets: parsed.value,
    })
    const us = locationFeesForCountry(getPlatformFeeConfig(), 'US')
    expect(us.platformFeePercentage).toBe(0.05)
    expect(fixedFeeMinorFor(us, 'USD')).toBe(89)
    const fr = locationFeesForCountry(getPlatformFeeConfig(), 'France')
    expect(fixedFeeMinorFor(fr, 'EUR')).toBe(50)
  })
})
