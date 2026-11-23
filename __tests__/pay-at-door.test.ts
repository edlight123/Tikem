import {
  MAX_DOOR_TICKETS_PER_PERSON,
  doorPriceOf,
  isDoorTier,
  isDoorEvent,
  doorTicketFields,
  doorBalance,
  doorCollectedTotal,
  doorPriceLabel,
  doorMoney,
  lowestDoorPrice,
} from '@/lib/tickets/pay-at-door'

describe('pay at the door rules', () => {
  it('reads the door price only from a tier that charges nothing online', () => {
    expect(doorPriceOf({ price: 0, door_price: 10 })).toBe(10)
    expect(doorPriceOf({ price: 5, door_price: 10 })).toBe(0)
    expect(doorPriceOf({ price: 0, door_price: '12.505' })).toBe(12.51)
    expect(doorPriceOf({ price: 0 })).toBe(0)
    expect(doorPriceOf({ price: 0, door_price: -3 })).toBe(0)
    expect(doorPriceOf(null)).toBe(0)
    expect(isDoorTier({ price: 0, door_price: 8 })).toBe(true)
    expect(isDoorTier({ price: 0 })).toBe(false)
  })

  it('knows a door event by its flag or its tiers', () => {
    expect(isDoorEvent({}, [{ price: 0, door_price: 8 }])).toBe(true)
    expect(isDoorEvent({ pay_at_door: true }, [])).toBe(true)
    expect(isDoorEvent({}, [{ price: 0 }])).toBe(false)
  })

  it('stamps door tickets: Tikem takes nothing', () => {
    expect(doorTicketFields({ price: 0, door_price: 500 }, 'htg')).toEqual({
      payment_method: 'pay_at_door',
      door_price: 500,
      door_currency: 'HTG',
      door_paid: false,
    })
  })

  it('says what a ticket owes at the door', () => {
    expect(doorBalance({ payment_method: 'free' })).toBeNull()
    expect(doorBalance({ payment_method: 'pay_at_door', door_price: 10, door_currency: 'CAD', door_paid: false })).toEqual({
      owes: 10,
      currency: 'CAD',
      paid: false,
    })
    expect(doorBalance({ payment_method: 'pay_at_door', door_price: 10, door_currency: 'CAD', door_paid: true })).toEqual({
      owes: 0,
      currency: 'CAD',
      paid: true,
    })
  })

  it('totals cash collected, cent-exact, live paid tickets only', () => {
    const t = (o: any) => ({ payment_method: 'pay_at_door', status: 'valid', door_currency: 'CAD', ...o })
    expect(
      doorCollectedTotal([
        t({ door_price: 0.1, door_paid: true }),
        t({ door_price: 0.2, door_paid: true }),
        t({ door_price: 10, door_paid: false }),
        t({ door_price: 10, door_paid: true, status: 'cancelled' }),
        t({ door_price: 5, door_amount: 4, door_paid: true }),
      ])
    ).toBe(4.3)
  })

  it('labels door prices in the event currency, in English, French and Kreyòl', () => {
    expect(doorPriceLabel(500, 'HTG', 'en')).toBe('HTG 500 at the door')
    expect(doorPriceLabel(1500, 'HTG', 'ht')).toBe('HTG 1,500 nan pòt la')
    expect(doorPriceLabel(1500, 'HTG', 'fr')).toBe('1\u202f500 HTG à l’entrée')
    expect(doorPriceLabel(12.5, 'USD', 'en')).toBe('USD 12.50 at the door')
    expect(doorPriceLabel(8, 'EUR', 'fr')).toBe('8 EUR à l’entrée')
    expect(doorPriceLabel(10, 'cad', 'en')).toBe('CAD 10 at the door')
    expect(doorMoney(10, 'CAD', 'fr')).toBe('10 CAD')
    expect(doorMoney(1234.5, 'USD', 'fr')).toBe('1\u202f234,50 USD')
  })

  it('finds the lowest door price among the tiers', () => {
    expect(lowestDoorPrice([{ price: 0, door_price: 500 }, { price: 0, door_price: 250 }, { price: 300 }])).toBe(250)
    expect(lowestDoorPrice([{ price: 300, door_price: 100 }])).toBeNull()
    expect(lowestDoorPrice(null)).toBeNull()
  })

  it('lets a family reserve up to six', () => {
    expect(MAX_DOOR_TICKETS_PER_PERSON).toBe(6)
  })
})
