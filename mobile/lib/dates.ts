import { format } from 'date-fns'
import { enUS, fr } from 'date-fns/locale'

import type { Language } from '../contexts/I18nContext'

export function getDateFnsLocale(language: Language) {
  switch (language) {
    case 'fr':
      return fr
    case 'ht':
      // date-fns doesn't currently ship an ht locale; French is the closest match.
      return fr
    case 'en':
    default:
      return enUS
  }
}

// date-fns applies the locale's WORDS but respects the pattern's literal ORDER,
// so "EEE, MMM d" renders "dim., août 9" in French — wrong. French/Kreyòl want
// day-before-month ORDER. Time stays 12-hour (h:mm a) — Haiti uses AM/PM, not
// 24-hour "military" time — so only the DATE order is remapped, not the clock.
// Unknown patterns pass through unchanged.
const FR_PATTERN_MAP: Record<string, string> = {
  'EEE, MMM d · h:mm a': 'EEE d MMM · h:mm a',
  'EEE, MMM d • h:mm a': 'EEE d MMM • h:mm a',
  'MMM d, yyyy · h:mm a': 'd MMM yyyy · h:mm a',
  'EEE, MMM d': 'EEE d MMM',
  'EEEE, MMMM d, yyyy': 'EEEE d MMMM yyyy',
  'EEEE, MMMM dd, yyyy': 'EEEE dd MMMM yyyy',
  'MMMM d, yyyy': 'd MMMM yyyy',
  'MMMM dd, yyyy': 'dd MMMM yyyy',
  'MMMM dd, yyyy h:mm a': 'dd MMMM yyyy h:mm a',
  'MMM d, yyyy': 'd MMM yyyy',
  'MMM dd, yyyy': 'dd MMM yyyy',
  'MMM dd, yyyy h:mm a': 'dd MMM yyyy h:mm a',
  'MMM d': 'd MMM',
  'MMM dd': 'dd MMM',
  // 'h:mm a' (time only) passes through unchanged — 12-hour everywhere.
}

function localizePattern(pattern: string, language: Language): string {
  if (language === 'fr' || language === 'ht') return FR_PATTERN_MAP[pattern] || pattern
  return pattern
}

export function formatDateForLanguage(date: Date, pattern: string, language: Language) {
  return format(date, localizePattern(pattern, language), { locale: getDateFnsLocale(language) })
}

/** True only for a real, finite Date. */
export function isValidDate(value: any): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

/**
 * Crash-safe date formatter: coerces the input to a Date and returns '' when it
 * is missing or invalid instead of throwing (date-fns `format` throws on an
 * Invalid Date). Use this at every render site that formats event dates.
 */
export function safeFormatForLanguage(value: any, pattern: string, language: Language): string {
  const date = value instanceof Date ? value : value ? new Date(value) : null
  if (!isValidDate(date)) return ''
  return format(date, localizePattern(pattern, language), { locale: getDateFnsLocale(language) })
}

/**
 * The event's own IANA zone when it carries a usable one, else undefined
 * (meaning: the phone's zone). No country guess: an event without a stored
 * zone reads on the phone's clock, as it always did.
 */
export function eventTimeZone(event: { timezone?: unknown } | null | undefined): string | undefined {
  const tz = typeof event?.timezone === 'string' ? event.timezone.trim() : ''
  if (!tz) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return undefined
  }
}

/**
 * An instant's wall-clock reading in `zone`, as a Date whose LOCAL fields carry
 * it, so date-fns (which only formats in the phone's zone) prints the zone's
 * time. Display only: never compare it with a real instant. Mirrors the web's
 * lib/home/format wallClock.
 */
export function wallClockIn(at: Date, zone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  // Some engines print midnight as "24" even with h23.
  return new Date(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
}

/**
 * safeFormatForLanguage on the EVENT's clock: a 9 pm show in Port-au-Prince
 * reads 9 pm on a phone set to Paris. Falls back to the phone's zone when the
 * event has no zone or the engine cannot use it.
 */
export function formatEventTime(
  value: any,
  event: { timezone?: unknown } | null | undefined,
  pattern: string,
  language: Language,
): string {
  const date = value instanceof Date ? value : value?.toDate ? value.toDate() : value ? new Date(value) : null
  if (!isValidDate(date)) return ''
  const zone = eventTimeZone(event)
  if (zone) {
    try {
      return safeFormatForLanguage(wallClockIn(date, zone), pattern, language)
    } catch {
      // Fall through to the phone's clock.
    }
  }
  return safeFormatForLanguage(date, pattern, language)
}
