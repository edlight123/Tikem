/** @jest-environment node */
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))

import {
  digestLang,
  isDigestHour,
  localMidnight,
  planThursdaySend,
  runThursdayDigest,
  thursdayCapKey,
  upcomingDigestEvents,
  weekendDigestCopy,
  weekendWindow,
} from '@/lib/notifications/weekly-digest'
import { isTransactional } from '@/lib/notifications/policy'
import { USER_NOTIFY_FIELDS } from '@/lib/notifications/userPreferences'

// Thursday 26 Nov 2026, 22:30 UTC = 17:30 in Port-au-Prince / New York (EST).
const THU_EVENING_HT = new Date('2026-11-26T22:30:00Z')
const iso = (s: string) => new Date(s).toISOString()

const rows = [
  { id: 'a', is_published: true, title: 'Kompa Friday', city: 'Port-au-Prince', start_datetime: iso('2026-11-27T23:00:00Z') },
  { id: 'b', is_published: true, title: 'Rara Saturday', city: 'port au prince', start_datetime: iso('2026-11-28T20:00:00Z') },
  { id: 'c', is_published: true, title: 'Sunday Brunch', city: 'Port-au-Prince', start_datetime: iso('2026-11-29T15:00:00Z') },
  { id: 'd', is_published: true, title: 'Next Week Gala', city: 'Port-au-Prince', start_datetime: iso('2026-12-03T23:00:00Z') },
  { id: 'e', is_published: true, title: 'Cancelled', city: 'Port-au-Prince', status: 'cancelled', start_datetime: iso('2026-11-28T20:00:00Z') },
  { id: 'f', is_published: false, title: 'Draft', city: 'Port-au-Prince', start_datetime: iso('2026-11-28T20:00:00Z') },
  { id: 'g', is_published: true, title: 'Miami Party', city: 'Miami', start_datetime: iso('2026-11-28T20:00:00Z') },
]

describe('time', () => {
  it('weekend = Friday 00:00 to Monday 00:00 local, keyed by the Friday', () => {
    expect(weekendWindow(THU_EVENING_HT, 'America/Port-au-Prince')).toEqual({
      from: new Date('2026-11-27T05:00:00Z'),
      to: new Date('2026-11-30T05:00:00Z'),
      weekKey: '2026-11-27',
    })
    // Saturday still means this weekend.
    expect(weekendWindow(new Date('2026-11-28T12:00:00Z'), 'Europe/Paris').weekKey).toBe('2026-11-27')
  })

  it('local midnight survives a DST change', () => {
    // Paris leaves summer time on 25 Oct 2026.
    expect(localMidnight('2026-10-26', 'Europe/Paris')).toEqual(new Date('2026-10-25T23:00:00Z'))
    expect(localMidnight('2026-10-24', 'Europe/Paris')).toEqual(new Date('2026-10-23T22:00:00Z'))
  })

  it('sends only on Thursday early evening, local, before quiet hours', () => {
    expect(isDigestHour(THU_EVENING_HT, 'America/Port-au-Prince')).toBe(true)
    expect(isDigestHour(THU_EVENING_HT, 'Europe/Paris')).toBe(false) // 23:30 in Paris
    expect(isDigestHour(new Date('2026-11-26T16:30:00Z'), 'Europe/Paris')).toBe(true) // 17:30 Paris
    expect(isDigestHour(new Date('2026-11-26T17:00:00Z'), 'America/Port-au-Prince')).toBe(false) // noon
    expect(isDigestHour(new Date('2026-11-27T22:30:00Z'), 'America/Port-au-Prince')).toBe(false) // Friday
  })

  it('the vercel.json schedule reaches every market inside its send hours', () => {
    const schedule = require('../vercel.json').crons.find((c: any) => c.path === '/api/cron/weekly-digest').schedule
    expect(schedule).toBe('0 16-23 * * 4')
    const runs = Array.from({ length: 8 }, (_, i) => new Date(Date.UTC(2026, 10, 26, 16 + i)))
    const summer = Array.from({ length: 8 }, (_, i) => new Date(Date.UTC(2026, 6, 16, 16 + i)))
    for (const tz of ['America/Port-au-Prince', 'America/New_York', 'America/Toronto', 'Europe/Paris']) {
      expect(runs.some((r) => isDigestHour(r, tz))).toBe(true)
      expect(summer.some((r) => isDigestHour(r, tz))).toBe(true)
    }
  })
})

