/**
 * Occasions: the Haitian and diaspora seasons an event can belong to
 * (Kanaval, Rara, Fèt Manman, Fèt Gede, Nwèl…). An organizer tags an event
 * with one (`occasion` on the event doc); each occasion has a page
 * (/occasions/<key> on the web, OccasionScreen in the app), and Home shows a
 * compact row while one is near and has events.
 *
 * Not the same thing as lib/nationalDays: a national day is a holiday Tikèm
 * themes itself for (banner, push, art), a few days a year. An occasion is a
 * season people plan events around, sometimes weeks long (Rara runs through
 * Lent), sometimes diaspora-only (Haitian Heritage Month). Where the two meet
 * (Kanaval, 1 January, Flag Day, Vertières, Christmas) the occasion names the
 * national day, and an event tagged for that day counts as tagged for the
 * occasion too.
 *
 * MIRRORED FILE. lib/occasions.ts (web) and mobile/lib/occasions.ts are
 * byte-identical copies, and __tests__/occasions.test.ts fails the build when
 * they drift. Edit one, copy it over the other. Pure: its one import is the
 * other mirrored file, so both apps can run it as is.
 *
 * Every date is a calendar day in Haiti (America/Port-au-Prince) unless a
 * caller passes another zone.
 */

import { calendarDay, easterSunday, NATIONAL_DAY_TIME_ZONE } from './nationalDays'

export type OccasionLang = 'en' | 'fr' | 'ht'
export type OccasionText = Record<OccasionLang, string>
export type IsoDay = string

export type OccasionKey =
  | 'kanaval'
  | 'rara'
  | 'fet-endepandans'
  | 'fet-drapo'
  | 'fet-manman'
  | 'fet-papa'
  | 'fet-gede'
  | 'vertieres'
  | 'nwel'
  | 'fen-ane'
  | 'heritage-month'
  | 'fet-chanpet'

/** lucide icon names (lucide-react on the web, lucide-react-native in the app). */
export type OccasionIcon =
  | 'Drama'
  | 'Drum'
  | 'Soup'
  | 'Flag'
  | 'Heart'
  | 'HeartHandshake'
  | 'Flame'
  | 'Landmark'
  | 'Gift'
  | 'PartyPopper'
  | 'Globe'
  | 'Sun'

/**
 * How an occasion's dates are found for a year. `main` is the part people
 * mean by the name (Kanaval's three fat days); `start`/`end` can reach wider
 * (the pre-kanaval Sundays from January).
 */
type OccasionRule =
  | { kind: 'fixed'; from: [number, number]; to: [number, number] }
  | { kind: 'kanaval' }
  | { kind: 'rara' }
  | { kind: 'last-sunday'; month: number }

export interface Occasion {
  key: OccasionKey
  name: OccasionText
  /** One line for the page, under the dates. */
  blurb: OccasionText
  icon: OccasionIcon
  /**
   * The app's photo (a mobile/lib/photoLibrary key, or a WORLD_PHOTOS key).
   * Real photographs only; credits are in lib/photoCredits under the same key.
   */
  photo: string
  /** The same picture on the website (public/). */
  webPhoto: string
  /** The national day (lib/nationalDays eventTag) whose tagged events count here too. */
  nationalDay?: string
  rule: OccasionRule
}

