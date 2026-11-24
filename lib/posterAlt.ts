/**
 * What a screen reader says for an event poster. A flyer is a picture of text
 * (title, date, venue), so without a description a blind visitor hears
 * nothing, or just "image".
 *
 * Order: the organizer's own words (`poster_alt`, the quiet "Describe the
 * flyer" field in both composers), else a sentence built from the event's
 * facts:
 *   en  "Flyer for Konpa Ball, Saturday 28 November at 9 PM at Royale, Boston. Tickets from $25."
 *   fr  "Affiche de Konpa Ball, samedi 28 novembre à 21 h à Royale, Boston. Billets dès 25 $."
 *   ht  "Afich pou Konpa Ball, samdi 28 novanm a 9è PM nan Royale, Boston. Tikè apati 25 $."
 *
 * Mirrored in mobile/lib/posterAlt.ts (the app is a separate bundle); the two
 * are kept identical by __tests__/poster-alt.test.ts.
 */

export const POSTER_ALT_MAX = 300

export interface PosterAltEvent {
  title?: string | null
  venue_name?: string | null
  city?: string | null
  start_datetime?: unknown
  timezone?: string | null
  ticket_price?: number | null
  currency?: string | null
  ticket_tiers?: Array<{ price?: number | null } | null> | null
  has_paid_tiers?: boolean | null
  is_rsvp?: boolean | null
  pay_at_door?: boolean | null
  poster_alt?: string | null
}

type Lang = 'en' | 'fr' | 'ht'

const DAYS: Record<Lang, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  ht: ['dimanch', 'lendi', 'madi', 'mèkredi', 'jedi', 'vandredi', 'samdi'],
}
const MONTHS: Record<Lang, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  ht: ['janvye', 'fevriye', 'mas', 'avril', 'me', 'jen', 'jiyè', 'out', 'septanm', 'oktòb', 'novanm', 'desanm'],
}
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function langOf(raw: unknown): Lang {
  const l = String(raw || '').toLowerCase()
  if (l.startsWith('fr')) return 'fr'
  if (l.startsWith('ht') || l.startsWith('kr')) return 'ht'
  return 'en'
}

/** Trimmed, single-spaced, at most POSTER_ALT_MAX characters. */
export function cleanPosterAlt(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const s = raw.replace(/\s+/g, ' ').trim()
  return s.length > POSTER_ALT_MAX ? s.slice(0, POSTER_ALT_MAX).trimEnd() : s
}

interface WhenParts {
  weekday: number
  day: number
  month: number
  hour: number
  minute: number
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  let d: Date
  if (value instanceof Date) d = value
  else if (typeof value === 'string' || typeof value === 'number') d = new Date(value)
  else if (typeof (value as { toDate?: unknown }).toDate === 'function') d = (value as { toDate: () => Date }).toDate()
  else if (typeof (value as { seconds?: unknown }).seconds === 'number') d = new Date((value as { seconds: number }).seconds * 1000)
  else return null
  return isNaN(d.getTime()) ? null : d
}

function whenParts(value: unknown, timeZone?: string | null): WhenParts | null {
  const d = toDate(value)
  if (!d) return null
  const read = (tz?: string): WhenParts => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(d)
    const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
    return {
      weekday: WEEKDAY_INDEX[get('weekday')] ?? d.getDay(),
      day: Number(get('day')),
      month: Number(get('month')) - 1,
      hour: Number(get('hour')) % 24,
      minute: Number(get('minute')),
    }
  }
  try {
    return read(timeZone || undefined)
  } catch {
    try {
      return read()
    } catch {
      return null
    }
  }
}

