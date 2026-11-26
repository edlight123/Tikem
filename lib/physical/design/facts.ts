/**
 * The words printed on a ticket, per language, and the event facts in the
 * form the templates draw them ("SAM 21 JUIN", "8:00 PM", "7 000 HTG").
 *
 * A Haiti event's ticket is FRENCH with the 12-hour clock (owner,
 * 2026-11-25; lib/datetime/eventClock). Gourde prices carry no decimals.
 *
 * Pure: no Firebase, no fs.
 */

import { formatEventDateTime, isHaitiEvent } from '@/lib/datetime/eventClock'
import { normalizeCurrency } from '@/lib/money'
import type { DesignOverrides, Lang } from './registry'

export interface TicketLabels {
  admit: string
  numberSign: string
  category: string
  price: string
  date: string
  time: string
  presentedBy: string
  stubValid: string
  stub: string
  validOnceSold: string
  holder: string
  keep: string
  free: string
  tearHere: string
  howTitle: string
  steps: [string, string, string]
  finePrint: string
  support: string
  secure: string
  specimen: string
  duplexNote: string
  span: (a: string, b: string) => string
  page: (n: number, of: number) => string
}

export const TICKET_LABELS: Record<Lang, TicketLabels> = {
  en: {
    admit: 'ADMIT ONE',
    numberSign: 'No.',
    category: 'TIER',
    price: 'PRICE',
    date: 'DATE',
    time: 'TIME',
    presentedBy: 'PRESENTED BY',
    stubValid: 'STUB · VALID ONCE SOLD',
    stub: 'STUB',
    validOnceSold: 'Valid only once sold',
    holder: 'HOLDER',
    keep: 'Keep this stub',
    free: 'FREE',
    tearHere: 'Tear off at the door',
    howTitle: 'How this ticket works',
    steps: [
      'The seller scans it and writes your name. From then on it is valid.',
      'Show it at the door. It scans only once.',
      'Lost it? Give the organizer the number on your stub.',
    ],
    finePrint: 'One entry per ticket. Copies do not get in. A ticket never sold is not valid.',
    support: 'tikem.co/support',
    secure: 'TIKEM·SECURE',
    specimen: 'SPECIMEN · PROOF',
    duplexNote: 'Backs: print two-sided, flip on the short edge',
    span: (a, b) => `${a} to ${b}`,
    page: (n, of) => `page ${n} of ${of}`,
  },
  fr: {
    admit: 'ENTRÉE',
    numberSign: 'Nº',
    category: 'CATÉGORIE',
    price: 'PRIX',
    date: 'DATE',
    time: 'HEURE',
    presentedBy: 'PRÉSENTÉ PAR',
    stubValid: 'TALON · VALIDE UNE FOIS VENDU',
    stub: 'TALON',
    validOnceSold: 'Valide une fois vendu',
    holder: 'TITULAIRE',
    keep: 'À conserver',
    free: 'GRATUIT',
    tearHere: 'Détachez à l’entrée',
    howTitle: 'Comment fonctionne ce billet',
    steps: [
      'Le vendeur le scanne et inscrit votre nom. Dès lors, il est valide.',
      'Présentez-le à l’entrée. Il ne se scanne qu’une fois.',
      'Perdu ? Donnez à l’organisateur le numéro inscrit sur votre talon.',
    ],
    finePrint: 'Une entrée par billet. Les copies ne passent pas. Un billet jamais vendu n’est pas valide.',
    support: 'tikem.co/support',
    secure: 'TIKEM·SECURE',
    specimen: 'SPÉCIMEN · BON À TIRER',
    duplexNote: 'Versos : recto verso, retourner sur le bord court',
    span: (a, b) => `${a} à ${b}`,
    page: (n, of) => `page ${n} sur ${of}`,
  },
  ht: {
    admit: 'ANTRE',
    numberSign: 'Nº',
    category: 'KATEGORI',
    price: 'PRI',
    date: 'DAT',
    time: 'LÈ',
    presentedBy: 'PREZANTE PA',
    stubValid: 'SOUCH · VALAB LÈ L VANN',
    stub: 'SOUCH',
    validOnceSold: 'Valab sèlman lè l vann',
    holder: 'MÈT BIYÈ A',
    keep: 'Kenbe souch sa a',
    free: 'GRATIS',
    tearHere: 'Dechire l nan pòt la',
    howTitle: 'Kijan biyè sa a mache',
    steps: [
      'Machann nan eskane l epi li ekri non w. Apati lè sa a, li valab.',
      'Montre l nan pòt la. Li eskane yon sèl fwa.',
      'Ou pèdi l? Bay òganizatè a nimewo ki sou souch ou a.',
    ],
    finePrint: 'Yon antre pou chak biyè. Kopi pa pase. Yon biyè ki pa t janm vann pa valab.',
    support: 'tikem.co/support',
    secure: 'TIKEM·SECURE',
    specimen: 'ESPESIMEN · PWÒV',
    duplexNote: 'Do: enprime de bò, vire sou bò kout la',
    span: (a, b) => `${a} rive ${b}`,
    page: (n, of) => `paj ${n} sou ${of}`,
  },
}

