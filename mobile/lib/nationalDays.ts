/**
 * National days: the calendar of Haitian holidays Tikèm themes itself for.
 *
 * MIRRORED FILE. lib/nationalDays.ts (web) and mobile/lib/nationalDays.ts are
 * byte-identical copies, and __tests__/national-days.test.ts fails the build
 * when they drift. Edit one, copy it over the other. The module is pure (no
 * imports, no platform APIs beyond Intl) so both apps can run it as is.
 *
 * While a day is active the apps show a banner on Home, a rail of events the
 * organizers tagged for it, and the day's art on the big empty states. The
 * calendar below is the built-in truth; `config/national_days` in Firestore
 * can switch a day off, edit its copy or add movable dates without a release
 * (see NationalDayConfig).
 *
 * Every date is a calendar day in Haiti (America/Port-au-Prince), so a day
 * turns over at midnight in Port-au-Prince wherever the code runs.
 */

export type NationalDayLang = 'en' | 'fr' | 'ht'
export type Localized = Record<NationalDayLang, string>

/** A YYYY-MM-DD calendar day. */
export type IsoDay = string

export interface MovableRange {
  start: IsoDay
  end: IsoDay
}

export interface NationalDay {
  /** Stable id. Also the default eventTag. Never reuse one. */
  key: string
  /** Fixed days: month (1-12) and day of month. */
  month?: number
  day?: number
  /**
   * Movable days: a range per year, e.g. { 2027: { start: '2027-02-07', end:
   * '2027-02-09' } }. A year missing here falls back to `movableRule` when
   * there is one. Add years freely.
   */
  movable?: Record<number, MovableRange>
  /** How to compute a movable day for a year missing from `movable`. */
  movableRule?: 'kanaval' | 'easter'
  /** Days of theme before the day itself (0 = the day only). Default 3. */
  leadDays: number
  /**
   * The art library key made for this day. Optional: a day with no dedicated
   * art yet leaves it out and uses `fallbackArtKey`.
   */
  artKey?: string
  /** An existing piece that fits, used until dedicated art exists. */
  fallbackArtKey: string
  /** Short title, per language. */
  title: Localized
  /** One line, per language. */
  message: Localized
  /** The value an event's `national_day` field carries to join this day. */
  eventTag: string
  /**
   * Low-key days get the banner only: no "See events" pill and no rail unless
   * organizers actually tagged events for them.
   */
  lowKey?: boolean
  /** Optional accent for the banner CTA (Flag Day's blue). */
  accent?: string
}

export type NationalDayPhase = 'upcoming' | 'today'

export interface ActiveNationalDay {
  day: NationalDay
  phase: NationalDayPhase
  /** Whole days until the day starts (0 when phase is 'today'). */
  daysUntil: number
  /** The occurrence this activation belongs to. */
  start: IsoDay
  end: IsoDay
}

/**
 * The remote control doc, `config/national_days`. Every field is optional and
 * untrusted: bad values are ignored, never thrown on.
 */
export interface NationalDayConfig {
  /** Day keys to switch off. */
  disabled?: string[]
  /** Per-day field overrides (copy, leadDays, artKey, a moved date…). */
  overrides?: Record<string, Partial<Omit<NationalDay, 'key'>>>
  /** Extra or corrected movable ranges: { kanaval: { 2028: { start, end } } }. */
  movable?: Record<string, Record<string, MovableRange>>
}

export const NATIONAL_DAY_TIME_ZONE = 'America/Port-au-Prince'

/** Haiti's flag blue, for the Flag Day CTA. */
export const FLAG_BLUE = '#00209F'

