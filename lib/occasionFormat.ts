// Dates for the occasion pages and rows (lib/occasions days are YYYY-MM-DD,
// calendar days, so they format in UTC to stay on the same day everywhere).

import { intlLocaleFor } from '@/lib/dateLocale'

const at = (iso: string) => new Date(`${iso}T12:00:00Z`)

/** "18 November 2026" / "November 18, 2026". */
export function formatOccasionDay(iso: string, lang?: string, withYear = true): string {
  return new Intl.DateTimeFormat(intlLocaleFor(lang), {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(at(iso))
}

/** One day, or "15 – 17 February 2026" (the year once, at the end). */
export function formatOccasionRange(start: string, end: string, lang?: string): string {
  if (start === end) return formatOccasionDay(start, lang)
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  return `${formatOccasionDay(start, lang, !sameYear)} – ${formatOccasionDay(end, lang)}`
}

/** A short form for a row eyebrow: "15 – 17 Feb". */
export function formatOccasionShort(start: string, end: string, lang?: string): string {
  const f = (iso: string) =>
    new Intl.DateTimeFormat(intlLocaleFor(lang), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(at(iso))
  return start === end ? f(start) : `${f(start)} – ${f(end)}`
}