// prettier-ignore
export const OCCASIONS: Occasion[] = [
  {
    key: 'kanaval', icon: 'Drama', rule: { kind: 'kanaval' }, nationalDay: 'kanaval',
    photo: 'photo-kilti-parade', webPhoto: '/art/national-days/photos/kanaval.jpg',
    name: { en: 'Kanaval', fr: 'Carnaval', ht: 'Kanaval' },
    blurb: {
      en: 'Dimanch gra, lendi gra, madi gra, and the pre-kanaval Sundays before them.',
      fr: 'Dimanche, lundi et mardi gras, et les dimanches pré-carnaval avant eux.',
      ht: 'Dimanch gra, lendi gra, madi gra, ak dimanch pre-kanaval yo anvan.',
    },
  },
  {
    key: 'rara', icon: 'Drum', rule: { kind: 'rara' },
    photo: 'photo-kilti-drum', webPhoto: '/art/occasions/rara.jpg',
    name: { en: 'Rara', fr: 'Rara', ht: 'Rara' },
    blurb: {
      en: 'Rara bands on the road through Lent, loudest on Easter weekend.',
      fr: 'Les bandes rara dans les rues pendant le Carême, jusqu’au week-end de Pâques.',
      ht: 'Bann rara nan lari pandan Karèm nan, jis wikenn Pak.',
    },
  },
  {
    key: 'fet-endepandans', icon: 'Soup', rule: { kind: 'fixed', from: [1, 1], to: [1, 2] }, nationalDay: 'independence',
    photo: 'photo-mizik-flag', webPhoto: '/art/national-days/photos/independence.jpg',
    name: { en: 'Independence Day', fr: 'Fête de l’Indépendance', ht: 'Fèt Endepandans' },
    blurb: {
      en: 'Jou de lan: 1 January 1804, and a bowl of soup joumou.',
      fr: 'Le jour de l’An : le 1er janvier 1804, et un bol de soupe joumou.',
      ht: 'Jou de lan: premye janvye 1804, ak yon bòl soup joumou.',
    },
  },
  {
    key: 'fet-drapo', icon: 'Flag', rule: { kind: 'fixed', from: [5, 18], to: [5, 18] }, nationalDay: 'flag',
    photo: 'photo-flag-crowd', webPhoto: '/art/national-days/photos/flag.jpg',
    name: { en: 'Flag Day', fr: 'Fête du Drapeau', ht: 'Fèt Drapo' },
    blurb: {
      en: 'The blue and red, first sewn at Arcahaie on 18 May 1803.',
      fr: 'Le bleu et rouge, cousu à l’Arcahaie le 18 mai 1803.',
      ht: 'Ble ak wouj la, ki te koud Lakayè 18 me 1803.',
    },
  },
  {
    key: 'fet-manman', icon: 'Heart', rule: { kind: 'last-sunday', month: 5 },
    photo: 'photo-fanmi', webPhoto: '/art/world-photos/fanmi.jpg',
    name: { en: 'Mother’s Day', fr: 'Fête des Mères', ht: 'Fèt Manman' },
    blurb: {
      en: 'The last Sunday of May in Haiti.',
      fr: 'Le dernier dimanche de mai en Haïti.',
      ht: 'Dènye dimanch mwa me ann Ayiti.',
    },
  },
  {
    key: 'fet-papa', icon: 'HeartHandshake', rule: { kind: 'last-sunday', month: 6 },
    photo: 'photo-fanmi-shoulders', webPhoto: '/art/occasions/fet-papa.jpg',
    name: { en: 'Father’s Day', fr: 'Fête des Pères', ht: 'Fèt Papa' },
    blurb: {
      en: 'The last Sunday of June in Haiti.',
      fr: 'Le dernier dimanche de juin en Haïti.',
      ht: 'Dènye dimanch mwa jen ann Ayiti.',
    },
  },
  {
    key: 'fet-gede', icon: 'Flame', rule: { kind: 'fixed', from: [11, 1], to: [11, 2] },
    photo: 'photo-kilti-drum', webPhoto: '/art/national-days/photos/morts.jpg',
    name: { en: 'Fèt Gede', fr: 'Fête des Guédés', ht: 'Fèt Gede' },
    blurb: {
      en: 'All Saints and the Day of the Dead, 1 and 2 November.',
      fr: 'La Toussaint et la fête des Morts, les 1er et 2 novembre.',
      ht: 'Latousen ak Jou Mò, 1 ak 2 novanm.',
    },
  },
  {
    key: 'vertieres', icon: 'Landmark', rule: { kind: 'fixed', from: [11, 18], to: [11, 18] }, nationalDay: 'vertieres',
    photo: 'photo-flag-crowd', webPhoto: '/art/national-days/photos/vertieres.jpg',
    name: { en: 'Vertières', fr: 'Vertières', ht: 'Vètyè' },
    blurb: {
      en: 'The battle of 18 November 1803 that led to independence.',
      fr: 'La bataille du 18 novembre 1803 qui a mené à l’indépendance.',
      ht: 'Batay 18 novanm 1803 la ki mennen nou nan endepandans.',
    },
  },
  {
    key: 'nwel', icon: 'Gift', rule: { kind: 'fixed', from: [12, 24], to: [12, 25] }, nationalDay: 'noel',
    photo: 'photo-nwel', webPhoto: '/art/national-days/photos/noel.jpg',
    name: { en: 'Christmas', fr: 'Noël', ht: 'Nwèl' },
    blurb: {
      en: 'Réveillon on the 24th, family on the 25th.',
      fr: 'Le réveillon le 24, la famille le 25.',
      ht: 'Revèyon 24 an, fanmi 25 an.',
    },
  },
  {
    key: 'fen-ane', icon: 'PartyPopper', rule: { kind: 'fixed', from: [12, 31], to: [12, 31] },
    photo: 'photo-lavi-confetti', webPhoto: '/art/occasions/fen-ane.jpg',
    name: { en: 'New Year’s Eve', fr: 'Réveillon du Nouvel An', ht: 'Fen ane' },
    blurb: {
      en: 'The last night of the year, until the soup joumou in the morning.',
      fr: 'La dernière nuit de l’année, jusqu’à la soupe joumou du matin.',
      ht: 'Dènye nwit ane a, jis soup joumou nan maten.',
    },
  },
  {
    key: 'heritage-month', icon: 'Globe', rule: { kind: 'fixed', from: [5, 1], to: [5, 31] },
    photo: 'photo-lavi-friends', webPhoto: '/art/occasions/heritage-month.jpg',
    name: { en: 'Haitian Heritage Month', fr: 'Mois du patrimoine haïtien', ht: 'Mwa Eritaj Ayisyen' },
    blurb: {
      en: 'May in the diaspora: Miami, New York, Boston, Montréal.',
      fr: 'Le mois de mai dans la diaspora : Miami, New York, Boston, Montréal.',
      ht: 'Mwa me nan dyaspora a: Miami, Nouyòk, Boston, Monreyal.',
    },
  },
  {
    key: 'fet-chanpet', icon: 'Sun', rule: { kind: 'fixed', from: [7, 1], to: [8, 31] },
    photo: 'photo-kilti-dancers', webPhoto: '/art/occasions/fet-chanpet.jpg',
    name: { en: 'Fèt chanpèt season', fr: 'Saison des fêtes champêtres', ht: 'Sezon fèt chanpèt' },
    blurb: {
      en: 'Summer patron saint festivals, from Saut-d’Eau to Plaine-du-Nord.',
      fr: 'Les fêtes patronales de l’été, de Saut-d’Eau à Plaine-du-Nord.',
      ht: 'Fèt patwonal ete yo, depi Sodo rive Plenndinò.',
    },
  },
]