// prettier-ignore
export const NATIONAL_DAYS: NationalDay[] = [
  {
    key: 'independence', month: 1, day: 1, leadDays: 3,
    artKey: 'dessalines', fallbackArtKey: 'dessalines', eventTag: 'independence',
    title: { ht: 'Jou Endepandans', fr: "Jour de l'Indépendance", en: 'Independence Day' },
    message: {
      ht: 'Bòn fèt endepandans! Yon bòl soup joumou pou tout moun.',
      fr: "Bonne fête de l'Indépendance ! Une soupe joumou pour tout le monde.",
      en: 'Happy Independence Day! A bowl of soup joumou for everyone.',
    },
  },
  {
    key: 'ancestors', month: 1, day: 2, leadDays: 3,
    artKey: 'dessalines', fallbackArtKey: 'dessalines', eventTag: 'ancestors',
    title: { ht: 'Jou Zansèt yo', fr: 'Jour des Aïeux', en: "Ancestors' Day" },
    message: {
      ht: 'Nou sonje zansèt yo ki te goumen pou 1804.',
      fr: 'Hommage aux aïeux qui se sont battus pour 1804.',
      en: 'Honoring the ancestors who fought for 1804.',
    },
  },
  {
    key: 'kanaval', leadDays: 3, movableRule: 'kanaval',
    // Carnival Sunday to Mardi Gras. 2027: Mardi Gras is Tuesday 9 February
    // (Ash Wednesday 10 Feb, Easter 28 Mar).
    movable: {
      2026: { start: '2026-02-15', end: '2026-02-17' },
      2027: { start: '2027-02-07', end: '2027-02-09' },
      2028: { start: '2028-02-27', end: '2028-02-29' },
      2029: { start: '2029-02-11', end: '2029-02-13' },
      2030: { start: '2030-03-03', end: '2030-03-05' },
    },
    artKey: 'kanaval', fallbackArtKey: 'kanaval', eventTag: 'kanaval',
    title: { ht: 'Kanaval', fr: 'Carnaval', en: 'Kanaval' },
    message: {
      ht: 'Mask yo deyò, mizik la cho. Bon kanaval!',
      fr: 'Les masques sont de sortie, la musique est chaude. Bon carnaval !',
      en: 'The masks are out and the music is hot. Bon kanaval!',
    },
  },
  {
    key: 'easter', leadDays: 3, movableRule: 'easter',
    // Good Friday (Vandredi Sen) to Easter Sunday (Pak). 2027: 26 to 28 March.
    movable: {
      2026: { start: '2026-04-03', end: '2026-04-05' },
      2027: { start: '2027-03-26', end: '2027-03-28' },
      2028: { start: '2028-04-14', end: '2028-04-16' },
      2029: { start: '2029-03-30', end: '2029-04-01' },
      2030: { start: '2030-04-19', end: '2030-04-21' },
    },
    fallbackArtKey: 'saintpierre', eventTag: 'easter',
    title: { ht: 'Pak', fr: 'Pâques', en: 'Easter' },
    message: {
      ht: 'Bòn fèt Pak pou tout fanmi an.',
      fr: 'Joyeuses Pâques à toute la famille.',
      en: 'Happy Easter to the whole family.',
    },
  },
  {
    key: 'toussaint', month: 4, day: 7, leadDays: 3,
    artKey: 'toussaint', fallbackArtKey: 'toussaint', eventTag: 'toussaint',
    title: { ht: 'Tousen Louvèti', fr: 'Toussaint Louverture', en: 'Toussaint Louverture' },
    message: {
      ht: 'Nou sonje Tousen Louvèti, premye nan Nwa yo.',
      fr: 'Hommage à Toussaint Louverture, le premier des Noirs.',
      en: 'Remembering Toussaint Louverture, who died on April 7, 1803.',
    },
  },
  {
    key: 'labour', month: 5, day: 1, leadDays: 0, lowKey: true,
    fallbackArtKey: 'mache', eventTag: 'labour',
    title: { ht: 'Fèt Travay', fr: 'Fête du Travail', en: 'Labor Day' },
    message: {
      ht: 'Bòn fèt agrikilti ak travay!',
      fr: "Bonne fête de l'Agriculture et du Travail !",
      en: 'Happy Agriculture and Labor Day!',
    },
  },
  {
    key: 'flag', month: 5, day: 18, leadDays: 3,
    artKey: 'catherineflon', fallbackArtKey: 'catherineflon', eventTag: 'flag', accent: FLAG_BLUE,
    title: { ht: 'Fèt Drapo', fr: 'Fête du Drapeau', en: 'Flag Day' },
    message: {
      ht: 'Bòn fèt drapo! Leve ble ak wouj la wo.',
      fr: 'Bonne fête du Drapeau ! Le bleu et rouge bien haut.',
      en: 'Happy Flag Day! Raise the blue and red high.',
    },
  },
  {
    key: 'assumption', month: 8, day: 15, leadDays: 0, lowKey: true,
    fallbackArtKey: 'saintpierre', eventTag: 'assumption',
    title: { ht: 'Fèt Nòt Dam', fr: "L'Assomption", en: 'Assumption Day' },
    message: {
      ht: 'Yon jou lafwa ak fanmi toupatou nan peyi a.',
      fr: 'Une journée de foi et de famille dans tout le pays.',
      en: 'A day of faith and family across Haiti.',
    },
  },
  {
    key: 'dessalines', month: 10, day: 17, leadDays: 3,
    artKey: 'dessalines', fallbackArtKey: 'dessalines', eventTag: 'dessalines',
    title: { ht: 'Jou Desalin', fr: 'Jour de Dessalines', en: 'Dessalines Day' },
    message: {
      ht: 'Nou sonje Jan-Jak Desalin, papa nasyon an.',
      fr: 'Hommage à Jean-Jacques Dessalines, père de la nation.',
      en: 'Remembering Jean-Jacques Dessalines, father of the nation.',
    },
  },
  {
    key: 'allsaints', month: 11, day: 1, leadDays: 2,
    fallbackArtKey: 'saintpierre', eventTag: 'allsaints',
    title: { ht: 'Fèt Tousen', fr: 'La Toussaint', en: "All Saints' Day" },
    message: {
      ht: 'Yon jou pou fanmi an reyini.',
      fr: 'Un jour pour se retrouver en famille.',
      en: 'A day for the family to come together.',
    },
  },
  {
    // A day of remembrance: candles and family, nothing festive, and no CTA
    // unless organizers tagged events (lowKey).
    key: 'morts', month: 11, day: 2, leadDays: 0, lowKey: true,
    fallbackArtKey: 'saintpierre', eventTag: 'morts',
    title: { ht: 'Jou Mò', fr: 'Fête des Morts', en: "All Souls' Day" },
    message: {
      ht: 'Yon bouji pou moun nou renmen ki pa la ankò.',
      fr: 'Une bougie pour ceux que nous aimons et qui ne sont plus là.',
      en: 'A candle for the loved ones who are no longer with us.',
    },
  },
  {
    key: 'vertieres', month: 11, day: 18, leadDays: 3,
    artKey: 'vertieres', fallbackArtKey: 'vertieres', eventTag: 'vertieres',
    title: { ht: 'Vertières · 18 Nov', fr: 'Vertières · 18 nov.', en: 'Vertières · Nov 18' },
    message: {
      ht: 'Onè ak respè pou ewo Vètyè yo, viktwa ki mennen nou nan 1804.',
      fr: 'Gloire aux héros de Vertières, la victoire qui a mené à 1804.',
      en: 'Honoring the heroes of Vertières, the victory that led to 1804.',
    },
  },
  {
    key: 'discovery', month: 12, day: 5, leadDays: 0, lowKey: true,
    fallbackArtKey: 'labadeenight', eventTag: 'discovery',
    title: { ht: 'Jou Dekouvèt', fr: 'Jour de la Découverte', en: 'Discovery Day' },
    message: {
      ht: 'Nou sonje istwa zile nou an, depi tan Tayino yo.',
      fr: "On se souvient de l'histoire de notre île, depuis les Taïnos.",
      en: "Remembering our island's story, from the Taíno on.",
    },
  },
  {
    key: 'noel', month: 12, day: 25, leadDays: 7,
    fallbackArtKey: 'lakou', eventTag: 'noel',
    title: { ht: 'Nwèl', fr: 'Noël', en: 'Christmas' },
    message: {
      ht: 'Bòn fèt Nwèl! Limyè, fanmi ak bon manje.',
      fr: 'Joyeux Noël ! Des lumières, la famille et une bonne table.',
      en: 'Merry Christmas! Lights, family and a full table.',
    },
  },
]