describe('matching and copy', () => {
  const upcoming = upcomingDigestEvents(rows, THU_EVENING_HT)

  it('keeps published, live, upcoming events only', () => {
    expect(upcoming.map((e) => e.id)).toEqual(['a', 'b', 'g', 'c', 'd'])
  })

  it('names the weekend in the person’s language, no em-dashes', () => {
    expect(weekendDigestCopy('Port-au-Prince', [{ title: 'A' }], 'en')).toEqual({ title: 'This weekend in Port-au-Prince', body: 'A' })
    expect(weekendDigestCopy('Port-au-Prince', [{ title: 'A' }, { title: 'B' }], 'fr')?.body).toBe('A et B')
    expect(weekendDigestCopy('Port-au-Prince', [{ title: 'A' }, { title: 'B' }, { title: 'C' }], 'ht')).toEqual({
      title: 'Wikenn sa a nan Port-au-Prince',
      body: 'A, B ak 1 lòt ankò',
    })
    expect(weekendDigestCopy('X', [], 'en')).toBeNull()
    expect(JSON.stringify(weekendDigestCopy('X', [{ title: 'A' }, { title: 'B' }, { title: 'C' }], 'fr'))).not.toMatch(/—/)
  })

  it('language: explicit, else French for France, else English', () => {
    expect(digestLang({ language: 'ht' })).toBe('ht')
    expect(digestLang({ last_seen_country: 'FR' })).toBe('fr')
    expect(digestLang({})).toBe('en')
  })

  const person = { last_seen_city: 'Port-au-Prince', last_seen_country: 'HT', language: 'en' }

  it('sends the weekend digest with this week’s cap key', () => {
    const plan = planThursdaySend(person, upcoming, THU_EVENING_HT)!
    expect(plan).toMatchObject({
      category: 'weekend_digest',
      type: 'weekend_digest',
      capKey: thursdayCapKey('2026-11-27'),
      title: 'This weekend in Port-au-Prince',
      body: 'Kompa Friday, Rara Saturday and 1 more',
      url: '/discover',
    })
  })

  it('falls back to the old discovery push (same cap) when the weekend switch is off or the weekend is empty', () => {
    const off = planThursdaySend({ ...person, notify_weekend_digest: false }, upcoming, THU_EVENING_HT)!
    expect(off).toMatchObject({ category: 'discovery', type: 'city_discovery', capKey: 'thursday:2026-11-27' })
    expect(off.title).toBe('4 new events in Port-au-Prince')
    expect(off.body).toBe('Kompa Friday · Rara Saturday · Sunday Brunch')

    const onlyNextWeek = upcoming.filter((e) => e.id === 'd')
    expect(planThursdaySend(person, onlyNextWeek, THU_EVENING_HT)).toMatchObject({
      category: 'discovery',
      title: 'New in Port-au-Prince: Next Week Gala',
    })
  })

  it('sends nothing when both switches are off, the city is unknown or has nothing, or it is not the hour', () => {
    expect(planThursdaySend({ ...person, notify_weekend_digest: false, notify_discovery: false }, upcoming, THU_EVENING_HT)).toBeNull()
    expect(planThursdaySend({ last_seen_country: 'HT' }, upcoming, THU_EVENING_HT)).toBeNull()
    expect(planThursdaySend({ ...person, last_seen_city: 'Jacmel' }, upcoming, THU_EVENING_HT)).toBeNull()
    expect(planThursdaySend(person, upcoming, new Date('2026-11-26T17:00:00Z'))).toBeNull()
  })
})

describe('policy', () => {
  it('the digest is discretionary with its own switch', () => {
    expect(isTransactional('weekend_digest')).toBe(false)
    expect(USER_NOTIFY_FIELDS).toContain('notify_weekend_digest')
  })
})

describe('run', () => {
  it('sends each eligible person one planned push through the discretionary sender', async () => {
    const send = jest.fn(async () => true)
    const result = await runThursdayDigest(THU_EVENING_HT, {
      loadEvents: async () => rows,
      loadUsers: async () => [
        { id: 'u1', data: { last_seen_city: 'Port-au-Prince', last_seen_country: 'HT' } },
        { id: 'u2', data: { last_seen_city: 'Miami', last_seen_country: 'US' } },
        { id: 'u3', data: { last_seen_city: 'Paris', last_seen_country: 'FR' } },
      ],
      send,
    })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.map((c: any[]) => c[0])).toEqual(['u1', 'u2'])
    expect(result).toEqual({ users: 3, candidates: 5, weekend: 2, discovery: 0 })
  })
})
