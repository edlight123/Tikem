/**
 * The mobile composer now writes three things the web composer already did —
 * the lineup (`guestlist`), the fee incidence and the online flag — and reads
 * the web's per-tier options back. These lock the shared shapes so the two
 * apps keep reading each other's events.
 */

import {
  lineupEntryFromRecord as webFromRecord,
  lineupEntryToRecord as webToRecord,
  lineupTimeRange as webTimeRange,
} from '@/lib/lineup'
import {
  lineupEntryFromRecord,
  lineupEntryToRecord,
  lineupFromEvent,
  lineupTimeRange,
  safeLineupLink,
} from '../mobile/lib/lineup'
import { organizerNet, priceOrder } from '../mobile/lib/buyerPricing'
import { parseSpotifyUrl as webParseSpotify } from '@/components/events/SpotifyEmbed'
import { parseSpotifyUrl } from '../mobile/lib/spotify'

const strip = ({ id: _id, ...rest }: { id: string } & Record<string, unknown>) => rest

describe('lineup records round-trip identically on web and mobile', () => {
  // A bare-string entry is checked separately below: the web reader takes
  // `'name'.link` (String.prototype.link, a function) as the link.
  const records = [
    { name: 'Old Shape', role: 'DJ' },
    {
      name: 'Full Entry',
      role: 'Special Guest',
      photo_url: 'https://example.com/p.jpg',
      link: 'instagram.com/someone',
      description: 'Plays kompa.',
      start_time: '21:00',
      end_time: '22:30',
    },
    { name: 'Camel Case', role: 'Host', photoUrl: 'https://x.co/a.png', startTime: '20:00' },
  ]

  it.each(records.map((r) => [typeof r === 'string' ? r : r.name, r]))('%s', (_label, record) => {
    const web = webFromRecord(record)
    const mobile = lineupEntryFromRecord(record)
    expect(strip(mobile as any)).toEqual(strip(web as any))
    expect(lineupEntryToRecord(mobile)).toEqual(webToRecord({ ...web, name: web.name.trim() }))
  })

  it('reads a legacy bare-string entry as a name only', () => {
    expect(lineupEntryToRecord(lineupEntryFromRecord('Bare String Act'))).toEqual({
      name: 'Bare String Act',
      role: 'Performer',
      photo_url: null,
      link: null,
      description: null,
      start_time: null,
      end_time: null,
    })
  })

  it('drops unnamed entries when reading an event', () => {
    expect(lineupFromEvent([{ name: '  ' }, { name: 'A' }]).map((g) => g.name)).toEqual(['A'])
    expect(lineupFromEvent(undefined)).toEqual([])
  })

  it('formats set times the same way', () => {
    for (const [s, e] of [['21:00', '22:00'], ['21:00', ''], ['', '23:00'], ['', '']]) {
      expect(lineupTimeRange(s, e)).toBe(webTimeRange(s, e))
    }
  })

  it('only opens plain http(s) links', () => {
    expect(safeLineupLink('instagram.com/x')).toBe('https://instagram.com/x')
    expect(safeLineupLink('https://open.spotify.com/artist/1')).toBe('https://open.spotify.com/artist/1')
    expect(safeLineupLink('javascript:alert(1)')).toBeNull()
    expect(safeLineupLink('localhost')).toBeNull()
    expect(safeLineupLink('')).toBeNull()
  })
})

describe('organizer net for the pass-the-fee switch', () => {
  it('is the face value when the buyer pays the fee', () => {
    const event = { country: 'HT', currency: 'HTG', fee_incidence: 'buyer' }
    expect(organizerNet(1000, event)).toBe(1000)
    expect(priceOrder(1000, event).total).toBe(1100)
  })

  it('is face minus the capped platform fee when the organizer absorbs it', () => {
    const event = { country: 'HT', currency: 'HTG', fee_incidence: 'organizer' }
    expect(organizerNet(1000, event)).toBe(900)
    // 10% of 10,000 is 1,000, capped at 750 HTG per ticket.
    expect(organizerNet(10_000, event)).toBe(9250)
    expect(priceOrder(10_000, event).total).toBe(10_000)
  })

  it('follows the country default when no choice was made', () => {
    expect(organizerNet(20, { country: 'US', currency: 'USD' })).toBe(20)
    expect(organizerNet(20, { country: 'HT', currency: 'USD' })).toBe(18)
  })
})

describe('Spotify link parsing matches the web embed', () => {
  it.each([
    'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    'https://open.spotify.com/intl-fr/track/4uLU6hMCjMI75M1A2tKUQC?si=abc',
    'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    'https://evil.example.com/track/4uLU6hMCjMI75M1A2tKUQC',
    'https://open.spotify.com/track/short',
    'not a url',
  ])('%s', (url) => {
    expect(parseSpotifyUrl(url)).toEqual(webParseSpotify(url))
  })
})
