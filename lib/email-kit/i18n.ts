// Language, money and date formatting for transactional email.
//
// Every email is written in the three languages the app speaks. The recipient's
// language comes from their profile (`users/{uid}.language`); guests have none, so
// `fallbackLangForEvent` picks Kreyòl for events in Haiti and English elsewhere.

import { eventZone } from '@/lib/home/feed'

export type EmailLang = 'en' | 'fr' | 'ht'

export const EMAIL_LANGS: EmailLang[] = ['en', 'fr', 'ht']

export function normalizeLang(value: unknown): EmailLang | null {
  const v = String(value || '').trim().toLowerCase().slice(0, 2)
  if (v === 'en' || v === 'fr' || v === 'ht') return v
  // Haitian Creole is sometimes stored as "kr"/"cr" by older clients.
  if (v === 'kr' || v === 'cr') return 'ht'
  return null
}

/** Guests have no language setting: Kreyòl for events in Haiti, English elsewhere. */
export function fallbackLangForEvent(event?: { country?: unknown; city?: unknown; timezone?: unknown } | null): EmailLang {
  const country = String(event?.country || '').trim().toUpperCase()
  if (country === 'HT' || country === 'HAITI' || country === 'HAÏTI' || country === 'AYITI') return 'ht'
  if (!country && event && eventZone(event as any) === 'America/Port-au-Prince') return 'ht'
  return 'en'
}

export function pickLang(...candidates: unknown[]): EmailLang {
  for (const c of candidates) {
    const l = normalizeLang(c)
    if (l) return l
  }
  return 'en'
}

const INTL_LOCALE: Record<EmailLang, string> = { en: 'en-US', fr: 'fr-FR', ht: 'fr-HT' }

/** "1,500 HTG" / "30 USD". Whole amounts drop the decimals, as the app does. */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined, lang: EmailLang): string {
  const n = Number(amount || 0)
  const cur = String(currency || 'HTG').toUpperCase()
  const whole = Math.round(n) === n
  const num = new Intl.NumberFormat(INTL_LOCALE[lang] === 'fr-HT' ? 'fr-FR' : INTL_LOCALE[lang], {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n)
  return `${num} ${cur}`
}

const KREYOL_DAYS = ['Dimanch', 'Lendi', 'Madi', 'Mèkredi', 'Jedi', 'Vandredi', 'Samdi']
const KREYOL_DAYS_SHORT = ['Dim', 'Len', 'Mad', 'Mèk', 'Jed', 'Van', 'Sam']
const KREYOL_MONTHS = ['janvye', 'fevriye', 'mas', 'avril', 'me', 'jen', 'jiyè', 'out', 'septanm', 'oktòb', 'novanm', 'desanm']
const KREYOL_MONTHS_SHORT = ['jan', 'fev', 'mas', 'avr', 'me', 'jen', 'jiy', 'out', 'sep', 'okt', 'nov', 'des']

function partsIn(date: Date, zone: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  })
  const p: Record<string, string> = {}
  for (const part of f.formatToParts(date)) p[part.type] = part.value
  const weekdayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  const hour = Number(p.hour) % 24
  return { year: Number(p.year), month: Number(p.month) - 1, day: Number(p.day), weekday: weekdayIdx, hour, minute: Number(p.minute) }
}

