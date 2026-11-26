/**
 * What the time-zone backfill (/api/admin/events/backfill-timezone) writes on
 * one event: the IANA `timezone` its place implies, for an event saved before
 * the composer stored one (or with a zone this runtime does not know).
 *
 * Only `timezone` is set. The stored instants (`start_datetime`, …) are left
 * exactly as they are: every reader already fell back to this same zone
 * (lib/home/feed eventZone), so storing it changes no displayed time.
 */
import { isValidZone } from '@/lib/events/zonedTime'
import { timezoneForEvent } from '@/lib/events/composer-country'

export type TimezoneBackfill =
  | { action: 'skip'; reason: 'has-zone' }
  | { action: 'set'; timezone: string; reason: 'missing' | 'invalid' | 'blanket-haiti'; from: string | null }

export function timezoneBackfillFor(event: {
  timezone?: unknown
  country?: unknown
  city?: unknown
  province?: unknown
  is_online?: unknown
}): TimezoneBackfill {
  const stored = typeof event?.timezone === 'string' ? event.timezone.trim() : ''
  const online = event?.is_online === true
  const country = typeof event?.country === 'string' && event.country.trim() ? event.country.trim().toUpperCase() : 'HT'
  // Older app builds stamped Port-au-Prince on every event, wherever it was.
  const blanketHaiti = stored === 'America/Port-au-Prince' && country !== 'HT'
  if (stored && isValidZone(stored) && !blanketHaiti) return { action: 'skip', reason: 'has-zone' }
  const timezone = timezoneForEvent(country, online ? '' : event?.city)
  return { action: 'set', timezone, reason: blanketHaiti ? 'blanket-haiti' : stored ? 'invalid' : 'missing', from: stored || null }
}