export const OCCASION_KEYS: OccasionKey[] = OCCASIONS.map((o) => o.key)

const BY_KEY = new Map<string, Occasion>(OCCASIONS.map((o) => [o.key, o]))

/** The key when `raw` is a known occasion, else null. The allow-list every writer and reader goes through. */
export function parseOccasion(raw: unknown): OccasionKey | null {
  return typeof raw === 'string' && BY_KEY.has(raw) ? (raw as OccasionKey) : null
}

export function occasionByKey(key: string | null | undefined): Occasion | null {
  return (key && BY_KEY.get(key)) || null
}

function langOf(lang: string | null | undefined): OccasionLang {
  const l = String(lang || '').slice(0, 2)
  return l === 'fr' || l === 'ht' ? l : 'en'
}

export function occasionName(key: OccasionKey, lang?: string | null): string {
  return BY_KEY.get(key)!.name[langOf(lang)]
}

export function occasionBlurb(key: OccasionKey, lang?: string | null): string {
  return BY_KEY.get(key)!.blurb[langOf(lang)]
}

/* -------------------------------------------------------------------------- */
/*  Dates                                                                      */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86400000

function dayNum(iso: IsoDay): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)
}

function isoOf(n: number): IsoDay {
  return new Date(n * DAY_MS).toISOString().slice(0, 10)
}

