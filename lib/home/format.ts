/**
 * Date strings for the homepage's mono data lines.
 *
 * Always formatted in an explicit zone — the reader's, resolved once on the
 * server (see lib/home/feed) — so the server render and the hydrating client
 * produce the same text. Punctuation is stripped because these lines are set
 * in uppercase mono, where "FRI, OCT 2" reads as noise next to "FRI OCT 2".
 */

import { intlLocaleFor } from '@/lib/dateLocale'

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
