/**
 * The platform fee has NO per-ticket cap, and who pays it.
 *
 * Owner decision, 2026-10-05: the fee is always exactly the configured rate (10%
 * today, from DEFAULT_PLATFORM_SETTINGS / the stored platform settings) of the
 * ticket price, in every currency and country, whether the organizer absorbs it
 * or passes it on. The per-ticket cap that ran from 2026-08-13 (750 HTG, $5.00,
 * C$7.00, EUR 4.50) is gone from every surface that prices a NEW sale; only the
 * payout engine still honours it, for sales made while it was in force.
 *
 * Also pinned here: the organizer's own absorb/pass-on choice beats the country
 * default, so an event can do either regardless of where it is.
 */

import {
  calculateBuyerPricing,
  calculatePlatformFeeWithPercentage,
  legacyPlatformFeeCapMinor,
  platformFeeForSale,
  PLATFORM_FEE_CAP_RETIRED_AT,
} from '@/lib/fees'
import {
  priceOrder,
  priceOrderCents,
  incidenceForEvent,
  feeConfigForCountry,
} from '@/lib/checkout/buyer-pricing'
import { setPlatformFeeConfig, resetPlatformFeeConfig } from '@/lib/checkout/fee-config-store'
import { feeRuleForEvent } from '@/lib/payouts/availability-server'
import { computeEventAvailability } from '@/lib/payouts/availability'
import { DEFAULT_PAYOUT_RELEASE_CONFIG, DEFAULT_PLATFORM_SETTINGS } from '@/types/platform-settings'
import {
  priceOrder as mobilePriceOrder,
  organizerNet as mobileOrganizerNet,
} from '../../../mobile/lib/buyerPricing'

jest.mock('@/lib/firebase/admin', () => ({ adminDb: {}, adminAuth: {} }))

const RATE = DEFAULT_PLATFORM_SETTINGS.haiti.platformFeePercentage

describe('the configured rate', () => {
  it('is 10% in every market, and the shipped settings carry no cap', () => {
    expect(feeConfigForCountry('US').platformFeePercentage).toBe(0.1)
    expect(feeConfigForCountry('CA').platformFeePercentage).toBe(0.1)
    expect(feeConfigForCountry('HT').platformFeePercentage).toBe(0.1)
    expect(DEFAULT_PLATFORM_SETTINGS.haiti.platformFeeCapMinorByCurrency).toBeUndefined()
    expect(DEFAULT_PLATFORM_SETTINGS.usCanada.platformFeeCapMinorByCurrency).toBeUndefined()
  })

  it('lets stored settings override the defaults', () => {
    const cfg = feeConfigForCountry('US', { platformFeePercentage: 0.07 })
    expect(cfg.platformFeePercentage).toBe(0.07)
  })
})

