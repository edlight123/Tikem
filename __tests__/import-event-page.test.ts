import { parseImportedEvents } from '@/lib/import/event-page'
import { mapEventbriteEvent } from '@/lib/import/eventbrite'
import { resolveImportMarket } from '@/lib/import/market'

const page = (ld: unknown, extra = '') => `<html><head>${extra}<script type="application/ld+json">${JSON.stringify(ld)}</script></head></html>`

describe('parseImportedEvents', () => {
  it('reads an Eventbrite-style event: venue, city, country, image, lowest price', () => {
    const html = page({
      '@context': 'https://schema.org',
      '@type': 'MusicEvent',
      name: 'Konpa Night &amp; Friends',
      startDate: '2027-02-20T21:00:00-05:00',
      endDate: '2027-02-21T02:00:00-05:00',
      url: 'https://www.eventbrite.com/e/konpa-123',
      image: ['https://img.evbuc.com/abc.jpg'],
      description: '<p>Dance all night.</p>',
      location: { '@type': 'Place', name: 'Club Haiti', address: { streetAddress: '12 Flatbush Ave', addressLocality: 'Brooklyn', addressRegion: 'NY', addressCountry: 'US' } },
      offers: [{ price: '25.00', priceCurrency: 'usd' }, { lowPrice: 20, priceCurrency: 'USD' }],
    })
    expect(parseImportedEvents(html, 'https://www.eventbrite.com/o/x')).toEqual([
      {
        uid: 'https://www.eventbrite.com/e/konpa-123',
        title: 'Konpa Night & Friends',
        description: 'Dance all night.',
        start: '2027-02-21T02:00:00.000Z',
        end: '2027-02-21T07:00:00.000Z',
        venue: 'Club Haiti',
        address: '12 Flatbush Ave, Brooklyn, NY',
        city: 'Brooklyn',
        country: 'US',
        online: false,
        image: 'https://img.evbuc.com/abc.jpg',
        url: 'https://www.eventbrite.com/e/konpa-123',
        price: 20,
        currency: 'USD',
      },
    ])
  })

  it('does not repeat the town when the street line already has it', () => {
    const html = page({ '@type': 'Event', name: 'X', startDate: '2027-01-01T10:00:00Z', location: { address: { streetAddress: '1 Rue Pavée, Port-au-Prince', addressLocality: 'Port-au-Prince', addressCountry: { '@type': 'Country', name: 'Haiti' } } } })
    const [e] = parseImportedEvents(html, 'https://x.ht')
    expect(e.address).toBe('1 Rue Pavée, Port-au-Prince')
    expect(e.country).toBe('Haiti')
  })

  it('finds events in lists and graphs, skips broken blocks and non-https images', () => {
    const html =
      '<script type="application/ld+json">{oops</script>' +
      page({ '@graph': [{ '@type': 'ItemList', itemListElement: [{ item: { '@type': 'Event', name: 'B', startDate: '2027-01-02T10:00:00Z', image: 'http://insecure/x.jpg' } }, { '@type': 'Event', name: 'A', startDate: '2027-01-01T10:00:00Z', isAccessibleForFree: true, eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode' }] }] })
    const r = parseImportedEvents(html, 'https://lu.ma/x')
    expect(r.map((e) => e.title)).toEqual(['A', 'B'])
    expect(r[0]).toMatchObject({ online: true, price: 0 })
    expect(r[1].image).toBeNull()
  })

  it('ignores entries without a title or a real date', () => {
    expect(parseImportedEvents(page([{ '@type': 'Event', name: '', startDate: '2027-01-01' }, { '@type': 'Event', name: 'X', startDate: 'soon' }]), 'https://x.ca')).toEqual([])
  })
})

describe('mapEventbriteEvent', () => {
  const ev = {
    id: '123',
    name: { text: 'Kanaval  Pre-party' },
    description: { text: 'Warm up for kanaval.' },
    start: { utc: '2027-02-21T01:30:00Z' },
    end: { utc: '2027-02-21T04:30:00Z' },
    url: 'https://www.eventbrite.ca/e/123',
    currency: 'cad',
    online_event: false,
    venue: { name: 'Salle Rouge', address: { city: 'Montréal', country: 'CA', localized_address_display: '1 Rue Saint-Denis, Montréal, QC' } },
    logo: { original: { url: 'https://img.evbuc.com/x.jpg' } },
    ticket_classes: [
      { name: 'Adult', free: false, cost: { major_value: '15.00', currency: 'CAD' }, quantity_total: 120 },
      { name: 'Child', free: true, quantity_total: 0 },
      { name: 'Hidden', hidden: true },
      { name: 'Give', donation: true },
    ],
  }

  it('keeps the ticket types (not hidden or donation ones), venue, country and photo', () => {
    expect(mapEventbriteEvent(ev)).toEqual({
      key: 'eventbrite:123',
      title: 'Kanaval Pre-party',
      description: 'Warm up for kanaval.',
      start: '2027-02-21T01:30:00.000Z',
      end: '2027-02-21T04:30:00.000Z',
      venue: 'Salle Rouge',
      address: '1 Rue Saint-Denis, Montréal, QC',
      city: 'Montréal',
      country: 'CA',
      online: false,
      image: 'https://img.evbuc.com/x.jpg',
      url: 'https://www.eventbrite.ca/e/123',
      source: 'eventbrite.com',
      currency: 'CAD',
      tiers: [
        { name: 'Adult', price: 15, quantity: 120 },
        { name: 'Child', price: 0, quantity: 100 },
      ],
    })
  })

  it('an online event has no venue; an event with no tickets gets a free one; no title, no draft', () => {
    expect(mapEventbriteEvent({ ...ev, online_event: true, ticket_classes: [] })).toMatchObject({ venue: '', address: '', country: null, online: true, tiers: [{ name: 'Free', price: 0, quantity: 100 }] })
    expect(mapEventbriteEvent({ ...ev, name: { text: '' } })).toBeNull()
    expect(mapEventbriteEvent({ ...ev, url: 'http://evil.example/e/1' })!.url).toBeNull()
  })
})

describe('resolveImportMarket (HT, US, CA, FR only)', () => {
  it('keeps a supported country and its currency', () => {
    expect(resolveImportMarket({ country: 'CA', currency: 'CAD', prices: [15] })).toEqual({ country: 'CA', currency: 'CAD', flags: [], sourceCurrency: null })
    expect(resolveImportMarket({ country: 'Haiti', currency: 'HTG', prices: [500] })).toMatchObject({ country: 'HT', currency: 'HTG', flags: [] })
    expect(resolveImportMarket({ country: 'HT', currency: 'USD', prices: [20] })).toMatchObject({ country: 'HT', currency: 'USD', flags: [] })
  })

  it('names the market from the currency when the page gives no country', () => {
    expect(resolveImportMarket({ currency: 'EUR', prices: [10] })).toMatchObject({ country: 'FR', currency: 'EUR' })
    expect(resolveImportMarket({ currency: 'HTG', prices: [10] })).toMatchObject({ country: 'HT', currency: 'HTG' })
    expect(resolveImportMarket({ currency: 'USD', prices: [10], fallbackCountry: 'HT' })).toMatchObject({ country: 'HT', currency: 'USD' })
    expect(resolveImportMarket({ currency: 'USD', prices: [10], fallbackCountry: 'FR' })).toMatchObject({ country: 'US', currency: 'USD' })
    expect(resolveImportMarket({ prices: [0], fallbackCountry: 'CA' })).toMatchObject({ country: 'CA', currency: 'CAD', flags: [] })
  })

  it('a paid event in a currency its market does not take is flagged, in the market currency', () => {
    expect(resolveImportMarket({ country: 'FR', currency: 'GBP', prices: [12] })).toEqual({ country: 'FR', currency: 'EUR', flags: ['currency_unsupported'], sourceCurrency: 'GBP' })
    expect(resolveImportMarket({ country: 'US', currency: 'CAD', prices: [12] })).toMatchObject({ currency: 'USD', flags: ['currency_unsupported'] })
    // Free: nothing to reprice.
    expect(resolveImportMarket({ country: 'FR', currency: 'GBP', prices: [0] })).toMatchObject({ currency: 'EUR', flags: [] })
  })

  it('a venue outside our markets is flagged and filed under the organizer market', () => {
    expect(resolveImportMarket({ country: 'GB', currency: 'GBP', prices: [10], fallbackCountry: 'US' })).toEqual({
      country: 'US',
      currency: 'USD',
      flags: ['country_unsupported', 'currency_unsupported'],
      sourceCurrency: 'GBP',
    })
  })

  it('a price under the market minimum is flagged (US/CA 2, FR 1; none in Haiti)', () => {
    expect(resolveImportMarket({ country: 'US', currency: 'USD', prices: [1] }).flags).toEqual(['price_below_minimum'])
    expect(resolveImportMarket({ country: 'HT', currency: 'HTG', prices: [1] }).flags).toEqual([])
  })
})