function clock(hour: number, minute: number, lang: EmailLang): string {
  const mm = String(minute).padStart(2, '0')
  if (lang === 'fr') return `${hour}h${mm === '00' ? '' : mm}`.replace(/h$/, 'h')
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${mm} ${hour < 12 ? 'AM' : 'PM'}`
}

export interface EventWhen {
  /** "Sat 1 Nov" */
  short: string
  /** "Saturday, November 1, 2026" */
  long: string
  /** "7:00 PM" / "19h" */
  time: string
  /** "Sat 1 Nov · 7:00 PM" */
  line: string
}

/** Format an event instant in the EVENT's time zone, never the server's. */
export function formatEventWhen(
  iso: unknown,
  lang: EmailLang,
  event?: { timezone?: unknown; city?: unknown; country?: unknown } | null
): EventWhen | null {
  const date = iso ? new Date(String(iso)) : null
  if (!date || Number.isNaN(date.getTime())) return null
  const zone = eventZone(event || null)
  const p = partsIn(date, zone)
  const time = clock(p.hour, p.minute, lang)
  let short: string
  let long: string
  if (lang === 'ht') {
    short = `${KREYOL_DAYS_SHORT[p.weekday]} ${p.day} ${KREYOL_MONTHS_SHORT[p.month]}`
    long = `${KREYOL_DAYS[p.weekday]} ${p.day} ${KREYOL_MONTHS[p.month]} ${p.year}`
  } else {
    const loc = lang === 'fr' ? 'fr-FR' : 'en-GB'
    short = new Intl.DateTimeFormat(loc, { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' })
      .format(date)
      .replace(/\./g, '')
      .replace(',', '')
    long = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-US', {
      timeZone: zone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date)
    if (lang === 'fr') {
      short = short.charAt(0).toUpperCase() + short.slice(1)
      long = long.charAt(0).toUpperCase() + long.slice(1)
    }
  }
  return { short, long, time, line: `${short} · ${time}` }
}

/** Shared chrome strings: footer, wordmark alt, generic buttons. */
export const COMMON: Record<EmailLang, {
  discover: string
  myTickets: string
  help: string
  dashboard: string
  payouts: string
  privacy: string
  terms: string
  rights: string
  whyAttendee: string
  whyOrganizer: string
  whyAccount: string
  viewEvent: string
  findEvents: string
  reference: string
}> = {
  en: {
    discover: 'Discover',
    myTickets: 'My tickets',
    help: 'Help',
    dashboard: 'Dashboard',
    payouts: 'Payouts',
    privacy: 'Privacy',
    terms: 'Terms',
    rights: 'Tikèm',
    whyAttendee: 'You are receiving this because you have a ticket on Tikèm.',
    whyOrganizer: 'You are receiving this because you organize events on Tikèm.',
    whyAccount: 'You are receiving this because of activity on your Tikèm account.',
    viewEvent: 'View the event',
    findEvents: 'Find another event',
    reference: 'Reference',
  },
  fr: {
    discover: 'Découvrir',
    myTickets: 'Mes billets',
    help: 'Aide',
    dashboard: 'Tableau de bord',
    payouts: 'Paiements',
    privacy: 'Confidentialité',
    terms: 'Conditions',
    rights: 'Tikèm',
    whyAttendee: 'Vous recevez cet e-mail parce que vous avez un billet sur Tikèm.',
    whyOrganizer: 'Vous recevez cet e-mail parce que vous organisez des événements sur Tikèm.',
    whyAccount: 'Vous recevez cet e-mail suite à une activité sur votre compte Tikèm.',
    viewEvent: "Voir l'événement",
    findEvents: 'Trouver un autre événement',
    reference: 'Référence',
  },
  ht: {
    discover: 'Dekouvri',
    myTickets: 'Tikè m',
    help: 'Èd',
    dashboard: 'Tablo',
    payouts: 'Peman',
    privacy: 'Konfidansyalite',
    terms: 'Kondisyon',
    rights: 'Tikèm',
    whyAttendee: 'Ou resevwa imèl sa a paske ou gen yon tikè sou Tikèm.',
    whyOrganizer: 'Ou resevwa imèl sa a paske ou òganize evènman sou Tikèm.',
    whyAccount: 'Ou resevwa imèl sa a akoz yon aktivite sou kont Tikèm ou.',
    viewEvent: 'Wè evènman an',
    findEvents: 'Jwenn yon lòt evènman',
    reference: 'Referans',
  },
}
