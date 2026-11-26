/**
 * Backfilling `timezone` on events saved without one (or with the blanket
 * Port-au-Prince older app builds stamped everywhere): from the place, Haiti
 * by default. From Tikra 60b6e3a5, adapted to Tikèm's markets.
 */
import { timezoneBackfillFor } from '@/lib/events/timezone-backfill'

describe('timezoneBackfillFor', () => {
  it('keeps a valid stored zone', () => {
    expect(timezoneBackfillFor({ timezone: 'America/Toronto', country: 'CA', city: 'Toronto' })).toEqual({ action: 'skip', reason: 'has-zone' })
    expect(timezoneBackfillFor({ timezone: 'America/Port-au-Prince', country: 'HT', city: 'Jacmel' }).action).toBe('skip')
  })

  it('sets a missing or invalid zone from the place', () => {
    expect(timezoneBackfillFor({ country: 'HT', city: 'Port-au-Prince' })).toMatchObject({ action: 'set', timezone: 'America/Port-au-Prince', reason: 'missing' })
    expect(timezoneBackfillFor({ country: 'FR', city: 'Paris', timezone: 'Mars/Olympus' })).toMatchObject({ action: 'set', timezone: 'Europe/Paris', reason: 'invalid', from: 'Mars/Olympus' })
    expect(timezoneBackfillFor({})).toMatchObject({ action: 'set', timezone: 'America/Port-au-Prince' })
  })

  it('fixes the blanket Port-au-Prince on an event elsewhere', () => {
    expect(timezoneBackfillFor({ timezone: 'America/Port-au-Prince', country: 'FR', city: 'Paris' })).toMatchObject({
      action: 'set',
      timezone: 'Europe/Paris',
      reason: 'blanket-haiti',
    })
  })
})
