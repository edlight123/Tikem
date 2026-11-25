import { marketTimezone } from '@/lib/notifications/policy'
import { toDate } from '@/lib/postEvent/timing'
import { EXPORT_LOCALE, type ExportLang } from './labels'
import { isoDay } from './fileName'
import { haitiHourOptions, isHaitiCountry, isHaitiZone } from '@/lib/datetime/eventClock'

/**
 * What every event export puts at the top: title, "date · time" and venue in
 * the event's own timezone, the organizer, and the event day for the file name.
 */
export function eventHeader(event: Record<string, any>, lang: ExportLang) {
  const timeZone = (typeof event.timezone === 'string' && event.timezone) || marketTimezone(event.country) || 'America/New_York'
  const locale = EXPORT_LOCALE[lang]
  const start = toDate(event.start_datetime)
  let dateLine = ''
  if (start) {
    // Haiti reads AM/PM in every language (owner, 2026-11-25): fr-FR alone prints "20:00".
    const o: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...haitiHourOptions(isHaitiZone(timeZone) || isHaitiCountry(event.country)),
    }
    try {
      dateLine = new Intl.DateTimeFormat(locale, { timeZone, ...o }).format(start)
    } catch {
      dateLine = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...o }).format(start)
    }
  }
  const venueLine = [event.venue_name, event.city].filter(Boolean).join(', ')
  return {
    title: String(event.title || ''),
    subtitle: [dateLine, venueLine].filter(Boolean),
    organizerName: String(event.organizer_name || ''),
    timeZone,
    locale,
    start,
    day: start ? isoDay(start, timeZone) : '',
  }
}
