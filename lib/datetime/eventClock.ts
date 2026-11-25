/**
 * The ONE rule for how an event's clock time is printed (web + server).
 *
 * Owner, 2026-11-25: "the time should not be military — in Haiti we use am,
 * pm". Every time shown for a Haiti event (country HT, or zone
 * America/Port-au-Prince) is a 12-hour clock with AM/PM — "8:00 PM", no
 * leading zero, minutes always shown — in EVERY UI language. French and Kreyòl
 * keep their date words ("samedi 21 juin 2026 · 8:00 PM"); only the clock is
 * fixed. fr-FR Intl defaults to 24h ("20:00"), which is why every Haiti path
 * goes through here instead of a bare Intl / toLocaleTimeString.
 *
 * Other markets keep their own convention (US 12h; CA/FR follow the locale).
 *
 * The 12-hour string is built by hand, not by Intl, so it is the same on every
 * engine (Chrome's ICU puts a U+202F narrow space before "PM", which PDF fonts
 * and Wallet passes cannot always draw).
 *
 * Mirrored for the app in mobile/lib/eventClock.ts.
 */

import { eventZone } from '@/lib/home/feed'
import { intlLocaleFor } from '@/lib/dateLocale'

export const HAITI_ZONE = 'America/Port-au-Prince'

export type ClockEvent = { country?: unknown; timezone?: unknown; city?: unknown } | null | undefined

/** "HT", "Haiti", "Haïti", "Ayiti" (any case). */
export function isHaitiCountry(country: unknown): boolean {
  const c = String(country ?? '').trim().toUpperCase()
  return c === 'HT' || c === 'HTI' || c === 'HAITI' || c === 'HAÏTI' || c === 'AYITI'
}

export function isHaitiZone(zone: unknown): boolean {
  return typeof zone === 'string' && zone.trim() === HAITI_ZONE
}

/**
 * Whether an event is a Haiti event: country HT, or (no country) its zone is
 * Port-au-Prince — the same zone rule the event page uses to print its times.
 */
export function isHaitiEvent(event: ClockEvent): boolean {
  if (!event) return false
  if (isHaitiCountry(event.country)) return true
  if (String(event.country ?? '').trim()) return false
  return isHaitiZone(eventZone(event))
}

function hourMinuteIn(at: Date, zone?: string | null): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone || undefined,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(at)
    const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0)
    return { hour: get('hour') % 24, minute: get('minute') }
  } catch {
    return { hour: at.getHours(), minute: at.getMinutes() }
  }
}

/** "8:00 PM" from a 0-23 hour and a minute. */
export function clock12FromParts(hour: number, minute: number): string {
  const h = ((hour % 24) + 24) % 24
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(minute).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** "8:00 PM": an instant's 12-hour clock in `zone` (the runtime's when absent). */
export function clock12(at: Date | string | number, zone?: string | null): string {
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const { hour, minute } = hourMinuteIn(d, zone)
  return clock12FromParts(hour, minute)
}

/**
 * "20:00" / "20h00" / "20 h 30" → "8:00 PM" / "8:30 PM"; anything else is
 * returned unchanged. For stored wall-clock strings (doors, lineup slots).
 */
export function hhmmTo12(hhmm: string): string {
  const m = /^(\d{1,2})\s*[:hH]\s*(\d{2})$/.exec(String(hhmm ?? '').trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return hhmm
  return clock12FromParts(Number(m[1]), Number(m[2]))
}

/**
 * Intl options to spread into any DateTimeFormat that prints an hour: forces
 * the 12-hour clock for a Haiti event, and changes nothing elsewhere.
 */
export function haitiHourOptions(haiti: boolean): Intl.DateTimeFormatOptions {
  return haiti ? { hour12: true } : {}
}

/**
 * An event's clock time: "8:00 PM" for Haiti (any language), else the
 * reader's locale convention in the event's zone ("8:00 PM" en, "20:00" fr).
 * `haiti` defaults to "is the zone Port-au-Prince".
 */
export function formatEventClock(
  at: Date | string | number,
  opts: { zone?: string | null; lang?: string; haiti?: boolean } = {}
): string {
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const haiti = opts.haiti ?? isHaitiZone(opts.zone)
  if (haiti) return clock12(d, opts.zone)
  try {
    return new Intl.DateTimeFormat(intlLocaleFor(opts.lang), {
      timeZone: opts.zone || undefined,
      hour: 'numeric',
      minute: '2-digit',
    }).format(d)
  } catch {
    return clock12(d)
  }
}

/**
 * Date + time of an event instant through Intl, on the EVENT's clock (its
 * zone, never the server's or the reader's) and with the 12-hour clock forced
 * for a Haiti event: fr gives "samedi 21 juin 2026 à 8:00 PM". `options` are
 * the caller's date/time fields; anything that is not Haiti prints exactly as
 * Intl would for the reader's locale.
 */
export function formatEventDateTime(
  at: Date | string | number | null | undefined,
  event: ClockEvent,
  lang: string | undefined,
  options: Intl.DateTimeFormatOptions
): string {
  if (at == null || at === '') return ''
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const opts = { ...options, timeZone: eventZone(event), ...haitiHourOptions(isHaitiEvent(event)) }
  try {
    return new Intl.DateTimeFormat(intlLocaleFor(lang), opts).format(d)
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(d)
  }
}

/**
 * The date line printed ON a ticket (printed PDF, Wallet pass): a Haiti event
 * is always French with the 12-hour clock — "samedi 21 juin 2026 · 8:00 PM" —
 * whatever the buyer's language (owner, 2026-11-25: Haiti tickets are in
 * French). Other events use `lang` and their locale's clock.
 */
export function ticketDateLine(at: Date | string | number | null | undefined, event: ClockEvent, lang?: string): string {
  if (at == null || at === '') return ''
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const haiti = isHaitiEvent(event)
  const zone = eventZone(event)
  const loc = haiti ? 'fr-FR' : intlLocaleFor(lang)
  const day = new Intl.DateTimeFormat(loc, {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)
  return `${day} · ${formatEventClock(d, { zone, lang: haiti ? 'fr' : lang, haiti })}`
}
