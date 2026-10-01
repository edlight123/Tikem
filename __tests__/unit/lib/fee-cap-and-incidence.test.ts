/**
 * The per-ticket platform fee cap, and who pays it.
 *
 * Two rules with money on them:
 *  1. The cap is PER TICKET. If it were per order, four friends buying together
 *     would pay a quarter of what four separate buyers pay for the same seats —
 *     and every large order would arrive at the cap immediately.
 *  2. The organizer's own choice beats the country default, so an event can
 *     absorb or pass on the fee regardless of where it is.
 *
 * Cap figures come from DEFAULT_PLATFORM_SETTINGS: $5.00/ticket in US/CA/FR
 * (10%), 750 HTG/ticket in Haiti (5%).
 */

import { calculateCappedPlatformFee, calculateBuyerPricing } from '@/lib/fees'
import {
  priceOrder,
  priceOrderCents,
  incidenceForEvent,
  feeConfigForCountry,
} from '@/lib/checkout/buyer-pricing'

describe('calculateCappedPlatformFee', () => {
  it('leaves an uncapped fee alone', () => {
    expect(calculateCappedPlatformFee(10_000, 0.1, null)).toBe(1_000)
    expect(calculateCappedPlatformFee(10_000, 0.1, { capMinorPerTicket: null })).toBe(1_000)
  })

  it('caps a single expensive ticket', () => {
    // $100 at 10% is $10; the ceiling is $5.
    expect(calculateCappedPlatformFee(10_000, 0.1, { capMinorPerTicket: 500 })).toBe(500)
  })

  it('does not touch a ticket below the cap', () => {
    // $30 at 10% is $3, under the $5 ceiling.
    expect(calculateCappedPlatformFee(3_000, 0.1, { capMinorPerTicket: 500 })).toBe(300)
  })

  it('scales the cap with the number of tickets', () => {
    // 4 × $100 = $400 face. 10% would be $40; the ceiling is 4 × $5.
    expect(
      calculateCappedPlatformFee(40_000, 0.1, { capMinorPerTicket: 500, quantity: 4 })
    ).toBe(2_000)
  })

  it('treats a missing or nonsensical quantity as one ticket', () => {
    expect(calculateCappedPlatformFee(40_000, 0.1, { capMinorPerTicket: 500 })).toBe(500)
    expect(
      calculateCappedPlatformFee(40_000, 0.1, { capMinorPerTicket: 500, quantity: 0 })
    ).toBe(500)
    expect(
      calculateCappedPlatformFee(40_000, 0.1, { capMinorPerTicket: 500, quantity: -3 })
    ).toBe(500)
  })

  it('lets the cap win over the minimum-fee floor', () => {
    // The 50c floor would otherwise raise a fee the cap says must not exceed 10c.
    expect(calculateCappedPlatformFee(100, 0.1, { capMinorPerTicket: 10 })).toBe(10)
  })
})

describe('buyer pricing with a cap', () => {
  it('lowers what the buyer pays on an expensive ticket', () => {
    const uncapped = calculateBuyerPricing(10_000, 'buyer', 0.1)
    const capped = calculateBuyerPricing(10_000, 'buyer', 0.1, { capMinorPerTicket: 500 })
    expect(uncapped.chargeAmount).toBeGreaterThan(capped.chargeAmount)
    // $100 + the $5 capped fee; Stripe's cut is the platform's to absorb.
    expect(capped.chargeAmount).toBe(10_500)
    expect(capped.buyerFee).toBe(500)
  })

  it('still leaves the organizer exactly the face value', () => {
    const capped = calculateBuyerPricing(10_000, 'buyer', 0.1, { capMinorPerTicket: 500 })
    expect(capped.organizerNet).toBe(10_000)
  })

  it('raises what the organizer keeps under organizer incidence', () => {
    const uncapped = calculateBuyerPricing(10_000, 'organizer', 0.1)
    const capped = calculateBuyerPricing(10_000, 'organizer', 0.1, { capMinorPerTicket: 500 })
    expect(capped.chargeAmount).toBe(uncapped.chargeAmount) // buyer pays face either way
    expect(capped.organizerNet).toBeGreaterThan(uncapped.organizerNet)
    expect(capped.platformFee).toBe(500)
  })
})