function ymd(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)
}

/** 0 = Sunday. */
function weekday(n: number): number {
  return new Date(n * DAY_MS).getUTCDay()
}

export interface OccasionRange {
  /** First and last day it covers (inclusive). */
  start: IsoDay
  end: IsoDay
  /** The days the name really means (Kanaval: Sunday to Mardi Gras). Inside start..end. */
  mainStart: IsoDay
  mainEnd: IsoDay
}

/** The occasion's dates in a given year. */
export function occasionRange(key: OccasionKey, year: number): OccasionRange {
  const rule = BY_KEY.get(key)!.rule
  let start: number
  let end: number
  let mainStart: number
  let mainEnd: number
  if (rule.kind === 'fixed') {
    start = mainStart = ymd(year, rule.from[0], rule.from[1])
    end = mainEnd = ymd(year, rule.to[0], rule.to[1])
  } else if (rule.kind === 'kanaval') {
    // Dimanch gra (Easter - 49) to madi gra (Easter - 47), the eve of Ash
    // Wednesday. The pre-kanaval Sundays start after the Epiphany: the first
    // Sunday on or after 6 January.
    const easter = dayNum(easterSunday(year))
    mainStart = easter - 49
    mainEnd = end = easter - 47
    const epiphany = ymd(year, 1, 6)
    start = epiphany + ((7 - weekday(epiphany)) % 7)
  } else if (rule.kind === 'rara') {
    // Ash Wednesday (Easter - 46) to Easter Sunday.
    const easter = dayNum(easterSunday(year))
    start = mainStart = easter - 46
    end = mainEnd = easter
  } else {
    // The last Sunday of the month, with the Friday and Saturday before it
    // (the brunches and concerts land on the weekend).
    const last = ymd(year, rule.month + 1, 0)
    mainStart = mainEnd = last - weekday(last)
    start = mainStart - 2
    end = mainEnd
  }
  return { start: isoOf(start), end: isoOf(end), mainStart: isoOf(mainStart), mainEnd: isoOf(mainEnd) }
}

/** Today in `timeZone` as YYYY-MM-DD. */
export function occasionToday(now: Date | number | IsoDay = Date.now(), timeZone: string = NATIONAL_DAY_TIME_ZONE): IsoDay {
  return calendarDay(typeof now === 'number' ? new Date(now) : now, timeZone)
}

/** The occurrence under way on `now`, else the next one. */
export function occasionWindow(
  key: OccasionKey,
  now: Date | number | IsoDay = Date.now(),
  timeZone: string = NATIONAL_DAY_TIME_ZONE
): OccasionRange {
  const today = occasionToday(now, timeZone)
  const year = Number(today.slice(0, 4))
  for (const y of [year - 1, year, year + 1]) {
    const r = occasionRange(key, y)
    if (r.end >= today) return r
  }
  return occasionRange(key, year + 1)
}

/** Whole days from today until the window starts (0 or less = under way). */
export function occasionDaysUntil(range: OccasionRange, now: Date | number | IsoDay = Date.now(), timeZone?: string): number {
  return dayNum(range.start) - dayNum(occasionToday(now, timeZone))
}