/* -------------------------------------------------------------------------- */
/*  Day arithmetic (UTC day numbers, no time zones past the first step)       */
/* -------------------------------------------------------------------------- */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

function dayNumber(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}

function parseIsoDay(s: unknown): number | null {
  const match = typeof s === 'string' ? ISO_DAY.exec(s) : null
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const n = dayNumber(y, m, d)
  // Reject 2027-02-30 and friends, which Date.UTC would roll over.
  return toIsoDay(n) === s ? n : null
}

function toIsoDay(n: number): IsoDay {
  return new Date(n * 86400000).toISOString().slice(0, 10)
}

/**
 * The calendar day `date` falls on in `timeZone`. Strings already in
 * YYYY-MM-DD form are taken as that day. Falls back to the device's own day
 * when the runtime cannot resolve the zone.
 */
export function calendarDay(date: Date | IsoDay, timeZone: string = NATIONAL_DAY_TIME_ZONE): IsoDay {
  if (typeof date === 'string') {
    if (parseIsoDay(date) !== null) return date
    date = new Date(date)
  }
  try {
    // en-CA formats as YYYY-MM-DD.
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
    const iso = `${get('year')}-${get('month')}-${get('day')}`
    if (parseIsoDay(iso) !== null) return iso
  } catch {
    // fall through
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Western (Gregorian) Easter Sunday for a year. */
export function easterSunday(year: number): IsoDay {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return toIsoDay(dayNumber(year, month, day))
}

function ruleRange(rule: NationalDay['movableRule'], year: number): MovableRange | null {
  if (!rule) return null
  const easter = parseIsoDay(easterSunday(year))!
  if (rule === 'easter') return { start: toIsoDay(easter - 2), end: toIsoDay(easter) }
  // Carnival Sunday (Easter - 49) to Mardi Gras (Easter - 47).
  return { start: toIsoDay(easter - 49), end: toIsoDay(easter - 47) }
}

/* -------------------------------------------------------------------------- */
/*  Applying the remote config                                                 */
/* -------------------------------------------------------------------------- */

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const LANGS: NationalDayLang[] = ['en', 'fr', 'ht']

function mergeLocalized(base: Localized, patch: unknown): Localized {
  if (!isObj(patch)) return base
  const out = { ...base }
  for (const l of LANGS) if (typeof patch[l] === 'string' && patch[l].trim()) out[l] = patch[l]
  return out
}

function validRange(r: unknown): MovableRange | null {
  if (!isObj(r)) return null
  const s = parseIsoDay(r.start)
  const e = parseIsoDay(r.end)
  return s !== null && e !== null && e >= s ? { start: r.start, end: r.end } : null
}

/**
 * The calendar with a remote config applied: disabled days removed, field
 * overrides merged (each field type-checked; a bad value keeps the built-in
 * one), movable ranges added. Never throws.
 */
export function resolveNationalDays(
  config?: NationalDayConfig | null,
  base: NationalDay[] = NATIONAL_DAYS
): NationalDay[] {
  const cfg = isObj(config) ? config : {}
  const disabled = new Set(Array.isArray(cfg.disabled) ? cfg.disabled.filter((k) => typeof k === 'string') : [])
  const overrides = isObj(cfg.overrides) ? cfg.overrides : {}
  const movable = isObj(cfg.movable) ? cfg.movable : {}

  return base
    .filter((d) => !disabled.has(d.key))
    .map((d) => {
      const o = isObj(overrides[d.key]) ? (overrides[d.key] as Record<string, any>) : {}
      const next: NationalDay = { ...d }
      if (Number.isInteger(o.month) && o.month >= 1 && o.month <= 12) next.month = o.month
      if (Number.isInteger(o.day) && o.day >= 1 && o.day <= 31) next.day = o.day
      if (Number.isInteger(o.leadDays) && o.leadDays >= 0 && o.leadDays <= 30) next.leadDays = o.leadDays
      if (typeof o.artKey === 'string' && o.artKey) next.artKey = o.artKey
      if (typeof o.fallbackArtKey === 'string' && o.fallbackArtKey) next.fallbackArtKey = o.fallbackArtKey
      if (typeof o.eventTag === 'string' && o.eventTag) next.eventTag = o.eventTag
      if (typeof o.lowKey === 'boolean') next.lowKey = o.lowKey
      if (typeof o.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.accent)) next.accent = o.accent
      next.title = mergeLocalized(d.title, o.title)
      next.message = mergeLocalized(d.message, o.message)

      const extra = isObj(movable[d.key]) ? movable[d.key] : {}
      const years: Record<number, MovableRange> = { ...(d.movable || {}) }
      let added = false
      for (const [y, r] of Object.entries(extra)) {
        const range = validRange(r)
        if (/^\d{4}$/.test(y) && range) {
          years[Number(y)] = range
          added = true
        }
      }
      if (d.movable || added) next.movable = years
      return next
    })
}

/* -------------------------------------------------------------------------- */
/*  Which day is active                                                        */
/* -------------------------------------------------------------------------- */

/** The occurrence of `day` in `year`, as day numbers, or null. */
function occurrence(day: NationalDay, year: number): { start: number; end: number } | null {
  if (day.movable || day.movableRule) {
    const r = day.movable?.[year] ? validRange(day.movable[year]) : ruleRange(day.movableRule, year)
    if (!r) return null
    return { start: parseIsoDay(r.start)!, end: parseIsoDay(r.end)! }
  }
  if (!day.month || !day.day) return null
  const n = dayNumber(year, day.month, day.day)
  // A fixed day that does not exist this year (a remote "Feb 30") is skipped.
  if (toIsoDay(n).slice(5) !== `${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`) return null
  return { start: n, end: n }
}

export interface ActiveNationalDayOptions {
  timeZone?: string
  /**
   * Dev preview only: force this key active ('today'). Callers must gate it to
   * non-production builds; this function does not know the environment.
   */
  force?: string | null
}

/**
 * The national day showing on `date`, with its phase, or null.
 *
 * Window: from `leadDays` before the start through the last day. When two
 * windows overlap, a day that is 'today' beats one that is 'upcoming', then
 * the sooner start wins, then calendar order.
 */
export function activeNationalDay(
  date: Date | IsoDay,
  config?: NationalDayConfig | null,
  options: ActiveNationalDayOptions = {}
): ActiveNationalDay | null {
  const days = resolveNationalDays(config)
  const todayIso = calendarDay(date, options.timeZone)
  const today = parseIsoDay(todayIso)!
  const year = Number(todayIso.slice(0, 4))

  if (options.force) {
    const forced = days.find((d) => d.key === options.force)
    if (forced) {
      const occ = occurrence(forced, year) || occurrence(forced, year + 1)
      return {
        day: forced,
        phase: 'today',
        daysUntil: 0,
        start: occ ? toIsoDay(occ.start) : todayIso,
        end: occ ? toIsoDay(occ.end) : todayIso,
      }
    }
  }

  let best: (ActiveNationalDay & { order: number; startN: number }) | null = null
  days.forEach((day, order) => {
    // This year's and next year's occurrence: 29 December is inside the lead
    // of next year's 1 January.
    for (const y of [year, year + 1]) {
      const occ = occurrence(day, y)
      if (!occ) continue
      const lead = Math.max(0, day.leadDays | 0)
      if (today < occ.start - lead || today > occ.end) continue
      const phase: NationalDayPhase = today >= occ.start ? 'today' : 'upcoming'
      const candidate = {
        day,
        phase,
        daysUntil: phase === 'today' ? 0 : occ.start - today,
        start: toIsoDay(occ.start),
        end: toIsoDay(occ.end),
        order,
        startN: occ.start,
      }
      const better =
        !best ||
        (candidate.phase === 'today' && best.phase !== 'today') ||
        (candidate.phase === best.phase &&
          (candidate.startN < best.startN || (candidate.startN === best.startN && order < best.order)))
      if (better) best = candidate
    }
  })
  if (!best) return null
  const { order: _o, startN: _s, ...active } = best as ActiveNationalDay & { order: number; startN: number }
  return active
}

/**
 * The national day an event on `eventDate` can be tagged for: its date falls
 * inside a day's window or within `slackDays` (7) of it (low-key days: on the
 * day only). Nearest day wins.
 * Used by both composers to offer the "Part of …?" toggle.
 */
export function nationalDayForEventDate(
  eventDate: Date | IsoDay | null | undefined,
  config?: NationalDayConfig | null,
  options: { timeZone?: string; slackDays?: number } = {}
): NationalDay | null {
  if (!eventDate) return null
  if (eventDate instanceof Date && Number.isNaN(eventDate.getTime())) return null
  const iso = calendarDay(eventDate, options.timeZone)
  const n = parseIsoDay(iso)
  if (n === null) return null
  const slack = options.slackDays ?? 7
  const year = Number(iso.slice(0, 4))
  let best: { day: NationalDay; distance: number } | null = null
  for (const day of resolveNationalDays(config)) {
    for (const y of [year - 1, year, year + 1]) {
      const occ = occurrence(day, y)
      if (!occ) continue
      // Low-key days (Jou Mò, Fèt Travay…) are offered only for events ON the
      // day: a party a week after the Day of the Dead is not part of it.
      const pad = day.lowKey ? 0 : slack
      const from = occ.start - Math.max(0, day.leadDays | 0) - pad
      const to = occ.end + pad
      if (n < from || n > to) continue
      const distance = n < occ.start ? occ.start - n : n > occ.end ? n - occ.end : 0
      if (!best || distance < best.distance) best = { day, distance }
    }
  }
  return best ? (best as { day: NationalDay }).day : null
}

/** True when an event carries this day's tag (the `national_day` field, or a legacy tags array). */
export function eventMatchesNationalDay(event: unknown, day: Pick<NationalDay, 'eventTag'> | null | undefined): boolean {
  if (!day || !isObj(event)) return false
  if (event.national_day === day.eventTag) return true
  return Array.isArray(event.tags) && event.tags.includes(day.eventTag)
}

/** The art key to show: the day's own piece when the library has it, else the fallback. */
export function nationalDayArtKey(day: NationalDay, hasArt: (key: string) => boolean): string {
  return day.artKey && hasArt(day.artKey) ? day.artKey : day.fallbackArtKey
}

/** A day's copy in a language, English when the language is unknown. */
export function nationalDayText(day: NationalDay, lang: string | null | undefined): { title: string; message: string } {
  const l = (LANGS as string[]).includes(String(lang)) ? (lang as NationalDayLang) : 'en'
  return { title: day.title[l], message: day.message[l] }
}

/** The day's short name for running copy ("Part of Vertières?"): the title before any " · date". */
export function nationalDayName(day: NationalDay, lang: string | null | undefined): string {
  return nationalDayText(day, lang).title.split(' · ')[0].trim()
}

/** Every eventTag a client may write to `national_day`. */
export function nationalDayTags(): string[] {
  return NATIONAL_DAYS.map((d) => d.eventTag)
}
