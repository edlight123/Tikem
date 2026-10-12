/**
 * Multi-tier carts, priced the same everywhere (lib/checkout/buyer-pricing
 * priceCart / priceTierLinesCents) and carried to fulfillment intact
 * (lib/checkout/card-order-lines).
 *
 * @jest-environment node
 */

import { applyPromoToLines, priceCart, priceTierLinesCents } from '@/lib/checkout/buyer-pricing'
import {
  CARD_ORDER_LINES_KEY,
  STRIPE_METADATA_VALUE_MAX,
  decodeCardOrderLines,
  encodeCardOrderLines,
} from '@/lib/checkout/card-order-lines'

const US = { country: 'US', currency: 'USD' }
const VIP = { price: 50, quantity: 1 }
const GA2 = { price: 25, quantity: 2 }

describe('priceCart: the incidence-aware display total', () => {
  it('US pass-on, VIP $50 x1 + GA $25 x2: 6% of the face total + $0.99 per paid ticket', () => {
    const p = priceCart([VIP, GA2], { ...US, fee_incidence: 'buyer' }, { currency: 'USD' })
    expect(p.faceValue).toBe(100)
    expect(p.buyerFee).toBe(8.97)
    expect(p.total).toBe(108.97)
    expect(p.paidQuantity).toBe(3)
  })

  it('US 3 x $25 where the organizer ABSORBS the fee: the buyer pays face value', () => {
    const p = priceCart([{ price: 25, quantity: 3 }], { ...US, fee_incidence: 'organizer' }, { currency: 'USD' })
    expect(p.total).toBe(75)
    expect(p.buyerFee).toBe(0)
    expect(p.feeOnTop).toBe(false)
  })

  it('HT 2 x 1,500 HTG where the organizer PASSES the fee on: 3,300 HTG, as MonCash charges', () => {
    const p = priceCart([{ price: 1500, quantity: 2 }], { country: 'HT', currency: 'HTG', fee_incidence: 'buyer' }, { currency: 'HTG' })
    expect(p.total).toBe(3300)
    expect(p.buyerFee).toBe(300)
  })

  it('a bare country string still prices by the country default (back-compat)', () => {
    expect(priceCart([{ price: 1500, quantity: 2 }], 'HT').total).toBe(3000)
  })

  it('free + paid: the free line adds nothing and carries no fixed fee', () => {
    const p = priceCart([{ price: 0, quantity: 2 }, GA2], { ...US, fee_incidence: 'buyer' }, { currency: 'USD' })
    expect(p.faceValue).toBe(50)
    expect(p.paidQuantity).toBe(2)
    // 6% of 50 = 3.00, + 2 x 0.99
    expect(p.buyerFee).toBe(4.98)
    expect(p.total).toBe(54.98)
  })

  it('a percentage promo comes off every line, then the fee is priced on the result', () => {
    const p = priceCart([VIP, GA2], { ...US, fee_incidence: 'buyer' }, {
      currency: 'USD',
      promo: { discount_type: 'percentage', discount_value: 10 },
    })
    expect(p.subtotalBeforePromo).toBe(100)
    expect(p.discount).toBe(10)
    expect(p.faceValue).toBe(90)
    // 6% of 90 = 5.40, + 3 x 0.99
    expect(p.buyerFee).toBe(8.37)
    expect(p.total).toBe(98.37)
  })

  it('a fixed-amount promo is per TICKET (as the server applies it), not once off the order', () => {
    const p = priceCart([VIP, GA2], { ...US, fee_incidence: 'buyer' }, {
      currency: 'USD',
      promo: { discount_type: 'fixed_amount', discount_value: 30 },
    })
    // VIP 50 -> 20; each GA 25 -> 0.
    expect(p.faceValue).toBe(20)
    expect(p.discount).toBe(80)
    // Only the VIP still costs something, so only it carries the fixed fee.
    expect(p.paidQuantity).toBe(1)
    expect(p.buyerFee).toBe(2.19)
  })
})

describe('priceTierLinesCents: the server-side figure', () => {
  it('matches the single-tier formula exactly for one line, including an FX rate', () => {
    const lines = applyPromoToLines([{ price: 1500, quantity: 3 }], null)
    const rate = 0.00761
    const { faceValueCents } = priceTierLinesCents(lines, { country: 'US', currency: 'HTG' }, {
      currency: 'USD',
      exchangeRate: rate,
    })
    expect(faceValueCents).toBe(Math.round(1500 * rate * 3 * 100))
  })

  it('an all-free cart prices to 0 with no fee', () => {
    const r = priceTierLinesCents(applyPromoToLines([{ price: 0, quantity: 3 }], null), { ...US, fee_incidence: 'buyer' }, { currency: 'USD' })
    expect(r.faceValueCents).toBe(0)
    expect(r.paidQuantity).toBe(0)
    expect(r.totalQuantity).toBe(3)
    expect(r.pricing.chargeAmount).toBe(0)
  })
})

describe('card order lines metadata', () => {
  const lines = [
    { tierId: 'vipTierId00000000001', quantity: 1, unitPrice: 45, unitOriginal: 50 },
    { tierId: 'gaTierId000000000002', quantity: 2, unitPrice: 22.5, unitOriginal: 25 },
  ]

  it('round-trips', () => {
    const encoded = encodeCardOrderLines(lines)!
    expect(encoded.length).toBeLessThanOrEqual(STRIPE_METADATA_VALUE_MAX)
    const decoded = decodeCardOrderLines({ [CARD_ORDER_LINES_KEY]: encoded })
    expect(decoded).toEqual({ present: true, ok: true, lines, quantity: 3 })
  })

  it('refuses to encode a breakdown that would not fit in one metadata value', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      tierId: `tier_${String(i).padStart(15, '0')}`,
      quantity: 1,
      unitPrice: 1234.56,
      unitOriginal: 1234.56,
    }))
    expect(encodeCardOrderLines(many)).toBeNull()
  })

  it('absent means a single-tier (legacy) order; garbage is refused, never guessed at', () => {
    expect(decodeCardOrderLines({ tierId: 'x', quantity: '2' })).toEqual({ present: false })
    expect(decodeCardOrderLines({ t: 'not json' })).toEqual({ present: true, ok: false })
    expect(decodeCardOrderLines({ t: '[["a",0.5,10,10]]' })).toEqual({ present: true, ok: false })
    expect(decodeCardOrderLines({ t: '[["a",2,-1,10]]' })).toEqual({ present: true, ok: false })
    expect(decodeCardOrderLines({ t: '[["a",30,10,10],["b",30,10,10]]' })).toEqual({ present: true, ok: false })
  })
})