/** Every occasion whose window holds this day, most specific (shortest) first. */
export function occasionsOn(date: Date | IsoDay | null | undefined, timeZone?: string): OccasionKey[] {
  if (!date) return []
  if (date instanceof Date && Number.isNaN(date.getTime())) return []
  const iso = calendarDay(date, timeZone)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return []
  const year = Number(iso.slice(0, 4))
  const hits: { key: OccasionKey; len: number; order: number }[] = []
  OCCASIONS.forEach((o, order) => {
    const r = occasionRange(o.key, year)
    if (iso >= r.start && iso <= r.end) hits.push({ key: o.key, len: dayNum(r.end) - dayNum(r.start), order })
  })
  return hits.sort((a, b) => a.len - b.len || a.order - b.order).map((h) => h.key)
}

/** The occasion the composers suggest for an event starting on this day, or null. */
export function suggestOccasion(date: Date | IsoDay | null | undefined, timeZone?: string): OccasionKey | null {
  return occasionsOn(date, timeZone)[0] ?? null
}

/* -------------------------------------------------------------------------- */
/*  Events                                                                     */
/* -------------------------------------------------------------------------- */

interface EventLike {
  occasion?: unknown
  national_day?: unknown
  start_datetime?: unknown
}

/** Tagged for this occasion: its own `occasion` field, or the national day it names. */
export function eventTaggedFor(event: EventLike | null | undefined, key: OccasionKey): boolean {
  if (!event) return false
  if (event.occasion === key) return true
  const nd = BY_KEY.get(key)?.nationalDay
  return !!nd && event.national_day === nd
}

function startDay(event: EventLike, timeZone?: string): IsoDay | null {
  const s = event.start_datetime as any
  const d = s?.toDate ? s.toDate() : typeof s === 'string' || typeof s === 'number' ? new Date(s) : s instanceof Date ? s : null
  if (!d || Number.isNaN(d.getTime())) return null
  return calendarDay(d, timeZone)
}

/**
 * Untagged events also belong on the page when they fall on the occasion's
 * main days, but only for a short occasion (three days or fewer): every event
 * of the summer is not a fèt chanpèt.
 */
export function eventFallsIn(event: EventLike, range: OccasionRange, timeZone?: string): boolean {
  if (dayNum(range.mainEnd) - dayNum(range.mainStart) > 2) return false
  const day = startDay(event, timeZone)
  return !!day && day >= range.mainStart && day <= range.mainEnd
}

/** The page's events: tagged ones, then untagged ones on the main days; soonest first. */
export function occasionEvents<T extends EventLike>(events: T[], key: OccasionKey, range: OccasionRange, timeZone?: string): T[] {
  const tagged = events.filter((e) => eventTaggedFor(e, key))
  const inWindow = events.filter((e) => !eventTaggedFor(e, key) && eventFallsIn(e, range, timeZone))
  const t = (e: T) => {
    const s = e.start_datetime as any
    const d = s?.toDate ? s.toDate() : new Date(s)
    return Number.isNaN(d.getTime()) ? Infinity : d.getTime()
  }
  return [...tagged.sort((a, b) => t(a) - t(b)), ...inWindow.sort((a, b) => t(a) - t(b))]
}

/** Home shows the row from this many days before an occasion starts. */
export const HOME_OCCASION_LEAD_DAYS = 30
/** ...and only with at least this many tagged events. */
export const HOME_OCCASION_MIN_EVENTS = 2

export interface HomeOccasion<T> {
  key: OccasionKey
  range: OccasionRange
  events: T[]
}

/**
 * The occasion Home features: under way or starting within 30 days, with at
 * least two tagged events; the soonest such occasion wins. `skip` leaves one
 * out (the national day whose own rail is already showing). Null when none.
 */
