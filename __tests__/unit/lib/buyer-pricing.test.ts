/**
 * WHO PAYS THE FEE — the money contract of checkout.
 *
 * Two properties matter more than any individual number here:
 *
 *   1. Haiti must be BYTE-IDENTICAL to the behaviour that shipped before fee
 *      incidence existed: the buyer is charged the advertised price, and the
 *      Connect application fee is platform fee + processing fee.
 *   2. In a buyer-pays market the organizer must net EXACTLY the face value after
 *      Stripe takes its cut of the (larger) charge — that is the whole point of the
 *      gross-up, and it is the thing an "add the fee on top" implementation gets
 *      subtly wrong by leaving the platform short of Stripe's percentage on the fee.
 *
 * @jest-environment node
 */

import { calculateFees, calculatePlatformFeeWithPercentage } from '@/lib/fees'
import { DEFAULT_PLATFORM_SETTINGS } from '@/types/platform-settings'
import { applicationFeeFor, feeOnTopFor, priceOrder, priceOrderCents } from '@/lib/checkout/buyer-pricing'

describe('fee incidence by country', () => {
  it('adds the fee on top only in buyer-pays markets', () => {
    expect(feeOnTopFor('US')).toBe(true)
    expect(feeOnTopFor('CA')).toBe(true)
    expect(feeOnTopFor('FR')).toBe(true)
    expect(feeOnTopFor('HT')).toBe(false)
    // Unrecognised countries fall back to organizer-pays: an unknown market can
    // never silently start charging buyers more than the advertised price.
    expect(feeOnTopFor('ZZ')).toBe(false)
    expect(feeOnTopFor(undefined)).toBe(false)
  })
})

describe('Haiti — organizer pays, nothing about the charge changes', () => {
  it('charges exactly the face value and shows no buyer fee', () => {
    const p = priceOrderCents(1000_00, 'HT')
    expect(p.chargeAmount).toBe(1000_00)
    expect(p.buyerFee).toBe(0)
    expect(p.incidence).toBe('organizer')
  })

  it('collects the platform fee CONFIGURED for Haiti, not a hardcoded constant', () => {
    // This route used to charge every country the 10% baked into FEE_CONFIG while
    // the earnings ledger computed whatever the platform settings said, so the fee
    // an organizer was charged and the fee their ledger showed could disagree.
    // Both now read the same configured rate — which is what makes the rate
    // tunable at all, whatever value it holds.
    for (const faceCents of [500, 2000, 12_34, 1000_00]) {
      const p = priceOrderCents(faceCents, 'HT')
      const expectedPlatformFee = calculatePlatformFeeWithPercentage(
        faceCents,
        DEFAULT_PLATFORM_SETTINGS.haiti.platformFeePercentage
      )
      expect(p.platformFee).toBe(expectedPlatformFee)
      // Processing is Tikèm's to absorb: the organizer gives up the platform fee only.
      expect(applicationFeeFor(p)).toBe(Math.min(faceCents, expectedPlatformFee))
      expect(p.organizerNet).toBe(Math.max(0, faceCents - expectedPlatformFee))
    }
  })

  it('charges exactly the flat 10% the route always applied, with no per-ticket cap', () => {
    // Haiti sits at the same 10% as everywhere else and there is no cap (owner
    // decision, 2026-10-05), so the fee is the plain-rate path at every price.
    for (const faceCents of [2000, 1000_00, 10_000_00, 50_000_00]) {
      expect(priceOrderCents(faceCents, 'HT').platformFee).toBe(calculateFees(faceCents).platformFee)
    }
    // A 10,000 HTG ticket carries 1,000 HTG (it was capped at 750 until the change).
    expect(priceOrderCents(10_000_00, 'HT').platformFee).toBe(1_000_00)
  })
})

describe('US/CA/FR — buyer pays, organizer keeps the face value', () => {
  it('charges above the face value and itemizes the difference', () => {
    const p = priceOrderCents(20_00, 'US')
    expect(p.chargeAmount).toBeGreaterThan(20_00)
    expect(p.buyerFee).toBe(p.chargeAmount - 20_00)
    expect(p.faceValue).toBe(20_00)
  })

  it('leaves the organizer with EXACTLY the face value and pays only the platform fee', () => {
    for (const faceCents of [500, 20_00, 75_50, 250_00, 1_000_00]) {
      const p = priceOrderCents(faceCents, 'US')
      const appFee = applicationFeeFor(p)
      // What Stripe actually transfers on a destination charge.
      expect(p.chargeAmount - appFee).toBe(faceCents)
      // The buyer pays the platform fee and nothing more; Stripe's cut is absorbed.
      expect(appFee).toBe(p.platformFee)
      expect(p.buyerFee).toBe(p.platformFee)
    }
  })

  it('never charges less than the face value', () => {
    for (const faceCents of [1, 50, 99, 100_00]) {
      expect(priceOrderCents(faceCents, 'FR').chargeAmount).toBeGreaterThanOrEqual(faceCents)
    }
  })
})

describe('free orders', () => {
  it('stays free in every market', () => {
    for (const country of ['US', 'CA', 'FR', 'HT']) {
      const p = priceOrderCents(0, country)
      expect(p.chargeAmount).toBe(0)
      expect(p.buyerFee).toBe(0)
      expect(applicationFeeFor(p)).toBe(0)
    }
  })
})

describe('major-unit surface used by the display code', () => {
  it('reports a total the buyer can be shown as-is', () => {
    const order = priceOrder(20, 'US')
    expect(order.feeOnTop).toBe(true)
    expect(order.faceValue).toBe(20)
    expect(order.total).toBeCloseTo(20 + order.buyerFee, 10)
    expect(order.total).toBe(order.cents.chargeAmount / 100)
  })

  it('is a no-op for Haiti, so display code needs no country branch', () => {
    const order = priceOrder(1000, 'HT')
    expect(order.total).toBe(1000)
    expect(order.buyerFee).toBe(0)
    expect(order.feeOnTop).toBe(false)
  })

  it('prices the ORDER, not each ticket — the minimum fee is charged once', () => {
    // Ten $2 tickets priced together pay 10% of $20; priced one by one each
    // would hit the 50c per-order floor.
    const together = priceOrderCents(10 * 2_00, 'US').chargeAmount
    const separately = 10 * priceOrderCents(2_00, 'US').chargeAmount
    expect(together).toBe(22_00)
    expect(together).toBeLessThan(separately)
  })
})
