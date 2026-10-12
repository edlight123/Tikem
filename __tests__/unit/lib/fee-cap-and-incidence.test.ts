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
  platformFeeForSale,
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
  it('is per market (2026-10-11), and the shipped settings carry no cap', () => {
    expect(feeConfigForCountry('US')).toMatchObject({ platformFeePercentage: 0.06, fixedFeeMinorPerTicket: { USD: 99 } })
    expect(feeConfigForCountry('CA')).toMatchObject({ platformFeePercentage: 0.06, fixedFeeMinorPerTicket: { CAD: 99 } })
    expect(feeConfigForCountry('FR')).toMatchObject({ platformFeePercentage: 0.025, fixedFeeMinorPerTicket: { EUR: 50 } })
    expect(feeConfigForCountry('HT').platformFeePercentage).toBe(0.1)
    expect(feeConfigForCountry('HT').fixedFeeMinorPerTicket).toBeUndefined()
    // A country with no market of its own keeps the catch-all rate.
    expect(feeConfigForCountry('GB').platformFeePercentage).toBe(0.1)
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
      { event: { country: 'US', currency: 'USD' }, faceCents: 200_00, fee: 12_99 }, // was capped at $5
      { event: { country: 'CA', currency: 'CAD' }, faceCents: 200_00, fee: 12_99 }, // was C$7
      { event: { country: 'FR', currency: 'EUR' }, faceCents: 200_00, fee: 5_50 }, // was EUR 4.50
      { event: { country: 'HT', currency: 'HTG' }, faceCents: 50_000_00, fee: 5_000_00 }, // was 750 HTG
      { event: { country: 'HT', currency: 'USD' }, faceCents: 200_00, fee: 20_00 }, // was $5
    ]
    for (const { event, faceCents, fee } of cases) {
      for (const fee_incidence of ['buyer', 'organizer']) {
        const p = priceOrderCents(faceCents, { ...event, fee_incidence }, { quantity: 1 })
        expect(p.platformFee).toBe(fee)
      }
    }
  })

  it('charges the fixed part once per PAID ticket: four $100 tickets pay 6% of $400 + 4 × $0.99', () => {
    expect(priceOrderCents(400_00, { country: 'US', currency: 'USD' }, { quantity: 4 }).platformFee).toBe(27_96)
    expect(priceOrderCents(400_00, { country: 'US', currency: 'USD' }, { quantity: 1 }).platformFee).toBe(24_99)
    // A caller that forgets the quantity is priced as one ticket, never zero.
    expect(priceOrderCents(100_00, { country: 'US', currency: 'USD' }).platformFee).toBe(6_99)
  })

  it('never adds the fixed part to a free order', () => {
    const p = priceOrderCents(0, { country: 'FR', currency: 'EUR' }, { quantity: 3 })
    expect(p.platformFee).toBe(0)
    expect(p.chargeAmount).toBe(0)
  })

  it('only adds a fixed amount in the currency it is defined in', () => {
    // A US market amount is USD cents; a price in any other unit gets the rate only.
    expect(priceOrderCents(100_00, { country: 'US', currency: 'CAD' }, { quantity: 1 }).platformFee).toBe(6_00)
    // The options currency (what the card is charged in) wins over the event's.
    expect(
      priceOrderCents(100_00, { country: 'FR', currency: 'USD' }, { quantity: 2, currency: 'EUR' }).platformFee
    ).toBe(2_50 + 1_00)
  })

  it('a stored settings doc without markets still prices US/CA/FR at the market terms', () => {
    setPlatformFeeConfig({
      haiti: { platformFeePercentage: 0.1, settlementHoldDays: 0 },
      usCanada: { platformFeePercentage: 0.1, settlementHoldDays: 7 },
    })
    try {
      expect(priceOrderCents(20_00, { country: 'FR', currency: 'EUR' }, { quantity: 1 }).platformFee).toBe(1_00)
      expect(priceOrderCents(20_00, { country: 'CA', currency: 'CAD' }, { quantity: 1 }).platformFee).toBe(2_19)
    } finally {
      resetPlatformFeeConfig()
    }
  })

  it('ignores a cap table left on a stored settings doc', () => {
    setPlatformFeeConfig({
      haiti: { platformFeePercentage: 0.1, settlementHoldDays: 0, platformFeeCapMinorByCurrency: { HTG: 75_000 } },
      usCanada: { platformFeePercentage: 0.1, settlementHoldDays: 7, platformFeeCapMinorByCurrency: { USD: 500 } },
    })
    try {
      expect(priceOrderCents(100_00, { country: 'US', currency: 'USD' }).platformFee).toBe(6_99)
      expect(priceOrderCents(10_000_00, 'HT').platformFee).toBe(1_000_00)
      // Even passed straight in as the server's stored config.
      const stored = { platformFeePercentage: 0.1, platformFeeCapMinorByCurrency: { USD: 500 } }
      // (The stored rate replaces the market's; its fixed amount still applies.)
      expect(priceOrderCents(100_00, { country: 'US', currency: 'USD' }, { config: stored }).platformFee).toBe(10_99)
    } finally {
      resetPlatformFeeConfig()
    }
  })

  it('shows the buyer 6% + $0.99 at every price in the US', () => {
    const feeFor = (face: number) =>
      priceOrder(face, { country: 'US', currency: 'USD' }, { quantity: 1, currency: 'USD' }).buyerFee
    expect(feeFor(20)).toBeCloseTo(2.19, 2)
    expect(feeFor(50)).toBeCloseTo(3.99, 2)
    expect(feeFor(100)).toBeCloseTo(6.99, 2)
    expect(feeFor(200)).toBeCloseTo(12.99, 2)
  })

  it('shows the buyer 2.5% + €0.50 per ticket in France', () => {
    const feeFor = (face: number, quantity = 1) =>
      priceOrder(face, { country: 'FR', currency: 'EUR' }, { quantity, currency: 'EUR' }).buyerFee
    expect(feeFor(10)).toBeCloseTo(0.75, 2)
    expect(feeFor(20)).toBeCloseTo(1.0, 2)
    expect(feeFor(40, 2)).toBeCloseTo(2.0, 2)
  })
})

