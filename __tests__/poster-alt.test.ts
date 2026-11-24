/**
 * Poster descriptions (lib/posterAlt.ts + its app mirror mobile/lib/posterAlt.ts).
 * A flyer is a picture of text, so the screen reader needs words for it: the
 * organizer's own, else a sentence from the event's facts in en/fr/ht.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as web from '@/lib/posterAlt'
import * as app from '../mobile/lib/posterAlt'

// Saturday 28 November 2026, 9 PM in Boston (EST, UTC-5) = 02:00Z on the 29th.
const KONPA = {
  title: 'Konpa Ball',
  venue_name: 'Royale',
  city: 'Boston',
  start_datetime: '2026-11-29T02:00:00Z',
  timezone: 'America/New_York',
  ticket_price: 25,
  currency: 'USD',
}

describe.each([
  ['web', web],
  ['app', app],
])('posterAlt (%s)', (_side, m) => {
  it('builds an English sentence from the facts', () => {
    expect(m.posterAltText(KONPA, 'en')).toBe(
      'Flyer for Konpa Ball, Saturday 28 November at 9 PM at Royale, Boston. Tickets from $25.'
    )
  })

  it('builds a French sentence', () => {
    expect(m.posterAltText(KONPA, 'fr')).toBe(
      'Affiche de Konpa Ball, samedi 28 novembre à 21 h à Royale, Boston. Billets dès 25 $.'
    )
  })

  it('builds a Kreyòl sentence', () => {
    expect(m.posterAltText(KONPA, 'ht')).toBe(
      'Afich pou Konpa Ball, samdi 28 novanm a 9è PM nan Royale, Boston. Tikè apati 25 $.'
    )
  })

  it('says free, minutes, and HTG prices', () => {
    const free = { ...KONPA, ticket_price: 0, start_datetime: '2026-11-29T02:30:00Z' }
    expect(m.posterAltFromFacts(free, 'en')).toMatch(/at 9:30 PM .*\. Free\.$/)
    expect(m.posterAltFromFacts(free, 'fr')).toMatch(/à 21 h 30 .*\. Gratuit\.$/)
    expect(m.posterAltFromFacts(free, 'ht')).toMatch(/a 9:30 PM .*\. Gratis\.$/)
    const htg = { ...KONPA, ticket_price: 1500, currency: 'HTG', timezone: 'America/Port-au-Prince' }
    expect(m.posterAltFromFacts(htg, 'ht')).toMatch(/Tikè apati 1500 HTG\.$/)
  })

  it('uses the lowest paid tier and treats pay-at-door as not free', () => {
    const tiers = { ...KONPA, ticket_price: 0, ticket_tiers: [{ price: 0 }, { price: 40 }, { price: 15.5 }] }
    expect(m.posterAltFromFacts(tiers, 'en')).toMatch(/Tickets from \$15\.50\.$/)
    expect(m.posterAltFromFacts({ ...KONPA, ticket_price: 0, pay_at_door: true }, 'en')).not.toMatch(/Free/)
  })

  it("prefers the organizer's own words, cleaned and capped", () => {
    expect(m.posterAltText({ ...KONPA, poster_alt: '  Gold   flyer,\n band photo ' }, 'en')).toBe('Gold flyer, band photo')
    const long = 'x'.repeat(m.POSTER_ALT_MAX + 50)
    expect(m.cleanPosterAlt(long)).toHaveLength(m.POSTER_ALT_MAX)
    expect(m.cleanPosterAlt(42)).toBe('')
  })

  it('copes with missing facts and Firestore timestamps', () => {
    expect(m.posterAltText(null)).toBe('')
    expect(m.posterAltFromFacts({}, 'en')).toBe('Flyer for an event.')
    expect(m.posterAltFromFacts({ is_rsvp: true }, 'ht')).toBe('Afich pou yon evènman. Gratis.')
    const ts = { seconds: Date.parse('2026-11-29T02:00:00Z') / 1000 }
    expect(m.posterAltFromFacts({ title: 'Konpa', start_datetime: ts, timezone: 'America/New_York' }, 'en')).toContain(
      'Saturday 28 November at 9 PM'
    )
    // Venue equal to city is said once.
    expect(m.posterAltFromFacts({ title: 'X', venue_name: 'Jacmel', city: 'jacmel' }, 'en')).toBe(
      'Flyer for X at Jacmel.'
    )
  })
})

it('the app mirror is identical to the web module (bar the header comment)', () => {
  const strip = (p: string) =>
    fs
      .readFileSync(path.join(__dirname, '..', p), 'utf8')
      .replace(/^\/\*\*[\s\S]*?\*\/\n/, '')
  expect(strip('mobile/lib/posterAlt.ts')).toBe(strip('lib/posterAlt.ts'))
})
