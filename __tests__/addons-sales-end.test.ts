/**
 * An add-on with no sales end sells until the event ends (or, with no stored
 * end, ADD_ON_DEFAULT_EVENT_HOURS after it starts). Web and app agree.
 */
import { addOnAvailability, addOnSalesEnd } from '@/lib/addons/addOns'
import { addOnAvailability as appAvailability, addOnSalesEnd as appSalesEnd } from '../mobile/lib/addOns'

const addOn: any = { id: 'tee', name: 'T-shirt', price: 10, is_active: true }
const start = '2026-12-01T23:00:00.000Z'
const end = '2026-12-02T03:00:00.000Z'

describe('add-on sales end', () => {
  for (const [name, avail, salesEnd] of [
    ['web', addOnAvailability, addOnSalesEnd],
    ['app', appAvailability, appSalesEnd],
  ] as const) {
    it(`${name}: no own end → the event's end`, () => {
      expect(salesEnd(addOn, { start, end })?.toISOString()).toBe(end)
      expect(avail(addOn, { now: new Date('2026-12-02T01:00:00Z'), eventStart: start, eventEnd: end })).toBe('available')
      expect(avail(addOn, { now: new Date('2026-12-02T04:00:00Z'), eventStart: start, eventEnd: end })).toBe('ended')
    })
    it(`${name}: no stored event end → 4 hours after the start`, () => {
      expect(salesEnd(addOn, { start })?.toISOString()).toBe('2026-12-02T03:00:00.000Z')
      expect(avail(addOn, { now: new Date('2026-12-02T05:00:00Z'), eventStart: start })).toBe('ended')
    })
    it(`${name}: its own end wins; nothing known → open`, () => {
      const own = { ...addOn, sales_end: '2026-11-30T00:00:00.000Z' }
      expect(avail(own, { now: new Date('2026-11-30T01:00:00Z'), eventStart: start, eventEnd: end })).toBe('ended')
      expect(avail(addOn, { now: new Date('2030-01-01T00:00:00Z') })).toBe('available')
    })
    it(`${name}: reads a Firestore Timestamp`, () => {
      const ts = { toDate: () => new Date(end) }
      expect(salesEnd(addOn, { start, end: ts })?.toISOString()).toBe(end)
    })
  }
})