describe('a high-priced ticket pays exactly its market fee on every surface, and they agree', () => {
  // purchased after the cap was retired, so the payout engine applies the flat rate too
  const AFTER = new Date('2026-10-06T00:01:00.000Z').toISOString()
  const NOW = new Date('2026-11-05T00:00:00.000Z')

  const CASES = [
    { label: '$500 USD', face: 500, currency: 'USD', country: 'US', expectedFeeMinor: 30_99 },
    { label: 'C$150 CAD', face: 150, currency: 'CAD', country: 'CA', expectedFeeMinor: 9_99 },
    { label: '€60 EUR', face: 60, currency: 'EUR', country: 'FR', expectedFeeMinor: 2_00 },
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

describe('every sale, old or new, pays exactly the rate in payouts', () => {
  // The cap was retired before any real organizer sold, so no sale keeps it.
  it('ignores purchase date and any legacy cap', () => {
    const old = { legacyCapMinorPerTicket: 75_000, quantity: 1, purchasedAt: new Date('2026-09-01T00:00:00Z') }
    expect(platformFeeForSale(10_000_00, RATE, old)).toBe(1_000_00)
    expect(platformFeeForSale(10_000_00, RATE, { ...old, purchasedAt: null })).toBe(1_000_00)
    expect(platformFeeForSale(20_000_00, RATE, { ...old, quantity: 2 })).toBe(2_000_00)
    expect(platformFeeForSale(500_00, RATE)).toBe(calculatePlatformFeeWithPercentage(500_00, RATE))
  })

  it('adds the market fixed fee once per paid ticket in the order', () => {
    expect(platformFeeForSale(40_00, 0.025, { quantity: 2, fixedFeeMinorPerTicket: 50 })).toBe(1_00 + 1_00)
    expect(platformFeeForSale(0, 0.025, { quantity: 2, fixedFeeMinorPerTicket: 50 })).toBe(calculatePlatformFeeWithPercentage(0, 0.025))
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
