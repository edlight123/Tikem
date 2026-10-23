import * as web from '../lib/profile/dashboard'
import * as mobile from '../mobile/lib/profileStats'
import { isLiveTicketStatus } from '../lib/tickets/status'

/**
 * The app's Profile "attended" number must equal the web /profile's for the
 * same account: live tickets only, one per event, counted once it has ended.
 */
describe('profile stats: mobile matches web', () => {
  const now = new Date('2026-10-22T12:00:00Z')

  it('agrees on which statuses are live', () => {
    for (const s of [undefined, null, '', 'valid', 'CONFIRMED', ' active ', 'refunded', 'cancelled', 'transferred', 'pending', 'checked_in']) {
      expect(mobile.isLiveTicketStatus(s)).toBe(isLiveTicketStatus(s))
    }
  })

  it('agrees that scanned tickets count toward attendance, refunds do not', () => {
    for (const s of ['valid', 'checked_in', 'USED', 'refunded', 'cancelled', 'transferred', '']) {
      expect(mobile.countsTowardAttendance(s)).toBe(web.countsTowardAttendance(s))
    }
    expect(web.countsTowardAttendance('checked_in')).toBe(true)
    expect(web.countsTowardAttendance('refunded')).toBe(false)
  })

  it('keeps the same live, de-duplicated event ids', () => {
    const tickets = [
      { event_id: 'a', status: 'valid' },
      { event_id: 'a', status: 'confirmed' },
      { event_id: 'b', status: 'active' },
      { event_id: 'c', status: 'refunded' },
      { event_id: 'c2', status: 'cancelled' },
      { event_id: 'd' },
      { event_id: '', status: 'valid' },
    ]
    expect(mobile.liveTicketEventIds(tickets)).toEqual(web.liveTicketEventIds(tickets))
    expect(mobile.liveTicketEventIds(tickets)).toEqual(['a', 'b', 'd'])
  })

  it('counts attended events the same way', () => {
    const events = [
      { id: 'past', start_datetime: '2026-10-01T20:00:00Z', end_datetime: '2026-10-02T02:00:00Z' },
      { id: 'running', start_datetime: '2026-10-22T10:00:00Z', end_datetime: '2026-10-22T23:00:00Z' },
      { id: 'past-no-end', start_datetime: { toDate: () => new Date('2026-09-01T00:00:00Z') } },
      { id: 'past-date', start_datetime: new Date('2026-08-01T00:00:00Z') },
      { id: 'future', start_datetime: '2026-12-01T00:00:00Z' },
      { id: 'garbage', start_datetime: 'not a date' },
      { id: 'undated' },
    ]
    expect(mobile.countAttended(events, now)).toBe(web.countAttended(events, now))
    expect(mobile.countAttended(events, now)).toBe(3)
    expect(mobile.sortPostersNewestFirst(events).map((e) => e.id)).toEqual(
      web.sortPostersNewestFirst(events).map((e) => e.id)
    )
  })
})
