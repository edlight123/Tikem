/**
 * Add-ons (lib/addons/addOns.ts): the server's validation of a buyer's
 * selection against the event's STORED add-ons, the metadata codec, the fee
 * split, and the cart pricing every surface shares (lib/checkout/buyer-pricing).
 *
 * @jest-environment node
 */
import {
  addOnAvailability,
  addOnFeeShareCents,
  decodeAddOnLines,
  encodeAddOnLines,
  normalizeAddOns,
  purchasedAddOnsFor,
  resolveAddOnLines,
  summarizeAddOnSales,
} from '@/lib/addons/addOns'
import { priceCart, priceTierLinesCents } from '@/lib/checkout/buyer-pricing'

const NOW = new Date('2027-03-01T12:00:00Z')

const event = (addOns: any[], extra: Record<string, any> = {}) => ({ add_ons: addOns, ...extra })
const meal = { id: 'ao_meal', name: 'Iftar meal', price: 15, quantity: 100 }
const shirt = { id: 'ao_shirt', name: 'T-shirt', price: 25, options: ['S', 'M', 'L'], max_per_order: 3 }
const parking = { id: 'ao_park', name: 'Parking', price: 10, tier_ids: ['vip'] }

const ga = [{ tierId: 'ga', quantity: 2 }]