/** Intl's narrow / no-break spaces are not in every ticket font: plain spaces only. */
export function plainSpaces(s: string): string {
  return String(s ?? '').replace(/[\u00a0\u202f\u2007\u2009]/g, ' ')
}

/** "7 000 HTG" (fr/ht) or "7,000 HTG" (en); HTG never shows decimals when whole. */
export function ticketPrice(amount: number, currency: string | null | undefined, lang: Lang): string {
  const code = normalizeCurrency(currency || 'HTG')
  const value = Number.isFinite(amount) ? amount : 0
  const whole = Math.abs(value - Math.round(value)) < 1e-9
  const decimals = whole ? 0 : 2
  const n = value.toLocaleString(lang === 'en' ? 'en-US' : 'fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  const grouped = plainSpaces(n)
  if (lang === 'en') {
    if (code === 'USD') return `$${grouped}`
    if (code === 'EUR') return `€${grouped}`
  }
  return `${grouped} ${code}`
}

export interface TicketFacts {
  lang: Lang
  title: string
  /** "Sam 21 juin" / "Sat 21 June". */
  dayShort: string
  /** "samedi 21 juin 2026". */
  dateLong: string
  /** "21.06.26". */
  dateNumeric: string
  /** "8:00 PM" (Haiti) or the locale's clock. */
  time: string
  venueName: string
  /** "Champ de Mars, Port-au-Prince". */
  venueLine: string
  priceLine: string
  phone: string
  tierName: string
  organizerName: string
}

export interface PrintedTicketInstance {
  serial: string
  qrPayload: string
  tierName?: string
}

function startOf(event: Record<string, any>): string | null {
  const s = event?.start_datetime
  if (!s) return null
  if (typeof s?.toDate === 'function') return s.toDate().toISOString()
  if (typeof s?._seconds === 'number') return new Date(s._seconds * 1000).toISOString()
  if (typeof s?.seconds === 'number') return new Date(s.seconds * 1000).toISOString()
  return String(s)
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** The ticket's language: French for Haiti, else what the caller asked for (default French). */
export function ticketLang(event: Record<string, any> | null | undefined, requested?: string | null): Lang {
  if (isHaitiEvent(event as any)) return 'fr'
  return requested === 'en' || requested === 'ht' ? requested : 'fr'
}

export function buildTicketFacts(params: {
  event: Record<string, any>
  tierName: string
  tierPrice: number
  currency?: string | null
  lang: Lang
  overrides?: DesignOverrides
  organizerName?: string | null
}): TicketFacts {
  const { event, lang } = params
  const haiti = isHaitiEvent(event as any)
  const start = startOf(event)
  const dateLang = haiti ? 'fr' : lang === 'ht' ? 'fr' : lang
  const part = (o: Intl.DateTimeFormatOptions, l: string = dateLang) => plainSpaces(start ? formatEventDateTime(start, event as any, l, o) : '')
  const weekday = part({ weekday: 'short' }).replace(/\.$/, '')
  const day = part({ day: 'numeric' })
  const month = part({ month: 'long' })
  const dayShort = start ? cap(dateLang === 'en' ? `${weekday} ${month} ${day}` : `${weekday} ${day} ${month}`) : ''
  const dateLong = part({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const dateNumeric = part({ day: '2-digit', month: '2-digit', year: '2-digit' }, 'fr').replace(/\//g, '.')
  const time = part({ hour: 'numeric', minute: '2-digit' }, haiti ? 'en' : dateLang)
  const venueName = plainSpaces(String(event?.venue_name || event?.venue || '')).trim()
  const venueLine = [venueName, event?.city].filter(Boolean).map((x) => plainSpaces(String(x)).trim()).join(', ')
  const o = params.overrides || {}
  const price = Number(params.tierPrice) || 0
  return {
    lang,
    title: plainSpaces(o.title || String(event?.title || '')).trim(),
    dayShort,
    dateLong,
    dateNumeric,
    time,
    venueName,
    venueLine,
    priceLine: plainSpaces(o.priceLine || (price > 0 ? ticketPrice(price, params.currency || event?.currency, lang) : TICKET_LABELS[lang].free)),
    phone: plainSpaces(o.phone || ''),
    tierName: plainSpaces(params.tierName || ''),
    organizerName: plainSpaces(String(params.organizerName || event?.organizer_name || '')).trim(),
  }
}

/** "0001" from "FETE-VIP-B1-0001". */
export function serialNumberPart(serial: string): string {
  const m = /(\d+)$/.exec(String(serial || ''))
  return m ? m[1] : String(serial || '')
}