export function homeOccasion<T extends EventLike>(
  events: T[],
  now: Date | number | IsoDay = Date.now(),
  options: { timeZone?: string; skipNationalDay?: string | null; max?: number } = {}
): HomeOccasion<T> | null {
  const candidates = OCCASIONS.map((o) => ({ o, range: occasionWindow(o.key, now, options.timeZone) }))
    .filter(({ range }) => occasionDaysUntil(range, now, options.timeZone) <= HOME_OCCASION_LEAD_DAYS)
    .filter(({ o }) => !(options.skipNationalDay && o.nationalDay === options.skipNationalDay))
    .sort((a, b) => a.range.start.localeCompare(b.range.start))
  for (const { o, range } of candidates) {
    const tagged = occasionEvents(events.filter((e) => eventTaggedFor(e, o.key)), o.key, range, options.timeZone)
    if (tagged.length >= HOME_OCCASION_MIN_EVENTS) {
      return { key: o.key, range, events: tagged.slice(0, options.max ?? 12) }
    }
  }
  return null
}

/* -------------------------------------------------------------------------- */
/*  Ideas                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A few event ideas per occasion, shown on its page to organizers. Picking
 * one opens Create Event with the title, a line of description, the category,
 * the occasion and a date inside it filled in. Few and plain on purpose.
 */
export interface OccasionIdea {
  id: string
  occasion: OccasionKey
  title: OccasionText
  description: OccasionText
  /** The web composer's category (lib/filters/config CATEGORIES). */
  category: string
  /** The app composer's category (its CATEGORIES list). */
  appCategory: string
  /** Days after the occasion's main first day (negative = before it). */
  day: number
  /** Start time, 24h. */
  time: string
  /**
   * The holiday poster template (lib/holidayTemplates id) Create Event opens
   * with already applied, photo and all. Optional: an idea without one opens
   * with no poster. __tests__/holidayTemplates.test.ts checks each one exists
   * and belongs to the same occasion.
   */
  poster?: string
}