describe('normalizeAddOns (organizer input)', () => {
  it('drops unnamed or unpriced add-ons, trims, dedupes options and caps per-order limits', () => {
    const out = normalizeAddOns([
      { id: 'ao_a', name: '  Meal  ', price: '12.5', options: ['S', 's', ' M '], max_per_order: 99 },
      { id: 'ao_b', name: '', price: 5 },
      { id: 'ao_c', name: 'Free thing', price: 0 },
      { id: 'ao_a', name: 'Duplicate id', price: 3, image_url: 'http://insecure.example/x.png' },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual(expect.objectContaining({ id: 'ao_a', name: 'Meal', price: 12.5, options: ['S', 'M'], max_per_order: 20 }))
    expect(out[1].id).not.toBe('ao_a')
    expect(out[1].image_url).toBeNull()
  })
})

describe('resolveAddOnLines (server validation)', () => {
  it('prices every line from the STORED add-on, never the client', () => {
    const r = resolveAddOnLines(event([meal]), [{ id: 'ao_meal', quantity: 2, price: 0.01, unitPrice: 0.01 }], ga, NOW)
    expect(r).toEqual({ ok: true, lines: [{ addOnId: 'ao_meal', name: 'Iftar meal', option: null, quantity: 2, unitPrice: 15 }] })
  })

  it('merges the same add-on + option listed twice', () => {
    const r = resolveAddOnLines(event([shirt]), [{ id: 'ao_shirt', option: 'm', quantity: 1 }, { id: 'ao_shirt', option: 'M', quantity: 1 }], ga, NOW)
    expect(r.ok && r.lines).toEqual([{ addOnId: 'ao_shirt', name: 'T-shirt', option: 'M', quantity: 2, unitPrice: 25 }])
  })

  it('requires a valid option when the add-on has variants', () => {
    expect(resolveAddOnLines(event([shirt]), [{ id: 'ao_shirt', quantity: 1 }], ga, NOW)).toEqual(
      expect.objectContaining({ ok: false, code: 'addon_option_required' })
    )
    expect(resolveAddOnLines(event([shirt]), [{ id: 'ao_shirt', option: 'XXL', quantity: 1 }], ga, NOW)).toEqual(
      expect.objectContaining({ ok: false, code: 'addon_option_invalid' })
    )
    expect(resolveAddOnLines(event([meal]), [{ id: 'ao_meal', option: 'M', quantity: 1 }], ga, NOW)).toEqual(
      expect.objectContaining({ ok: false, code: 'addon_option_invalid' })
    )
  })

  it('enforces the per-order limit across options', () => {
    const r = resolveAddOnLines(event([shirt]), [{ id: 'ao_shirt', option: 'S', quantity: 2 }, { id: 'ao_shirt', option: 'L', quantity: 2 }], ga, NOW)
    expect(r).toEqual(expect.objectContaining({ ok: false, code: 'addon_limit', addOnId: 'ao_shirt' }))
  })

  it('refuses unknown, inactive, not-yet-on-sale and ended add-ons', () => {
    expect(resolveAddOnLines(event([meal]), [{ id: 'ao_nope', quantity: 1 }], ga, NOW)).toEqual(
      expect.objectContaining({ ok: false, code: 'addon_unavailable' })
    )
    expect(resolveAddOnLines(event([{ ...meal, is_active: false }]), [{ id: 'ao_meal', quantity: 1 }], ga, NOW)).toEqual(
      expect.objectContaining({ ok: false, code: 'addon_unavailable' })
    )
    expect(
      resolveAddOnLines(event([{ ...meal, sales_start: '2027-03-02T00:00:00Z' }]), [{ id: 'ao_meal', quantity: 1 }], ga, NOW)
    ).toEqual(expect.objectContaining({ ok: false, code: 'addon_not_started' }))
    expect(
      resolveAddOnLines(event([{ ...meal, sales_end: '2027-02-28T00:00:00Z' }]), [{ id: 'ao_meal', quantity: 1 }], ga, NOW)
    ).toEqual(expect.objectContaining({ ok: false, code: 'addon_ended' }))
  })

  it('sells a tier-restricted add-on only with a ticket of that tier', () => {
    expect(resolveAddOnLines(event([parking]), [{ id: 'ao_park', quantity: 1 }], ga, NOW)).toEqual(
      expect.objectContaining({ ok: false, code: 'addon_needs_tier' })
    )
    expect(resolveAddOnLines(event([parking]), [{ id: 'ao_park', quantity: 1 }], [...ga, { tierId: 'vip', quantity: 1 }], NOW).ok).toBe(true)
    // A legacy single-price event (no tier id) cannot satisfy a tier restriction.
    expect(resolveAddOnLines(event([parking]), [{ id: 'ao_park', quantity: 1 }], [{ tierId: '', quantity: 1 }], NOW).ok).toBe(false)
  })

  it('refuses a plainly sold-out add-on from the rollup before any hold', () => {
    const e = event([{ ...meal, quantity: 5 }], { add_ons_sold: { ao_meal: 4 } })
    expect(resolveAddOnLines(e, [{ id: 'ao_meal', quantity: 2 }], ga, NOW)).toEqual(
      expect.objectContaining({ ok: false, code: 'addon_sold_out' })
    )
    expect(resolveAddOnLines(e, [{ id: 'ao_meal', quantity: 1 }], ga, NOW).ok).toBe(true)
  })

  it('rejects fractional, negative and absurd quantities; zero lines are dropped', () => {
    for (const quantity of [1.5, -1, 999, 'x']) {
      expect(resolveAddOnLines(event([meal]), [{ id: 'ao_meal', quantity }], ga, NOW)).toEqual(
        expect.objectContaining({ ok: false, code: 'addon_invalid' })
      )
    }
    expect(resolveAddOnLines(event([meal]), [{ id: 'ao_meal', quantity: 0 }], ga, NOW)).toEqual({ ok: true, lines: [] })
    expect(resolveAddOnLines(event([meal]), 'nope', ga, NOW)).toEqual(expect.objectContaining({ ok: false, code: 'addon_invalid' }))
    expect(resolveAddOnLines(event([meal]), undefined, ga, NOW)).toEqual({ ok: true, lines: [] })
  })

  it('availability mirrors the same rules for the buyer UI', () => {
    expect(addOnAvailability(parking as any, { now: NOW, cartTierIds: ['ga'] })).toBe('needs_tier')
    expect(addOnAvailability(parking as any, { now: NOW, cartTierIds: ['vip'] })).toBe('available')
    expect(addOnAvailability({ ...meal, quantity: 1 } as any, { now: NOW, soldMap: { ao_meal: 1 } })).toBe('sold_out')
  })
})

describe('metadata codec', () => {
  it('round-trips the lines and refuses junk', () => {
    const lines = [
      { addOnId: 'ao_meal', name: 'Iftar meal', option: null, quantity: 2, unitPrice: 15 },
      { addOnId: 'ao_shirt', name: 'T-shirt', option: 'M', quantity: 1, unitPrice: 25 },
    ]
    const encoded = encodeAddOnLines(lines)!
    expect(encoded.length).toBeLessThanOrEqual(500)
    expect(decodeAddOnLines({ ao: encoded })).toEqual({
      present: true,
      ok: true,
      lines: lines.map(({ name, ...l }) => l),
    })
    expect(decodeAddOnLines({})).toEqual({ present: false })
    expect(decodeAddOnLines({ ao: '[["ao_meal","",0,15]]' })).toEqual({ present: true, ok: false })
    expect(decodeAddOnLines({ ao: '[["bad id!","",1,15]]' })).toEqual({ present: true, ok: false })
    expect(decodeAddOnLines({ ao: 'not json' })).toEqual({ present: true, ok: false })
  })
})

describe('pricing: one fee formula over tickets + add-ons', () => {
  const ca = { country: 'CA', currency: 'CAD', fee_incidence: 'buyer' }

  it('the add-ons join the face total; the fixed fee still counts paid tickets only', () => {
    const withAddOns = priceTierLinesCents([{ unitPrice: 25, unitOriginal: 25, quantity: 2 }], ca, {
      currency: 'CAD',
      addOns: [{ unitPrice: 15, quantity: 2 }],
    })
    const sameFaceNoAddOns = priceTierLinesCents([{ unitPrice: 40, unitOriginal: 40, quantity: 2 }], ca, { currency: 'CAD' })
    expect(withAddOns.faceValueCents).toBe(8000)
    expect(withAddOns.addOnFaceCents).toBe(3000)
    expect(withAddOns.paidQuantity).toBe(2)
    // Same face, same paid-ticket count => the same fee to the cent.
    expect(withAddOns.pricing.buyerFee).toBe(sameFaceNoAddOns.pricing.buyerFee)
    expect(withAddOns.pricing.chargeAmount).toBe(sameFaceNoAddOns.pricing.chargeAmount)
  })

  it('priceCart (what the buyer reads) matches the server figure and shows the add-on subtotal', () => {
    const cart = priceCart([{ price: 25, quantity: 2 }], ca, { currency: 'CAD', addOns: [{ unitPrice: 15, quantity: 2 }] })
    const server = priceTierLinesCents([{ unitPrice: 25, unitOriginal: 25, quantity: 2 }], ca, {
      currency: 'CAD',
      addOns: [{ unitPrice: 15, quantity: 2 }],
    })
    expect(Math.round(cart.total * 100)).toBe(server.pricing.chargeAmount)
    expect(cart.addOnSubtotal).toBe(30)
    expect(cart.faceValue).toBe(80)
    expect(cart.discount).toBe(0)
  })

  it('a promo never discounts add-ons', () => {
    const cart = priceCart([{ price: 20, quantity: 1 }], ca, {
      currency: 'CAD',
      promo: { discount_type: 'percentage', discount_value: 50 },
      addOns: [{ unitPrice: 10, quantity: 1 }],
    })
    expect(cart.faceValue).toBe(20)
    expect(cart.discount).toBe(10)
  })

  it('splits the fee between add-ons and tickets by face, remainder to the tickets', () => {
    expect(addOnFeeShareCents({ buyerFeeCents: 301, faceValueCents: 8000, addOnFaceCents: 3000 })).toBe(112)
    expect(addOnFeeShareCents({ buyerFeeCents: 301, faceValueCents: 3000, addOnFaceCents: 3000 })).toBe(301)
    expect(addOnFeeShareCents({ buyerFeeCents: 0, faceValueCents: 8000, addOnFaceCents: 3000 })).toBe(0)
  })

  it('purchased lines add up to exactly the add-ons’ charge', () => {
    const lines = purchasedAddOnsFor(
      [
        { addOnId: 'ao_meal', option: null, quantity: 3, unitPrice: 15 },
        { addOnId: 'ao_shirt', option: 'M', quantity: 1, unitPrice: 25 },
      ],
      { addOnFeeCents: 245, names: { ao_meal: 'Meal', ao_shirt: 'T-shirt' } }
    )
    const cents = lines.reduce((s, l) => s + Math.round(l.charged_amount * 100), 0)
    expect(cents).toBe(4500 + 2500 + 245)
    expect(lines.map((l) => l.name)).toEqual(['Meal', 'T-shirt'])
  })
})

describe('organizer summary', () => {
  it('counts live tickets only, per add-on and option, with pickups', () => {
    const summary = summarizeAddOnSales(
      [
        { status: 'valid', add_ons: [{ id: 'ao_shirt', name: 'T-shirt', option: 'M', quantity: 2, face_total: 50, picked_up_at: '2027-03-01' }] },
        { status: 'valid', add_ons: [{ id: 'ao_shirt', name: 'T-shirt', option: 'S', quantity: 1, face_total: 25 }] },
        { status: 'refunded', add_ons: [{ id: 'ao_shirt', name: 'T-shirt', option: 'M', quantity: 5, face_total: 125 }] },
        { status: 'valid' },
      ],
      (t) => t.status === 'valid'
    )
    expect(summary.totalSold).toBe(3)
    expect(summary.totalPickedUp).toBe(2)
    expect(summary.totalRevenue).toBe(75)
    expect(summary.rows.map((r) => [r.option, r.sold])).toEqual([
      ['M', 2],
      ['S', 1],
    ])
  })
})
