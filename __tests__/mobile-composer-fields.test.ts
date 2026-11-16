/**
 * Event-creation round trips between the two composers:
 *  - the zone mobile stamps is the one the web derives for the same place,
 *  - an RSVP made on one composer opens as an RSVP on the other,
 *  - a web RSVP save keeps the free tier a mobile RSVP's seats live in,
 *  - a tier saved without a description does not read back as its name.
 */
import { eventZone } from '@/lib/home/feed'
import { isRsvpEvent as webIsRsvp, rsvpTierFields, rsvpTierToKeep } from '@/lib/tickets/rsvp-tier'
import { planTierSync } from '@/lib/tickets/tier-reconcile'
import {
  isRsvpEvent,
  resolveEventTimezone,
  rsvpCapacityFrom,
  tierDescriptionFrom,
  zoneForPlace,
} from '../mobile/lib/composerFields'

describe('event timezone (mobile composer)', () => {
  const places: Array<[string, string]> = [
    ['HT', 'Port-au-Prince'],
    ['US', 'Miami, FL'],
    ['US', 'Los Angeles, CA'],
    ['US', 'Chicago'],
    ['CA', 'Montréal'],
    ['CA', 'Vancouver'],
    ['FR', 'Paris'],
    ['DO', 'Santo Domingo'],
    ['US', ''],
  ]
  it.each(places)('%s / %s matches the web eventZone', (country, city) => {
    expect(zoneForPlace(country, city)).toBe(eventZone({ country, city }))
  })

  it('stamps the place zone on a new event (no longer Port-au-Prince everywhere)', () => {
    expect(resolveEventTimezone({ country: 'FR', city: 'Paris' })).toBe('Europe/Paris')
    expect(resolveEventTimezone({ country: 'HT', city: 'Cap-Haïtien' })).toBe('America/Port-au-Prince')
  })

  it('keeps a stored zone while the event stays at the same place', () => {
    expect(
      resolveEventTimezone({
        stored: 'America/Chicago',
        storedCountry: 'US',
        storedCity: 'Miami, FL',
        country: 'US',
        city: 'Miami, FL',
      })
    ).toBe('America/Chicago')
  })

  it('heals the old blanket Haiti zone on a non-Haiti event', () => {
    expect(
      resolveEventTimezone({
        stored: 'America/Port-au-Prince',
        storedCountry: 'FR',
        storedCity: 'Paris',
        country: 'FR',
        city: 'Paris',
      })
    ).toBe('Europe/Paris')
  })

  it('re-derives the zone when the city or country changed, or the stored zone is junk', () => {
    expect(
      resolveEventTimezone({ stored: 'America/New_York', storedCountry: 'US', storedCity: 'Miami', country: 'US', city: 'Los Angeles' })
    ).toBe('America/Los_Angeles')
    expect(
      resolveEventTimezone({ stored: 'Not/AZone', storedCountry: 'HT', storedCity: 'Jacmel', country: 'HT', city: 'Jacmel' })
    ).toBe('America/Port-au-Prince')
  })
})

describe('RSVP detection agrees on web and mobile', () => {
  const events = [
    { is_rsvp: true },
    { is_rsvp: false, ticket_name: 'RSVP' },
    { ticket_name: 'RSVP' },
    { ticket_name: 'General Admission' },
    {},
    null,
  ]
  it.each(events.map((e) => [JSON.stringify(e), e]))('%s', (_label, e) => {
    expect(isRsvpEvent(e as any)).toBe(webIsRsvp(e as any))
  })

  it('reads a web RSVP (ticket_name only) as an RSVP, and trusts an explicit is_rsvp', () => {
    expect(isRsvpEvent({ ticket_name: 'RSVP' })).toBe(true)
    expect(isRsvpEvent({ is_rsvp: false, ticket_name: 'RSVP' })).toBe(false)
  })
})

describe('rsvpCapacityFrom', () => {
  const S = '1000000'
  it('uses the RSVP tier cap', () => {
    expect(rsvpCapacityFrom({ total_tickets: 0 }, { total_quantity: 150 }, S)).toBe('150')
  })
  it('reads an unlimited tier as the sentinel', () => {
    expect(rsvpCapacityFrom({}, { unlimited: true, total_quantity: 1000000 }, S)).toBe(S)
  })
  it('reads a tierless web RSVP (capacity 0) as unlimited, never "0"', () => {
    expect(rsvpCapacityFrom({ total_tickets: 0, capacity: 0 }, null, S)).toBe(S)
  })
  it('falls back to the event total when there is no tier', () => {
    expect(rsvpCapacityFrom({ total_tickets: 80 }, null, S)).toBe('80')
  })
})

describe('tierDescriptionFrom', () => {
  it('drops the old name-as-description placeholder', () => {
    expect(tierDescriptionFrom({ name: 'VIP', description: 'VIP' })).toBe('')
  })
  it('keeps a real description', () => {
    expect(tierDescriptionFrom({ name: 'VIP', description: 'Open bar' })).toBe('Open bar')
    expect(tierDescriptionFrom({ name: 'VIP', description: null })).toBe('')
  })
})

describe('web RSVP save keeps a mobile RSVP tier', () => {
  const existing = [
    { id: 'paid', name: 'GA', price: 10, sort_order: 0, sold_quantity: 0 },
    { id: 'rsvp', name: 'RSVP', price: 0, sort_order: 1, sold_quantity: 12, total_quantity: 200, is_active: true },
    { id: 'old', name: 'Old', price: 0, sort_order: 2, sold_quantity: 3, archived: true },
  ]

  it('picks the live free tier with seats taken', () => {
    expect(rsvpTierToKeep(existing)?.id).toBe('rsvp')
    expect(rsvpTierToKeep([{ id: 'x', price: 5 }])).toBeNull()
  })

  it('updates it in place with its own cap, switched on, and orphans only the rest', () => {
    const keep = rsvpTierToKeep(existing)!
    const row = { id: keep.id, name: String(keep.name), ...rsvpTierFields(keep) }
    const plan = planTierSync(existing, [row])
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0]).toMatchObject({ id: 'rsvp', totalQuantity: 200, soldQuantity: 12 })
    expect(plan.updates[0].fields).toMatchObject({ price: 0, is_active: true })
    expect(plan.inserts).toHaveLength(0)
    expect(plan.orphans.map((o) => o.id)).toEqual(['paid'])
  })
})
