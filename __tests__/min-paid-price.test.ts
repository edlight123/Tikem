/**
 * @jest-environment node
 *
 * Minimum paid price (owner decision 2026-10-12): a paid tier in the US or
 * Canada costs at least 2.00 (USD/CAD), in France at least 1.00 EUR, so an
 * absorbed fixed fee ($0.99 / C$0.99 / €0.50) can never exceed the price.
 * Free stays allowed; Haiti is unaffected. And the ledger never books a
 * negative net for an order, whatever slips past.
 */

jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))

import * as web from '@/lib/min-paid-price'
import * as mobile from '../mobile/lib/minPaidPrice'
import { calculateEventCurrencyFees } from '@/lib/earnings'

describe('minimum paid price', () => {
  it.each([
    ['US', 2], ['USA', 2], ['United States', 2],
    ['CA', 2], ['Canada', 2],
    ['FR', 1], ['France', 1],
    ['HT', null], ['Haiti', null], ['DO', null], ['ZZ', null], [null, null],
  ])('%s → %s (web and mobile agree)', (country, min) => {
    expect(web.minPaidPriceFor(country)).toBe(min)
    expect(mobile.minPaidPriceFor(country)).toBe(min)
  })

  it.each([
    // [price, country, below?]
    [0, 'US', false], // free is allowed
    ['0', 'FR', false],
    [0.5, 'US', true],
    [1.99, 'US', true],
    [2, 'US', false],
    ['2.00', 'CA', false],
    [1.5, 'CA', true],
    [0.99, 'FR', true],
    [1, 'FR', false],
    ['1,50', 'FR', false],
    [1.5, 'FR', false],
    [0.25, 'HT', false], // Haiti: no minimum
    [5, 'HT', false],
    ['', 'US', false], // blank is the composer's "price unset" error, not this one
  ])('price %s in %s below minimum: %s', (price, country, below) => {
    expect(web.isBelowMinPaidPrice(price, country)).toBe(below)
    expect(mobile.isBelowMinPaidPrice(price, country)).toBe(below)
  })
})

describe('publishPriceBelowMinimum (server)', () => {
  it('refuses an active paid tier under the minimum', () => {
    const r = web.publishPriceBelowMinimum({}, [{ name: 'GA', price: 20 }, { name: 'Cheap', price: 1 }], 'US')
    expect(r).toEqual({ price: 1, tierName: 'Cheap', minimum: 2 })
  })

  it('allows free and compliant tiers, and ignores archived/inactive ones', () => {
    expect(
      web.publishPriceBelowMinimum(
        {},
        [
          { name: 'Free', price: 0 },
          { name: 'GA', price: 2 },
          { name: 'Old', price: 0.5, archived: true },
          { name: 'Off', price: 0.5, is_active: false },
        ],
        'CA'
      )
    ).toBeNull()
  })

  it('checks the event-level price when there are no tiers', () => {
    expect(web.publishPriceBelowMinimum({ ticket_price: 0.75 }, [], 'France')).toEqual({
      price: 0.75,
      tierName: null,
      minimum: 1,
    })
  })

  it('never applies in Haiti', () => {
    expect(web.publishPriceBelowMinimum({ ticket_price: 1 }, [{ price: 1 }], 'HT')).toBeNull()
  })
})

describe('ledger clamps each order at zero net', () => {
  it('an absorbed fixed fee larger than the price nets 0, never negative', () => {
    // A legacy $0.50 US ticket, organizer absorbs 6% + $0.99.
    const fees = calculateEventCurrencyFees({
      grossEventCents: 50,
      paymentMethod: 'stripe',
      platformFeePercentage: 0.06,
      fixedFeeMinorPerTicket: 99,
      quantity: 1,
      feeIncidence: 'organizer',
    })
    expect(fees.netAmount).toBe(0)
    expect(fees.platformFee).toBe(50)
  })

  it('a normal order is untouched', () => {
    const fees = calculateEventCurrencyFees({
      grossEventCents: 2000,
      paymentMethod: 'stripe',
      platformFeePercentage: 0.06,
      fixedFeeMinorPerTicket: 99,
      quantity: 1,
      feeIncidence: 'organizer',
    })
    expect(fees.platformFee).toBe(120 + 99)
    expect(fees.netAmount).toBe(2000 - 219)
  })

  it('buyer incidence still nets the full face value', () => {
    const fees = calculateEventCurrencyFees({
      grossEventCents: 50,
      paymentMethod: 'stripe',
      platformFeePercentage: 0.06,
      fixedFeeMinorPerTicket: 99,
      quantity: 1,
      feeIncidence: 'buyer',
    })
    expect(fees.netAmount).toBe(50)
  })
})
