/**
 * Post-event photos and "next from the organizer" (ported from Tikra f832197a).
 *
 * @jest-environment node
 */
import {
  cleanCaption,
  nextEventByOrganizer,
  parseReview,
  photoWindowOpen,
  ticketShowsAttendance,
  PHOTO_WINDOW_DAYS,
} from '@/lib/postEvent/photos'

describe('attendee photos', () => {
  it('cleans a caption to one short line', () => {
    expect(cleanCaption('  Great  night ')).toBe('Great night')
    expect(cleanCaption('')).toBeNull()
    expect(cleanCaption('x'.repeat(500))?.length).toBe(140)
  })

  it('opens from the start until a month after the end', () => {
    const e = { start_datetime: '2026-11-20T18:00:00Z', end_datetime: '2026-11-20T21:00:00Z' }
    expect(photoWindowOpen(e, Date.parse('2026-11-20T17:00:00Z'))).toBe(false)
    expect(photoWindowOpen(e, Date.parse('2026-11-20T19:00:00Z'))).toBe(true)
    expect(photoWindowOpen(e, Date.parse('2026-11-20T21:00:00Z') + (PHOTO_WINDOW_DAYS + 1) * 86_400_000)).toBe(false)
    expect(photoWindowOpen({}, Date.now())).toBe(false)
  })

  it('counts every live spelling and scanned tickets, never unsold printed or refunded ones', () => {
    for (const status of ['valid', 'confirmed', 'active', '', 'used']) {
      expect({ status, ok: ticketShowsAttendance({ status }) }).toEqual({ status, ok: true })
    }
    expect(ticketShowsAttendance({ status: 'transferred', checked_in: true })).toBe(true)
    expect(ticketShowsAttendance({ status: 'printed_unsold' })).toBe(false)
    expect(ticketShowsAttendance({ status: 'refunded' })).toBe(false)
    expect(ticketShowsAttendance({ status: 'valid', refund_status: 'approved' })).toBe(false)
    expect(ticketShowsAttendance({ status: 'cancelled' })).toBe(false)
    expect(ticketShowsAttendance(null)).toBe(false)
  })

  it('reads a moderation decision', () => {
    expect(parseReview({ photoId: 'p1', status: 'approved' })).toEqual({ photoId: 'p1', status: 'approved' })
    expect(parseReview({ photoId: 'p1', status: 'pending' })).toBeNull()
    expect(parseReview({ photoId: '../x', status: 'rejected' })).toBeNull()
  })
})

describe('nextEventByOrganizer', () => {
  const NOW = Date.parse('2026-11-24T12:00:00Z')
  it('is the soonest upcoming public event other than this one', () => {
    const events = [
      { id: 'this', is_published: true, start_datetime: '2026-12-01T18:00:00Z' },
      { id: 'later', is_published: true, start_datetime: '2026-12-20T18:00:00Z' },
      { id: 'soon', is_published: true, start_datetime: { toDate: () => new Date('2026-12-05T18:00:00Z') } },
      { id: 'draft', is_published: false, start_datetime: '2026-11-25T18:00:00Z' },
      { id: 'cancelled', is_published: true, status: 'cancelled', start_datetime: '2026-11-26T18:00:00Z' },
      { id: 'unlisted', is_published: true, show_on_explore: false, start_datetime: '2026-11-26T18:00:00Z' },
      { id: 'locked', is_published: true, is_password_protected: true, start_datetime: '2026-11-26T18:00:00Z' },
      { id: 'past', is_published: true, start_datetime: '2026-11-01T18:00:00Z' },
    ]
    expect(nextEventByOrganizer(events, 'this', NOW)?.id).toBe('soon')
    expect(nextEventByOrganizer([], 'this', NOW)).toBeNull()
  })
})