function whenText(w: WhenParts, lang: Lang): string {
  const mm = String(w.minute).padStart(2, '0')
  const day = DAYS[lang][w.weekday]
  const month = MONTHS[lang][w.month]
  if (lang === 'fr') {
    const time = w.minute ? `${w.hour} h ${mm}` : `${w.hour} h`
    return `${day} ${w.day === 1 ? '1er' : w.day} ${month} à ${time}`
  }
  const h12 = w.hour % 12 || 12
  const ampm = w.hour < 12 ? 'AM' : 'PM'
  if (lang === 'ht') {
    const time = w.minute ? `${h12}:${mm} ${ampm}` : `${h12}è ${ampm}`
    return `${day} ${w.day} ${month} a ${time}`
  }
  const time = `${h12}${w.minute ? `:${mm}` : ''} ${ampm}`
  return `${day} ${w.day} ${month} at ${time}`
}

function isFree(e: PosterAltEvent): boolean {
  if (e.pay_at_door) return false
  if (e.has_paid_tiers === true) return false
  if (Array.isArray(e.ticket_tiers) && e.ticket_tiers.some((t) => Number(t?.price) > 0)) return false
  return !(Number(e.ticket_price) > 0)
}

function lowestPrice(e: PosterAltEvent): number {
  const prices = [Number(e.ticket_price) || 0, ...(e.ticket_tiers || []).map((t) => Number(t?.price) || 0)].filter(
    (p) => p > 0
  )
  return prices.length ? Math.min(...prices) : 0
}

function money(n: number, currency: string, lang: Lang): string {
  const whole = Math.round(n * 100) % 100 === 0
  const amount = whole ? String(Math.round(n)) : n.toFixed(2)
  const local = lang === 'en' ? amount : amount.replace('.', ',')
  const cur = currency.toUpperCase()
  if (cur === 'USD' || cur === 'CAD') return lang === 'en' ? `$${amount}` : `${local} $`
  if (cur === 'EUR') return lang === 'en' ? `€${amount}` : `${local} €`
  return `${local} ${cur}`
}

function priceText(e: PosterAltEvent, lang: Lang): string {
  // No price facts at all (a ticket card, a share): say nothing rather
  // than guess "Free".
  const known =
    e.ticket_price != null || Array.isArray(e.ticket_tiers) || e.has_paid_tiers != null || e.is_rsvp != null || e.pay_at_door != null
  if (!known) return ''
  if (isFree(e)) return lang === 'fr' ? 'Gratuit.' : lang === 'ht' ? 'Gratis.' : 'Free.'
  const p = lowestPrice(e)
  if (!(p > 0)) return ''
  const m = money(p, e.currency || 'HTG', lang)
  return lang === 'fr' ? `Billets dès ${m}.` : lang === 'ht' ? `Tikè apati ${m}.` : `Tickets from ${m}.`
}

/** The description built from the event's facts alone (ignores poster_alt). */
export function posterAltFromFacts(e: PosterAltEvent | null | undefined, language: unknown = 'en'): string {
  const lang = langOf(language)
  const ev = e || {}
  const title = String(ev.title || '').trim()
  const venue = String(ev.venue_name || '').trim()
  const city = String(ev.city || '').trim()
  const where = venue && city && venue.toLowerCase() !== city.toLowerCase() ? `${venue}, ${city}` : venue || city
  const w = whenParts(ev.start_datetime, ev.timezone)

  const lead = lang === 'fr' ? 'Affiche de ' : lang === 'ht' ? 'Afich pou ' : 'Flyer for '
  let s = lead + (title || (lang === 'fr' ? 'un événement' : lang === 'ht' ? 'yon evènman' : 'an event'))
  if (w) s += `, ${whenText(w, lang)}`
  if (where) s += lang === 'fr' ? ` à ${where}` : lang === 'ht' ? ` nan ${where}` : ` at ${where}`
  const price = priceText(ev, lang)
  return cleanPosterAlt(`${s}.${price ? ` ${price}` : ''}`)
}

/**
 * The alt text / accessibilityLabel for an event's poster: the organizer's own
 * description, else one built from the facts. '' only when there is no event.
 */
export function posterAltText(e: PosterAltEvent | null | undefined, language: unknown = 'en'): string {
  if (!e) return ''
  return cleanPosterAlt(e.poster_alt) || posterAltFromFacts(e, language)
}
