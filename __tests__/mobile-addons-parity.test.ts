/**
 * The Expo app keeps a copy of the add-on helpers (mobile/lib/addOns.ts)
 * because it cannot import root lib/. This proves the copy agrees with the web
 * (lib/addons/addOns.ts, the source of truth) on everything the app decides
 * locally: cleaning the organizer's list, what a buyer is offered, per-order
 * limits, stock left, labels and the add-on subtotal.
 */
import * as web from '@/lib/addons/addOns'
import * as mobile from '../mobile/lib/addOns'
import { ADD_ON_PRESETS } from '@/lib/addons/presets'

const NOW = new Date('2027-03-01T12:00:00Z')

const RAW = [
  { id: 'ao_meal', name: '  Iftar  meal ', price: '15', quantity: 5, description: 'Rice & lamb' },
  { id: 'ao_shirt', name: 'T-shirt', price: 25, options: ['S', 's', ' M ', 'L'], max_per_order: 99 },
  { id: 'ao_park', name: 'Parking', price: 10.005, tier_ids: ['vip', 'vip', ''] },
  { id: 'ao_late', name: 'Raffle', price: 2, sales_start: '2027-03-02T00:00:00Z' },
  { id: 'ao_done', name: 'Book', price: 20, sales_end: '2027-02-01T00:00:00Z' },
  { id: 'ao_off', name: 'Hidden', price: 5, is_active: false },
  { id: 'ao_bad', name: '', price: 5 },
  { id: 'ao_zero', name: 'Zero', price: 0 },
  { id: 'ao_img', name: 'Pic', price: 3, image_url: 'http://insecure.example/x.png' },
]

const stripIds = (list: any[]) => list.map(({ id, ...rest }) => rest)

describe('mobile add-on helpers agree with the web', () => {
  it('normalizes an organizer list the same way', () => {
    expect(stripIds(mobile.normalizeAddOns(RAW))).toEqual(stripIds(web.normalizeAddOns(RAW)))
  })

  it('reads stored add-ons the same way (ids kept)', () => {
    expect(mobile.eventAddOns({ add_ons: RAW })).toEqual(web.eventAddOns({ add_ons: RAW }))
  })

  it('offers the same add-ons for the same cart', () => {
    const soldMap = { ao_meal: 5 }
    for (const a of web.eventAddOns({ add_ons: RAW })) {
      for (const cartTierIds of [[], ['ga'], ['vip']]) {
        expect(mobile.addOnAvailability(a as any, { now: NOW, cartTierIds, soldMap })).toBe(
          web.addOnAvailability(a, { now: NOW, cartTierIds, soldMap })
        )
      }
      expect(mobile.addOnOrderLimit(a as any)).toBe(web.addOnOrderLimit(a))
      expect(mobile.addOnRemaining(a as any, { ao_meal: 2 })).toBe(web.addOnRemaining(a, { ao_meal: 2 }))
    }
  })

  it('labels and subtotals match', () => {
    const lines = [
      { unitPrice: 15, quantity: 3 },
      { unitPrice: 10.01, quantity: 7 },
    ]
    expect(mobile.addOnSubtotal(lines)).toBe(web.addOnSubtotal(lines))
    const a = { name: 'T-shirt', option: 'M', quantity: 2 }
    expect(mobile.addOnLabel(a)).toBe(web.addOnLabel(a))
    const ticket = { add_ons: [{ id: 'ao_shirt', name: 'T-shirt', option: 'M', quantity: 2, face_total: 50, picked_up_at: 'x' }, { quantity: 0 }] }
    expect(mobile.ticketAddOns(ticket)).toEqual(web.ticketAddOns(ticket))
  })

  it('offers the same quick starts (Haiti: bottle, table, VIP, parking, drinks, merch)', () => {
    expect(mobile.ADD_ON_PRESETS).toEqual(ADD_ON_PRESETS)
  })
})
