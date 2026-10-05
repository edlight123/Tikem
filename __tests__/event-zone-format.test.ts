/**
 * Event-zone date formatting: the event page and discover cards print times in
 * the EVENT's zone so the server render (UTC) and the browser agree. A
 * runtime-zone format was a React #418 hydration error on every event page.
 */
import { eventZone, eventHasEnded } from '@/lib/home/feed'
import { formatInZone, isoWithOffset, wallClock } from '@/lib/home/format'
import { formatEventDate } from '@/lib/discover/helpers'
import { buildEventJsonLd, serializeJsonLd } from '@/app/events/[id]/eventJsonLd'

// 2026-10-10 02:00 UTC = Oct 9, 10:00 PM in Port-au-Prince (EDT, -04:00).
const LATE_SHOW = '2026-10-10T02:00:00.000Z'

describe('eventZone', () => {
  it('prefers a valid stored timezone', () => {
    expect(eventZone({ timezone: 'Europe/Paris', country: 'HT' })).toBe('Europe/Paris')
  })
  it('ignores a junk stored timezone', () => {
    expect(eventZone({ timezone: 'Not/AZone', country: 'FR' })).toBe('Europe/Paris')
  })
  it('uses the city when its zone differs from the country default', () => {
    expect(eventZone({ city: 'Los Angeles, CA', country: 'US' })).toBe('America/Los_Angeles')
    expect(eventZone({ city: 'Miami', country: 'US' })).toBe('America/New_York')
  })
  it('falls back to Haiti', () => {
    expect(eventZone({})).toBe('America/Port-au-Prince')
    expect(eventZone(null)).toBe('America/Port-au-Prince')
  })
})

describe('formatInZone', () => {
  it('prints the wall time in the given zone regardless of the runtime zone', () => {
    expect(formatInZone(LATE_SHOW, 'America/Port-au-Prince', 'EEE, MMM d, yyyy h:mm a')).toBe(
      'Fri, Oct 9, 2026 10:00 PM'
    )
    expect(formatInZone(LATE_SHOW, 'Europe/Paris', 'h:mm a')).toBe('4:00 AM')
  })
  it('wallClock carries the zone fields as local fields', () => {
    const d = wallClock(LATE_SHOW, 'America/Port-au-Prince')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 9, 22])
  })
  it('handles midnight', () => {
    expect(formatInZone('2026-10-10T04:00:00.000Z', 'America/Port-au-Prince', 'HH:mm')).toBe('00:00')
  })
})

describe('isoWithOffset', () => {
  it('keeps the local wall time and the offset', () => {
    expect(isoWithOffset(LATE_SHOW, 'America/Port-au-Prince')).toBe('2026-10-09T22:00:00-04:00')
    expect(isoWithOffset(LATE_SHOW, 'Europe/Paris')).toBe('2026-10-10T04:00:00+02:00')
    expect(isoWithOffset(LATE_SHOW, 'UTC')).toBe('2026-10-10T02:00:00+00:00')
  })
  it('follows DST (winter offset)', () => {
    expect(isoWithOffset('2026-01-10T02:00:00.000Z', 'America/New_York')).toBe('2026-01-09T21:00:00-05:00')
  })
  it('handles half-hour zones', () => {
    expect(isoWithOffset('2026-01-10T02:00:00.000Z', 'Asia/Kolkata')).toBe('2026-01-10T07:30:00+05:30')
  })
})

describe('eventHasEnded', () => {
  const now = new Date('2026-10-05T12:00:00.000Z').getTime()
  it('a one-night event two days ago has ended (it used to linger for a week)', () => {
    expect(eventHasEnded({ start_datetime: '2026-10-03T22:00:00.000Z' }, now)).toBe(true)
  })
  it('an event with no end is live for six hours after it starts', () => {
    expect(eventHasEnded({ start_datetime: '2026-10-05T08:00:00.000Z' }, now)).toBe(false)
    expect(eventHasEnded({ start_datetime: '2026-10-05T05:00:00.000Z' }, now)).toBe(true)
  })
  it('a stored end wins', () => {
    expect(
      eventHasEnded({ start_datetime: '2026-10-01T00:00:00.000Z', end_datetime: '2026-10-06T00:00:00.000Z' }, now)
    ).toBe(false)
  })
  it('an undated event is not treated as ended', () => {
    expect(eventHasEnded({}, now)).toBe(false)
  })
})

describe('formatEventDate with a zone', () => {
  it('prints the event-zone time, as the event page does', () => {
    // Far from "now", so the label is the plain date form.
    expect(formatEventDate('2030-03-02T02:00:00.000Z', undefined, 'en', 'America/Port-au-Prince')).toBe(
      'Mar 1 at 9:00 PM'
    )
  })
})

describe('buildEventJsonLd', () => {
  const base = {
    id: 'evt1',
    title: 'Konpa Night',
    description: 'A night of konpa.',
    start_datetime: LATE_SHOW,
    end_datetime: '2026-10-10T06:00:00.000Z',
    venue_name: 'Karibe',
    city: 'Port-au-Prince',
    commune: 'Pétion-Ville',
    address: 'Juvenat 7',
    country: 'HT',
    currency: 'HTG',
    banner_image_url: 'https://example.com/p.jpg',
    ticket_tiers: [{ price: 1000 }, { price: 2500 }],
    total_tickets: 100,
    tickets_sold: 10,
    organizer_id: 'org1',
    users: { full_name: 'Jean', organization_name: 'Kompa Co' },
    status: 'published',
  }

  it('describes the event with offset dates, place, offers and organizer', () => {
    const ld: any = buildEventJsonLd(base, 'https://www.tikem.co')
    expect(ld['@type']).toBe('Event')
    expect(ld.startDate).toBe('2026-10-09T22:00:00-04:00')
    expect(ld.endDate).toBe('2026-10-10T02:00:00-04:00')
    expect(ld.eventStatus).toBe('https://schema.org/EventScheduled')
    expect(ld.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode')
    expect(ld.location.name).toBe('Karibe')
    expect(ld.location.address.addressLocality).toBe('Port-au-Prince')
    expect(ld.location.address.addressCountry).toBe('HT')
    expect(ld.offers).toMatchObject({
      '@type': 'AggregateOffer',
      lowPrice: 1000,
      highPrice: 2500,
      priceCurrency: 'HTG',
      availability: 'https://schema.org/InStock',
    })
    expect(ld.organizer.name).toBe('Kompa Co')
    expect(ld.image).toEqual(['https://example.com/p.jpg'])
    expect(ld.url).toBe('https://www.tikem.co/events/evt1')
  })

  it('marks sold out and cancelled events', () => {
    const ld: any = buildEventJsonLd(
      { ...base, tickets_sold: 100, status: 'cancelled', ticket_tiers: [{ price: 500 }] },
      'https://www.tikem.co'
    )
    expect(ld.offers).toMatchObject({ '@type': 'Offer', price: 500, availability: 'https://schema.org/SoldOut' })
    expect(ld.eventStatus).toBe('https://schema.org/EventCancelled')
  })

  it('returns null without a usable start', () => {
    expect(buildEventJsonLd({ ...base, start_datetime: 'nope' }, 'https://www.tikem.co')).toBeNull()
  })

  it('serializes without a closable script tag', () => {
    const out = serializeJsonLd({ name: '</script><script>alert(1)</script>' })
    expect(out).not.toContain('</script>')
    expect(JSON.parse(out).name).toBe('</script><script>alert(1)</script>')
  })
})