describe('per-country configuration', () => {
  it('uses 10% in every market', () => {
    expect(feeConfigForCountry('US').platformFeePercentage).toBe(0.1)
    expect(feeConfigForCountry('CA').platformFeePercentage).toBe(0.1)
    expect(feeConfigForCountry('HT').platformFeePercentage).toBe(0.1)
  })

  it('denominates each cap in its own currency', () => {
    expect(feeConfigForCountry('US').platformFeeCapMinorByCurrency?.USD).toBe(500)
    expect(feeConfigForCountry('HT').platformFeeCapMinorByCurrency?.HTG).toBe(75_000)
  })

  it('lets stored settings override the defaults', () => {
    const cfg = feeConfigForCountry('US', { platformFeePercentage: 0.07 })
    expect(cfg.platformFeePercentage).toBe(0.07)
  })

  it('applies the cap only in a currency it is denominated for', () => {
    // A US event priced in a currency with no cap entry is uncapped rather than
    // capped by a number that means something else.
    const usd = priceOrderCents(10_000, { country: 'US', currency: 'USD' })
    const gbp = priceOrderCents(10_000, { country: 'US', currency: 'GBP' })
    expect(usd.platformFee).toBe(500)
    expect(gbp.platformFee).toBe(1_000)
  })

  it('falls back to the location currency when the caller gives none', () => {
    // A surface passing a bare country must not advertise an UNCAPPED fee while
    // checkout charges a capped one.
    expect(priceOrderCents(10_000, 'US').platformFee).toBe(500) // $5 ceiling
    // 10,000 HTG at 10% is 1,000 HTG, over the 750 HTG ceiling.
    expect(priceOrderCents(10_000_00, 'HT').platformFee).toBe(75_000)
  })

  it('never applies one currency ceiling to another currency', () => {
    // The $5 US ceiling read as gourdes would be 5 HTG and would wipe out the fee.
    const haiti = priceOrderCents(10_000_00, { country: 'HT', currency: 'HTG' })
    expect(haiti.platformFee).toBe(75_000)
    expect(haiti.platformFee).toBeGreaterThan(500)
  })
})

describe('who pays, per event', () => {
  it('falls back to the country default when the organizer has not chosen', () => {
    expect(incidenceForEvent({ country: 'US' })).toBe('buyer')
    expect(incidenceForEvent({ country: 'HT' })).toBe('organizer')
    expect(incidenceForEvent({ country: null })).toBe('organizer')
  })

  it('honours the organizer choice over the country default, both ways', () => {
    expect(incidenceForEvent({ country: 'HT', fee_incidence: 'buyer' })).toBe('buyer')
    expect(incidenceForEvent({ country: 'US', fee_incidence: 'organizer' })).toBe('organizer')
  })

  it('ignores a value that is not one of the two models', () => {
    expect(incidenceForEvent({ country: 'US', fee_incidence: 'nonsense' })).toBe('buyer')
    expect(incidenceForEvent({ country: 'HT', fee_incidence: '' })).toBe('organizer')
  })

  it('changes what a Haitian event charges when the organizer passes fees on', () => {
    const absorbed = priceOrder(1_000, { country: 'HT', currency: 'HTG' })
    const passedOn = priceOrder(1_000, {
      country: 'HT',
      currency: 'HTG',
      fee_incidence: 'buyer',
    })
    expect(absorbed.total).toBe(1_000) // buyer pays face, organizer nets less
    expect(passedOn.total).toBeGreaterThan(1_000)
    expect(passedOn.cents.organizerNet).toBe(100_000) // organizer keeps the full 1,000 HTG
  })

  it('accepts a bare country string, for surfaces that only have that', () => {
    expect(priceOrder(20, 'US', { currency: 'USD' }).total).toBeGreaterThan(20)
    expect(priceOrder(20, 'HT', { currency: 'HTG' }).total).toBe(20)
  })
})

describe('what the buyer sees at each price', () => {
  const feeFor = (face: number) =>
    priceOrder(face, { country: 'US', currency: 'USD' }, { quantity: 1, currency: 'USD' }).buyerFee

  it('is unchanged by the cap below $50 and reduced above it', () => {
    expect(feeFor(20)).toBeCloseTo(2, 2) // 10% of $20, under the cap
    expect(feeFor(50)).toBeCloseTo(5, 2) // 10% of $50, exactly at the cap
    expect(feeFor(100)).toBeCloseTo(5, 2) // capped at $5, not $10
    expect(feeFor(200)).toBeCloseTo(5, 2) // still $5
  })

  it('never exceeds Posh on a $100 ticket', () => {
    // Posh charges 10% + $0.99 per ticket: $10.99 on a $100 ticket.
    expect(feeFor(100)).toBeLessThan(10.99)
  })
})
