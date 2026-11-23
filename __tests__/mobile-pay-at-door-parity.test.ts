/**
 * The app cannot import the web's lib/tickets/pay-at-door.ts, so it keeps its
 * own copy (mobile/lib/payAtDoor.ts). This suite runs both on the same cases.
 */
import * as web from '@/lib/tickets/pay-at-door'
import * as app from '../mobile/lib/payAtDoor'

const tiers = [{ price: 0, door_price: 10 }, { price: 5, door_price: 10 }, { price: 0, door_price: '7.125' }, { price: 0 }, null]
const tickets = [
  { payment_method: 'pay_at_door', door_price: 10, door_currency: 'CAD', door_paid: false, status: 'valid' },
  { payment_method: 'pay_at_door', door_price: 10, door_currency: 'CAD', door_paid: true, status: 'valid' },
  { payment_method: 'free', status: 'valid' },
]

describe('mobile pay-at-door parity', () => {
  it('agrees on prices, balances, totals and labels', () => {
    for (const t of tiers) expect(app.doorPriceOf(t as any)).toBe(web.doorPriceOf(t as any))
    for (const t of tickets) expect(app.doorBalance(t)).toEqual(web.doorBalance(t))
    expect(app.doorCollectedTotal(tickets)).toBe(web.doorCollectedTotal(tickets))
    for (const c of ['HTG', 'USD', 'CAD', 'EUR'])
      for (const lang of ['en', 'fr', 'ht'])
        for (const n of [12.5, 1500, 0.1]) {
          expect(app.doorPriceLabel(n, c, lang)).toBe(web.doorPriceLabel(n, c, lang))
          expect(app.doorMoney(n, c, lang)).toBe(web.doorMoney(n, c, lang))
        }
    for (const t of [[{ price: 0, door_price: 9 }, { price: 0, door_price: 4 }], [], null] as any[])
      expect(app.lowestDoorPrice(t)).toBe(web.lowestDoorPrice(t))
    expect(app.MAX_DOOR_TICKETS_PER_PERSON).toBe(web.MAX_DOOR_TICKETS_PER_PERSON)
  })
})

describe('composer door mode parity', () => {
  it('agrees on the mode and the editor price', () => {
    const webMode = require('@/lib/events/door-mode')
    const appMode = require('../mobile/lib/composerFields')
    const cases: Array<[any, any[]]> = [[{ pay_at_door: true }, []], [{}, [{ price: 0, door_price: 9 }]], [{ is_rsvp: true }, []], [{}, [{ price: 20 }]], [null, []]]
    for (const [e, t] of cases) expect(appMode.composerModeOf(e, t)).toBe(webMode.composerModeOf(e, t))
    for (const t of [{ price: 0, door_price: 15 }, { price: 20 }, {}]) expect(appMode.tierEditorPrice(t)).toBe(webMode.tierEditorPrice(t))
  })
})