describe('no per-ticket cap on a new sale', () => {
  it('charges the buyer exactly the rate on top, however expensive the ticket', () => {
    const p = calculateBuyerPricing(500_00, 'buyer', 0.1)
    expect(p.platformFee).toBe(50_00)
    expect(p.buyerFee).toBe(50_00)
    expect(p.chargeAmount).toBe(550_00)
    expect(p.organizerNet).toBe(500_00)
  })

  it('takes exactly the rate from the organizer when they absorb it', () => {
    const p = calculateBuyerPricing(500_00, 'organizer', 0.1)
    expect(p.chargeAmount).toBe(500_00)
    expect(p.platformFee).toBe(50_00)
    expect(p.organizerNet).toBe(450_00)
  })

  it('applies in every currency and country the old cap table covered', () => {
    const cases = [
      { event: { country: 'US', currency: 'USD' }, faceCents: 200_00 }, // was capped at $5
      { event: { country: 'CA', currency: 'CAD' }, faceCents: 200_00 }, // was C$7
      { event: { country: 'FR', currency: 'EUR' }, faceCents: 200_00 }, // was EUR 4.50
      { event: { country: 'HT', currency: 'HTG' }, faceCents: 50_000_00 }, // was 750 HTG
      { event: { country: 'HT', currency: 'USD' }, faceCents: 200_00 }, // was $5
    ]
    for (const { event, faceCents } of cases) {
      for (const fee_incidence of ['buyer', 'organizer']) {
        const p = priceOrderCents(faceCents, { ...event, fee_incidence }, { quantity: 1 })
        expect(p.platformFee).toBe(faceCents / 10)
      }
    }
  })

  it('does not depend on ticket count: four $100 tickets pay 10% of $400', () => {
    expect(priceOrderCents(400_00, { country: 'US', currency: 'USD' }, { quantity: 4 }).platformFee).toBe(40_00)
    expect(priceOrderCents(400_00, { country: 'US', currency: 'USD' }, { quantity: 1 }).platformFee).toBe(40_00)
  })

  it('ignores a cap table left on a stored settings doc', () => {
    setPlatformFeeConfig({
      haiti: { platformFeePercentage: 0.1, settlementHoldDays: 0, platformFeeCapMinorByCurrency: { HTG: 75_000 } },
      usCanada: { platformFeePercentage: 0.1, settlementHoldDays: 7, platformFeeCapMinorByCurrency: { USD: 500 } },
    })
    try {
      expect(priceOrderCents(100_00, 'US').platformFee).toBe(10_00)
      expect(priceOrderCents(10_000_00, 'HT').platformFee).toBe(1_000_00)
      // Even passed straight in as the server's stored config.
      const stored = { platformFeePercentage: 0.1, platformFeeCapMinorByCurrency: { USD: 500 } }
      expect(priceOrderCents(100_00, { country: 'US', currency: 'USD' }, { config: stored }).platformFee).toBe(10_00)
    } finally {
      resetPlatformFeeConfig()
    }
  })

  it('shows the buyer 10% at every price', () => {
    const feeFor = (face: number) =>
      priceOrder(face, { country: 'US', currency: 'USD' }, { quantity: 1, currency: 'USD' }).buyerFee
    expect(feeFor(20)).toBeCloseTo(2, 2)
    expect(feeFor(50)).toBeCloseTo(5, 2)
    expect(feeFor(100)).toBeCloseTo(10, 2)
    expect(feeFor(200)).toBeCloseTo(20, 2)
  })
})

describe('a high-priced ticket pays exactly 10% on every surface, and they agree', () => {
  // purchased after the cap was retired, so the payout engine applies the flat rate too
  const AFTER = new Date(PLATFORM_FEE_CAP_RETIRED_AT.getTime() + 60_000).toISOString()
  const NOW = new Date(PLATFORM_FEE_CAP_RETIRED_AT.getTime() + 30 * 24 * 3_600_000)

  const CASES = [
    { label: '$500 USD', face: 500, currency: 'USD', country: 'US', expectedFeeMinor: 50_00 },
    { label: '50,000 HTG', face: 50_000, currency: 'HTG', country: 'HT', expectedFeeMinor: 5_000_00 },
  ] as const

  function payoutFor(c: (typeof CASES)[number], fee_incidence: 'buyer' | 'organizer') {
    const event = {
      id: 'evt1',
      organizer_id: 'org1',
      currency: c.currency,
      country: c.country,
      status: 'published',
      end_datetime: new Date(NOW.getTime() - 200 * 3_600_000).toISOString(),
    }
    return computeEventAvailability({
      event,
      tickets: [
        {
          id: 't1',
          event_id: 'evt1',
          status: 'valid',
          price_paid: c.face,
          currency: c.currency,
          payment_method: 'stripe',
          payment_id: 'pay1',
          fee_incidence,
          checked_in: true,
          check_in_method: 'scan',
          purchased_at: AFTER,
        },
      ],
      // The rule the server loader builds from the shipped settings.
      fee: feeRuleForEvent(event, DEFAULT_PLATFORM_SETTINGS),
      release: {
        history: { completedEvents: 5, lifetimeGrossMinor: 0, currency: c.currency },
        config: DEFAULT_PAYOUT_RELEASE_CONFIG,
        reviewStatus: null,
      },
      now: NOW,
    })
  }

  it.each(CASES)('$label passed on to the buyer', (c) => {
    const event = { country: c.country, currency: c.currency, fee_incidence: 'buyer' }
    const web = priceOrderCents(c.face * 100, event, { quantity: 1 })
    const mobile = mobilePriceOrder(c.face, event, { quantity: 1 })

    expect(web.platformFee).toBe(c.expectedFeeMinor)
    expect(web.buyerFee).toBe(c.expectedFeeMinor)
    expect(Math.round(mobile.buyerFee * 100)).toBe(c.expectedFeeMinor)
    expect(Math.round(mobile.total * 100)).toBe(web.chargeAmount)

    // The organizer nets face value; nothing is deducted at payout.
    const payout = payoutFor(c, 'buyer')
    expect(payout.platformFeeMinor).toBe(0)
    expect(payout.netMinor).toBe(c.face * 100)
    expect(payout.netMinor).toBe(web.organizerNet)
  })

  it.each(CASES)('$label absorbed by the organizer', (c) => {
    const event = { country: c.country, currency: c.currency, fee_incidence: 'organizer' }
    const web = priceOrderCents(c.face * 100, event, { quantity: 1 })
    const mobileNet = mobileOrganizerNet(c.face, event, { quantity: 1 })

    expect(web.platformFee).toBe(c.expectedFeeMinor)
    expect(web.chargeAmount).toBe(c.face * 100)
    expect(Math.round(mobileNet * 100)).toBe(web.organizerNet)

    const payout = payoutFor(c, 'organizer')
    expect(payout.platformFeeMinor).toBe(c.expectedFeeMinor)
    expect(payout.netMinor).toBe(c.face * 100 - c.expectedFeeMinor)
    expect(payout.netMinor).toBe(web.organizerNet)
  })
})

