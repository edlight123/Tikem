/**
 * Date strings for the homepage's mono data lines, plus the zone-explicit
 * formatters the event page and discover cards share.
 *
 * Always formatted in an explicit zone — the reader's, resolved once on the
 * server (see lib/home/feed) — so the server render and the hydrating client
 * produce the same text. Punctuation is stripped because these lines are set
 * in uppercase mono, where "FRI, OCT 2" reads as noise next to "FRI OCT 2".
 */

import { format as dfFormat, type Locale } from 'date-fns'
import { intlLocaleFor } from '@/lib/dateLocale'

/** An instant's calendar and clock fields as read in `zone`. */
function zoneParts(at: Date | string | number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at))
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Some engines print midnight as "24" even with h23.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  }
}

/**
 * An instant's wall-clock reading in `zone`, as a Date whose LOCAL fields
 * carry it. date-fns only formats in the runtime's own zone (UTC on the
 * server, the reader's in the browser), so formatting this shifted Date gives
 * the same text on both sides. Only meant for display; never compare it with
 * a real instant. (The one imprecision: a wall time inside the runtime's own
 * spring-forward gap moves by an hour. It cannot happen on the UTC server.)
 */
export function wallClock(at: Date | string | number, zone: string): Date {
  const p = zoneParts(at, zone)
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
}

/**
 * ISO 8601 with the zone's UTC offset at that instant, e.g.
 * "2026-10-10T22:00:00-04:00". What schema.org Event dates want: the local
 * wall time AND the offset, so a crawler neither shifts nor guesses.
 */
export function isoWithOffset(at: Date | string | number, zone: string): string {
  const d = new Date(at)
  const p = zoneParts(d, zone)
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  // The wall clock read as if it were UTC, minus the real instant, is the offset.
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  const offsetMin = Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000)
  const sign = offsetMin < 0 ? '-' : '+'
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}` +
    `T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.trunc(offsetMin / 60))}:${pad(offsetMin % 60)}`
  )
}

/** date-fns `format`, but read in `zone` instead of the runtime's zone. */
export function formatInZone(
  at: Date | string | number,
  zone: string,
  pattern: string,
  options?: { locale?: Locale }
): string {
  return dfFormat(wallClock(at, zone), pattern, options)
}

const clean = (s: string) => s.replace(/[.,]/g, '').replace(/\s+/g, ' ').trim()

export function eventDay(iso: string, zone: string, lang?: string): string {
  return clean(
    new Intl.DateTimeFormat(intlLocaleFor(lang), {
      timeZone: zone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso))
  )
}

export function eventTime(iso: string, zone: string, lang?: string): string {
  return new Intl.DateTimeFormat(intlLocaleFor(lang), {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** "FRI OCT 2 · 6:00 PM" (uppercased by CSS). */
export function eventWhen(iso: string, zone: string, lang?: string): string {
  return `${eventDay(iso, zone, lang)} · ${eventTime(iso, zone, lang)}`
}

/** Weekday + day-of-month for a 'YYYY-MM-DD' calendar key (no zone shift). */
export function dayParts(key: string, lang?: string): { weekday: string; day: string } {
  const [y, m, d] = key.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d, 12))
  const weekday = clean(
    new Intl.DateTimeFormat(intlLocaleFor(lang), { timeZone: 'UTC', weekday: 'short' }).format(at)
  )
  return { weekday, day: String(d) }
}

/** Long weekday + date for a day key, for accessible labels. */
export function dayLabel(key: string, lang?: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Intl.DateTimeFormat(intlLocaleFor(lang), {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d, 12)))
}