// prettier-ignore
export const OCCASION_IDEAS: OccasionIdea[] = [
  { id: 'kanaval-bal', occasion: 'kanaval', category: 'Party', appCategory: 'Music', day: -7, time: '21:00', poster: 'kan-bal',
    title: { en: 'Pre-kanaval bal', fr: 'Bal pré-carnaval', ht: 'Bal pre-kanaval' },
    description: { en: 'A night of konpa and kanaval meringues before the fat days.', fr: 'Une soirée konpa et méringues de carnaval avant les jours gras.', ht: 'Yon swa konpa ak mereng kanaval anvan jou gra yo.' } },
  { id: 'kanaval-mask', occasion: 'kanaval', category: 'Workshop', appCategory: 'Arts', day: -14, time: '10:00', poster: 'kan-atelye-mask',
    title: { en: 'Kanaval mask workshop', fr: 'Atelier de masques de carnaval', ht: 'Atelye mask kanaval' },
    description: { en: 'Papier-mâché masks in the Jacmel style, for kids and parents.', fr: 'Des masques en papier mâché façon Jacmel, pour les enfants et les parents.', ht: 'Mask papye mache tankou Jakmèl, pou timoun ak paran.' } },
  { id: 'rara-night', occasion: 'rara', category: 'Festival', appCategory: 'Music', day: 44, time: '17:00', poster: 'rar-lari',
    title: { en: 'Rara on the road', fr: 'Rara dans la rue', ht: 'Rara nan lari' },
    description: { en: 'Vaksen, drums and a band to follow through the streets.', fr: 'Vaksens, tambours et une bande à suivre dans les rues.', ht: 'Vaksen, tanbou ak yon bann pou suiv nan lari.' } },
  { id: 'soup-joumou', occasion: 'fet-endepandans', category: 'Food & Drink', appCategory: 'Food & Drink', day: 0, time: '09:00', poster: 'end-soup-maten',
    title: { en: 'Soup joumou morning', fr: 'Matinée soupe joumou', ht: 'Maten soup joumou' },
    description: { en: 'Soup joumou for everyone on the first of January.', fr: 'De la soupe joumou pour tout le monde le 1er janvier.', ht: 'Soup joumou pou tout moun premye janvye.' } },
  { id: 'drapo-konse', occasion: 'fet-drapo', category: 'Concert', appCategory: 'Music', day: 0, time: '19:00', poster: 'drp-bal',
    title: { en: 'Fèt Drapo concert', fr: 'Concert de la Fête du Drapeau', ht: 'Konsè Fèt Drapo' },
    description: { en: 'Blue and red on stage for the 18th of May.', fr: 'Le bleu et rouge sur scène pour le 18 mai.', ht: 'Ble ak wouj sou sèn pou 18 me.' } },
  { id: 'manman-brunch', occasion: 'fet-manman', category: 'Food & Drink', appCategory: 'Food & Drink', day: 0, time: '11:00', poster: 'man-brunch',
    title: { en: 'Fèt Manman brunch', fr: 'Brunch de la Fête des Mères', ht: 'Brunch Fèt Manman' },
    description: { en: 'A table for the mothers, with music and flowers.', fr: 'Une table pour les mamans, avec musique et fleurs.', ht: 'Yon tab pou manman yo, ak mizik ak flè.' } },
  { id: 'papa-domino', occasion: 'fet-papa', category: 'Food & Drink', appCategory: 'Food & Drink', day: 0, time: '14:00', poster: 'pap-babekyou',
    title: { en: 'Fèt Papa grill and dominoes', fr: 'Grillades et dominos pour la Fête des Pères', ht: 'Fèt Papa: babekyou ak domino' },
    description: { en: 'An afternoon for the fathers: grill, dominoes and konpa.', fr: 'Un après-midi pour les papas : grillades, dominos et konpa.', ht: 'Yon apremidi pou papa yo: babekyou, domino ak konpa.' } },
  { id: 'vertieres-talk', occasion: 'vertieres', category: 'Conference', appCategory: 'Education', day: 0, time: '18:00', poster: 'ver-istwa',
    title: { en: 'Vertières, 1803: a history evening', fr: 'Vertières, 1803 : soirée d’histoire', ht: 'Vètyè 1803: yon swa istwa' },
    description: { en: 'The battle that led to 1804, told by a historian.', fr: 'La bataille qui a mené à 1804, racontée par un historien.', ht: 'Batay ki mennen nou nan 1804, yon istoryen ap rakonte l.' } },
  { id: 'nwel-reveyon', occasion: 'nwel', category: 'Food & Drink', appCategory: 'Food & Drink', day: 0, time: '20:00', poster: 'nwel-reveyon',
    title: { en: 'Christmas Eve réveillon', fr: 'Réveillon de Noël', ht: 'Revèyon Nwèl' },
    description: { en: 'Dinner and music on the night of the 24th.', fr: 'Dîner et musique le soir du 24.', ht: 'Manje ak mizik nan swa 24 la.' } },
  { id: 'fen-ane-bal', occasion: 'fen-ane', category: 'Party', appCategory: 'Music', day: 0, time: '21:00', poster: 'fen-bal',
    title: { en: 'New Year’s Eve bal', fr: 'Bal du réveillon', ht: 'Bal fen ane' },
    description: { en: 'Dance into the new year, soup joumou at dawn.', fr: 'Danser jusqu’à la nouvelle année, soupe joumou à l’aube.', ht: 'Danse rive nan nouvo ane a, soup joumou granmaten.' } },
  { id: 'heritage-fest', occasion: 'heritage-month', category: 'Festival', appCategory: 'Community', day: 16, time: '13:00', poster: 'her-danse',
    title: { en: 'Heritage Month block party', fr: 'Fête de quartier du Mois du patrimoine', ht: 'Fèt katye Mwa Eritaj' },
    description: { en: 'Food, flags, konpa and kids’ games for Haitian Heritage Month.', fr: 'Cuisine, drapeaux, konpa et jeux d’enfants pour le Mois du patrimoine haïtien.', ht: 'Manje, drapo, konpa ak jwèt timoun pou Mwa Eritaj Ayisyen.' } },
  { id: 'chanpet-lakou', occasion: 'fet-chanpet', category: 'Festival', appCategory: 'Community', day: 14, time: '15:00', poster: 'cha-fet',
    title: { en: 'Fèt chanpèt in the lakou', fr: 'Fête champêtre au lakou', ht: 'Fèt chanpèt nan lakou a' },
    description: { en: 'A patron saint’s day with food stalls, music and games.', fr: 'Une fête patronale avec stands de cuisine, musique et jeux.', ht: 'Yon fèt patwonal ak machann manje, mizik ak jwèt.' } },
]