describe('sales made while the cap was in force keep their capped fee in payouts', () => {
  const BEFORE = new Date(PLATFORM_FEE_CAP_RETIRED_AT.getTime() - 60_000)
  const AFTER = new Date(PLATFORM_FEE_CAP_RETIRED_AT.getTime() + 60_000)

  it('knows the retired ceilings per location and currency', () => {
    expect(legacyPlatformFeeCapMinor('haiti', 'HTG')).toBe(75_000)
    expect(legacyPlatformFeeCapMinor('haiti', 'USD')).toBe(500)
    expect(legacyPlatformFeeCapMinor('haiti', 'CAD')).toBeNull() // was uncapped then too
    expect(legacyPlatformFeeCapMinor('us-canada', 'usd')).toBe(500)
    expect(legacyPlatformFeeCapMinor('us-canada', 'CAD')).toBe(700)
    expect(legacyPlatformFeeCapMinor('us-canada', 'EUR')).toBe(450)
  })

  it('caps a sale from before the change, scaled by the order quantity', () => {
    const sale = { legacyCapMinorPerTicket: 75_000, quantity: 1, purchasedAt: BEFORE }
    expect(platformFeeForSale(10_000_00, RATE, sale)).toBe(75_000)
    expect(platformFeeForSale(20_000_00, RATE, { ...sale, quantity: 2 })).toBe(150_000)
    expect(platformFeeForSale(1_000_00, RATE, sale)).toBe(10_000) // under the cap, untouched
  })

  it('treats a sale with no purchase date as a capped-era sale', () => {
    expect(platformFeeForSale(10_000_00, RATE, { legacyCapMinorPerTicket: 75_000, quantity: 1, purchasedAt: null })).toBe(75_000)
  })

  it('charges a sale from after the change exactly the rate', () => {
    const sale = { legacyCapMinorPerTicket: 75_000, quantity: 1, purchasedAt: AFTER }
    expect(platformFeeForSale(10_000_00, RATE, sale)).toBe(1_000_00)
    expect(platformFeeForSale(10_000_00, RATE, sale)).toBe(calculatePlatformFeeWithPercentage(10_000_00, RATE))
  })

  it('leaves a currency that never had a cap uncapped either way', () => {
    expect(platformFeeForSale(500_00, RATE, { legacyCapMinorPerTicket: null, quantity: 1, purchasedAt: BEFORE })).toBe(50_00)
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
    expect(passedOn.total).toBe(1_100)
    expect(passedOn.cents.organizerNet).toBe(100_000) // organizer keeps the full 1,000 HTG
  })

  it('accepts a bare country string, for surfaces that only have that', () => {
    expect(priceOrder(20, 'US', { currency: 'USD' }).total).toBeGreaterThan(20)
    expect(priceOrder(20, 'HT', { currency: 'HTG' }).total).toBe(20)
  })
})
