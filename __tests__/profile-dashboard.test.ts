import { countAttended, liveTicketEventIds, sortPostersNewestFirst, toDateOrNull } from '@/lib/profile/dashboard'

describe('profile dashboard helpers', () => {
  const now = new Date('2026-10-22T12:00:00Z')

  it('keeps only live tickets and de-duplicates event ids', () => {
    expect(
      liveTicketEventIds([
        { event_id: 'a', status: 'valid' },
        { event_id: 'a', status: 'confirmed' },
        { event_id: 'b', status: 'active' },
        { event_id: 'c', status: 'refunded' },
        { event_id: 'd' }, // older doc with no status counts as live
        { event_id: '', status: 'valid' },
      ])
    ).toEqual(['a', 'b', 'd'])
  })

  it('counts an event as attended once its end (else start) has passed', () => {
    expect(
      countAttended(
        [
          { id: 'past', start_datetime: '2026-10-01T20:00:00Z', end_datetime: '2026-10-02T02:00:00Z' },
          { id: 'running', start_datetime: '2026-10-22T10:00:00Z', end_datetime: '2026-10-22T23:00:00Z' },
          { id: 'past-no-end', start_datetime: { toDate: () => new Date('2026-09-01T00:00:00Z') } },
          { id: 'future', start_datetime: '2026-12-01T00:00:00Z' },
          { id: 'undated' },
        ],
        now
      )
    ).toBe(2)
  })

  it('sorts posters newest first with undated last', () => {
    const sorted = sortPostersNewestFirst([
      { id: 'old', start_datetime: '2025-01-01T00:00:00Z' },
      { id: 'undated' },
      { id: 'new', start_datetime: new Date('2026-11-01T00:00:00Z') },
    ])
    expect(sorted.map((e) => e.id)).toEqual(['new', 'old', 'undated'])
  })

  it('parses dates defensively', () => {
    expect(toDateOrNull('not a date')).toBeNull()
    expect(toDateOrNull(null)).toBeNull()
    expect(toDateOrNull(0)).toBeNull()
    expect(toDateOrNull('2026-10-22T00:00:00Z')?.toISOString()).toBe('2026-10-22T00:00:00.000Z')
  })
})