export function occasionIdeas(key: OccasionKey): OccasionIdea[] {
  return OCCASION_IDEAS.filter((i) => i.occasion === key)
}

export function ideaById(id: string | null | undefined): OccasionIdea | null {
  return (id && OCCASION_IDEAS.find((i) => i.id === id)) || null
}

export function ideaText(idea: OccasionIdea, lang?: string | null): { title: string; description: string } {
  const l = langOf(lang)
  return { title: idea.title[l], description: idea.description[l] }
}

/**
 * The start day an idea suggests: the upcoming occurrence's main first day
 * plus the idea's offset, moved to the next occurrence when that is already
 * past. YYYY-MM-DD.
 */
export function ideaDate(idea: OccasionIdea, now: Date | number | IsoDay = Date.now(), timeZone?: string): IsoDay {
  const today = occasionToday(now, timeZone)
  const range = occasionWindow(idea.occasion, now, timeZone)
  let day = isoOf(dayNum(range.mainStart) + idea.day)
  if (day < today) {
    const next = occasionRange(idea.occasion, Number(range.mainStart.slice(0, 4)) + 1)
    day = isoOf(dayNum(next.mainStart) + idea.day)
  }
  return day
}

/* -------------------------------------------------------------------------- */
/*  Seasons (holiday poster templates)                                         */
/* -------------------------------------------------------------------------- */

/**
 * The occasion whose holiday posters (lib/holidayTemplates) a poster picker
 * shows first: the one the event is tagged for, else the first occasion its
 * start day falls in (most specific first). Only occasions in `withPosters`
 * count, so a date in an occasion with no templates yet shows no row. Null
 * when none applies.
 */
export function posterOccasion(
  tagged: unknown,
  date: Date | IsoDay | null | undefined,
  withPosters: readonly string[],
  timeZone?: string
): OccasionKey | null {
  const has = new Set(withPosters)
  const own = parseOccasion(tagged)
  if (own && has.has(own)) return own
  return occasionsOn(date, timeZone).find((k) => has.has(k)) ?? null
}

/** An occasion is "in season" from this many days before it starts until it ends. */
export const SEASON_LEAD_DAYS = 30

/**
 * The occasions in season on `now`: under way, or starting within
 * SEASON_LEAD_DAYS. Soonest first (an under-way one before one still to
 * come). Pure: pass `now` to test it.
 */
export function occasionsInSeason(
  now: Date | number | IsoDay = Date.now(),
  keys: readonly OccasionKey[] = OCCASION_KEYS,
  options: { leadDays?: number; timeZone?: string } = {}
): OccasionKey[] {
  const lead = options.leadDays ?? SEASON_LEAD_DAYS
  return keys
    .map((k) => ({ k, r: occasionWindow(k, now, options.timeZone) }))
    .filter(({ r }) => occasionDaysUntil(r, now, options.timeZone) <= lead)
    .sort((a, b) => a.r.start.localeCompare(b.r.start) || a.r.end.localeCompare(b.r.end))
    .map(({ k }) => k)
}
