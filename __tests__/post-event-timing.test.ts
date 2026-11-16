import { arrivalBuckets, eventEnd, followupDue } from '@/lib/postEvent/timing'

const PAP = 'America/Port-au-Prince' // UTC-5 in November (no DST)

describe('followupDue', () => {
  // Event ends Sun 13 Dec 2026, 19:00 in Haiti = 14 Dec 00:00 UTC.
  const end = new Date('2026-12-14T00:00:00Z')

  it('waits for the next local morning', () => {
    expect(followupDue(end, new Date('2026-12-14T03:00:00Z'), PAP)).toBe(false) // 22:00 same day
    expect(followupDue(end, new Date('2026-12-14T13:00:00Z'), PAP)).toBe(false) // 08:00 next day
    expect(followupDue(end, new Date('2026-12-14T15:00:00Z'), PAP)).toBe(true) // 10:00 next day
    expect(followupDue(end, new Date('2026-12-15T01:30:00Z'), PAP)).toBe(true) // 20:30
  })

  it('respects quiet hours and gives up after the window', () => {
    expect(followupDue(end, new Date('2026-12-15T02:00:00Z'), PAP)).toBe(false) // 21:00
    expect(followupDue(end, new Date('2026-12-15T15:00:00Z'), PAP)).toBe(true) // day two, 10:00
    expect(followupDue(end, new Date('2026-12-16T15:00:00Z'), PAP)).toBe(false) // 63h later
  })

  it('handles an event that ends after midnight', () => {
    // Ends 01:00 local on the 14th: "the morning after" is the 15th, not the 14th.
    const late = new Date('2026-12-14T06:00:00Z')
    expect(followupDue(late, new Date('2026-12-14T15:00:00Z'), PAP)).toBe(false)
    expect(followupDue(late, new Date('2026-12-15T15:00:00Z'), PAP)).toBe(true)
  })

  it('never fires for a future or invalid end', () => {
    expect(followupDue(new Date('2027-01-01T00:00:00Z'), new Date('2026-12-14T15:00:00Z'), PAP)).toBe(false)
    expect(followupDue(new Date('x'), new Date(), PAP)).toBe(false)
  })
})

describe('eventEnd', () => {
  it('prefers end_datetime and falls back to start + 4h', () => {
    expect(eventEnd({ end_datetime: '2026-12-14T00:00:00Z' })?.toISOString()).toBe('2026-12-14T00:00:00.000Z')
    expect(eventEnd({ start_datetime: '2026-12-13T20:00:00Z' })?.toISOString()).toBe('2026-12-14T00:00:00.000Z')
    expect(eventEnd({ start_datetime: { toDate: () => new Date('2026-12-13T20:00:00Z') } })?.toISOString()).toBe(
      '2026-12-14T00:00:00.000Z'
    )
    expect(eventEnd({})).toBeNull()
  })
})

describe('arrivalBuckets', () => {
  it('fills empty slots between the first and last arrival', () => {
    const b = arrivalBuckets([
      new Date('2026-12-13T20:05:00Z'),
      new Date('2026-12-13T20:10:00Z'),
      new Date('2026-12-13T21:20:00Z'),
    ])
    expect(b.map((x) => x.count)).toEqual([2, 0, 1])
  })
})
