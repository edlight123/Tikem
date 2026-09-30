import {
  dominantEventCurrency,
  eventLocationLabel,
  isCountedSale,
  sumRevenueByCurrency,
  ticketPurchaseDate,
} from '../mobile/lib/organizerStats'

describe('mobile organizer revenue per currency', () => {
  it('keeps a 25 HTG sale in HTG instead of reading it as dollars', () => {
    expect(
      sumRevenueByCurrency([{ event_id: 'e1', price_paid: 25, currency: 'HTG', status: 'confirmed' }])
    ).toEqual([{ currency: 'HTG', amount: 25 }])
  })

  it('never adds HTG and USD together, and sorts the largest first', () => {
    const rows = sumRevenueByCurrency([
      { event_id: 'e1', price_paid: 1500, currency: 'HTG', status: 'confirmed' },
      { event_id: 'e1', price_paid: 500, currency: 'HTG', status: 'valid' },
      { event_id: 'e2', price_paid: 40, currency: 'usd', status: 'valid' },
    ])
    expect(rows).toEqual([
      { currency: 'HTG', amount: 2000 },
      { currency: 'USD', amount: 40 },
    ])
  })

  it("falls back to the event's currency when the ticket has none", () => {
    const rows = sumRevenueByCurrency(
      [
        { event_id: 'usdEvent', price_paid: 10 },
        { event_id: 'htgEvent', price_paid: 250 },
      ],
      { usdEvent: 'USD', htgEvent: 'HTG' }
    )
    expect(rows).toEqual([
      { currency: 'HTG', amount: 250 },
      { currency: 'USD', amount: 10 },
    ])
  })

  it('excludes refunded, cancelled and pending tickets but counts scanned ones', () => {
    const rows = sumRevenueByCurrency([
      { price_paid: 100, currency: 'HTG', status: 'refunded' },
      { price_paid: 100, currency: 'HTG', status: 'cancelled' },
      { price_paid: 100, currency: 'HTG', status: 'pending' },
      { price_paid: 100, currency: 'HTG', status: 'used' },
      { price_paid: 100, currency: 'HTG', status: 'active' },
      { price_paid: 100, currency: 'HTG' },
    ])
    expect(rows).toEqual([{ currency: 'HTG', amount: 300 }])
    expect(isCountedSale('checked_in')).toBe(true)
    expect(isCountedSale('refunded')).toBe(false)
  })

  it('does not drift when summing decimals', () => {
    const rows = sumRevenueByCurrency(
      Array.from({ length: 10 }, () => ({ price_paid: 0.1, currency: 'USD', status: 'valid' }))
    )
    expect(rows).toEqual([{ currency: 'USD', amount: 1 }])
  })

  it('ignores free and malformed prices', () => {
    expect(
      sumRevenueByCurrency([
        { price_paid: 0, currency: 'USD' },
        { price_paid: 'abc', currency: 'USD' },
        { currency: 'USD' },
      ])
    ).toEqual([])
  })
})

describe('mobile organizer stats helpers', () => {
  it('picks the most common event currency for a zero revenue, HTG by default', () => {
    expect(dominantEventCurrency([{ currency: 'USD' }, { currency: 'HTG' }, { currency: 'usd' }])).toBe('USD')
    expect(dominantEventCurrency([])).toBe('HTG')
  })

  it('reads the purchase date from purchased_at, then created_at', () => {
    expect(ticketPurchaseDate({ purchased_at: '2026-09-20T10:00:00Z' })?.toISOString()).toBe(
      '2026-09-20T10:00:00.000Z'
    )
    const ts = { toDate: () => new Date('2026-09-21T00:00:00Z') }
    expect(ticketPurchaseDate({ created_at: ts })?.toISOString()).toBe('2026-09-21T00:00:00.000Z')
    expect(ticketPurchaseDate({})).toBeNull()
  })

  it('builds a location label from venue fields when location is empty', () => {
    expect(eventLocationLabel({ location: '  Parc Historique  ' })).toBe('Parc Historique')
    expect(eventLocationLabel({ location: '', venue_name: 'Le Florville', city: 'Kenscoff' })).toBe(
      'Le Florville, Kenscoff'
    )
    expect(eventLocationLabel({ location: '' })).toBe('')
  })
})
