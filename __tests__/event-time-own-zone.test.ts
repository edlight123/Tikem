/**
 * Event times read on the EVENT's clock, not the reader's: the mobile event
 * page (mobile/lib/dates formatEventTime) and the web ticket card
 * (app/tickets/TicketCard ticketCardDateLabel).
 */
import { eventTimeZone, formatEventTime, wallClockIn, safeFormatForLanguage } from '../mobile/lib/dates'
import { ticketCardDateLabel } from '@/app/tickets/TicketCard'

// 2026-10-10 02:00 UTC = Fri Oct 9, 10:00 PM in Port-au-Prince (EDT, -04:00)
// and Sat Oct 10, 4:00 AM in Paris (CEST, +02:00).
const LATE_SHOW = '2026-10-10T02:00:00.000Z'

describe('mobile eventTimeZone', () => {
  it('uses a valid stored zone', () => {
    expect(eventTimeZone({ timezone: 'America/Port-au-Prince' })).toBe('America/Port-au-Prince')
  })
  it('ignores a missing, empty or junk zone (phone clock)', () => {
    expect(eventTimeZone({})).toBeUndefined()
    expect(eventTimeZone(null)).toBeUndefined()
    expect(eventTimeZone({ timezone: '' })).toBeUndefined()
    expect(eventTimeZone({ timezone: 'Not/AZone' })).toBeUndefined()
    expect(eventTimeZone({ timezone: 42 })).toBeUndefined()
  })
})

describe('mobile formatEventTime', () => {
  it('prints the wall time in the event zone', () => {
    const event = { timezone: 'America/Port-au-Prince' }
    expect(formatEventTime(LATE_SHOW, event, 'EEE, MMM d', 'en')).toBe('Fri, Oct 9')
    expect(formatEventTime(LATE_SHOW, event, 'h:mm a', 'en')).toBe('10:00 PM')
  })
  it('follows the zone, not a fixed offset', () => {
    expect(formatEventTime(LATE_SHOW, { timezone: 'Europe/Paris' }, 'h:mm a', 'en')).toBe('4:00 AM')
  })
  it('keeps the French date order', () => {
    expect(formatEventTime(LATE_SHOW, { timezone: 'Europe/Paris' }, 'EEE, MMM d', 'fr')).toBe('sam. 10 oct.')
  })
  it('falls back to the phone zone when the event has none (no country guess)', () => {
    expect(formatEventTime(LATE_SHOW, { country: 'CA' } as any, 'h:mm a', 'en')).toBe(
      safeFormatForLanguage(new Date(LATE_SHOW), 'h:mm a', 'en')
    )
    expect(formatEventTime(LATE_SHOW, null, 'h:mm a', 'en')).toBe(
      safeFormatForLanguage(new Date(LATE_SHOW), 'h:mm a', 'en')
    )
  })
  it('accepts a Firestore-like Timestamp and returns empty for junk', () => {
    const ts = { toDate: () => new Date(LATE_SHOW) }
    expect(formatEventTime(ts, { timezone: 'America/Port-au-Prince' }, 'h:mm a', 'en')).toBe('10:00 PM')
    expect(formatEventTime('not a date', { timezone: 'Europe/Paris' }, 'h:mm a', 'en')).toBe('')
    expect(formatEventTime(undefined, { timezone: 'Europe/Paris' }, 'h:mm a', 'en')).toBe('')
  })
  it('wallClockIn carries the zone fields as local fields', () => {
    const d = wallClockIn(new Date(LATE_SHOW), 'America/Port-au-Prince')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 9, 22, 0])
  })
})

describe('web ticketCardDateLabel', () => {
  it('uses the stored zone', () => {
    expect(ticketCardDateLabel(LATE_SHOW, { timezone: 'America/Port-au-Prince' })).toBe('Fri, Oct 9 · 10:00 PM')
    expect(ticketCardDateLabel(LATE_SHOW, { timezone: 'Europe/Paris' })).toBe('Sat, Oct 10 · 4:00 AM')
  })
  it('falls back to the city/country zone', () => {
    expect(ticketCardDateLabel(LATE_SHOW, { country: 'FR' })).toBe('Sat, Oct 10 · 4:00 AM')
  })
  it('says TBA for a missing or bad date', () => {
    expect(ticketCardDateLabel(undefined, {})).toBe('Date TBA')
    expect(ticketCardDateLabel('nope', {})).toBe('Date TBA')
  })
})
