/**
 * The homepage feed: every section's data, derived from ONE list of upcoming
 * events the server already fetched (getDiscoverEvents). Pure and clock-
 * injected so each rule here is testable without Firestore.
 *
 * Standing rule for this file: nothing is invented. Every count, "going",
 * "selling fast" and "tickets left" is computed from stored numbers, and a
 * section with nothing true to say returns empty so the page can hide it.
 * Production carries a few dozen events, so the empty paths are the common
 * ones, not the edge cases.
 */

import { CULTURAL_CATEGORIES } from '@/lib/categories'
import { LOCATION_CONFIG, normalizeEventCategory } from '@/lib/filters/config'

/* -------------------------------------------------------------------------- */
/*  The serializable event the homepage sections share                        */
/* -------------------------------------------------------------------------- */

export interface HomeEvent {
  id: string
  title: string
  /** First sentence of the description, when it is short enough to be a line. */
  blurb: string
  category: string
  venue_name: string
  city: string
  country: string
  start_datetime: string
  end_datetime: string | null
  banner_image_url: string | null
  // Pricing signals, for getEventPriceLabel (the buyer-pricing display).
  ticket_price: number | null
  currency: string | null
  is_rsvp?: boolean
  has_paid_tiers?: boolean
  fee_incidence?: string | null
  tickets_sold: number
  total_tickets: number
  featured: boolean
  lineup: string[]
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function toIso(v: any): string | null {
  if (!v) return null
  if (typeof v?.toDate === 'function') return v.toDate().toISOString()
  if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000).toISOString()
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** The first sentence of a description, or '' when there is no short one. */
export function blurbFrom(description: unknown): string {
  // The homepage sets no em dashes (owner rule), organizer copy included:
  // one becomes the comma it almost always stands for.
  const text = str(description)
    .replace(/\s+/g, ' ')
    .replace(/\s*—\s*/g, ', ')
    .trim()
  if (!text) return ''
  const first = (text.match(/^.+?[.!?](\s|$)/)?.[0] || text).trim()
  return first.length <= 140 ? first : ''
}

export function toHomeEvent(e: any): HomeEvent | null {
  const start = toIso(e?.start_datetime)
  if (!e?.id || !start) return null
  const lineup = Array.isArray(e?.guestlist)
    ? (e.guestlist as any[])
        .map((g) => (typeof g === 'string' ? g : str(g?.name)).trim())
        .filter(Boolean)
    : []
  return {
    id: str(e.id),
    title: str(e.title).trim(),
    blurb: blurbFrom(e.description),
    category: str(e.category),
    venue_name: str(e.venue_name).trim(),
    city: str(e.city).trim(),
    country: str(e.country) || 'HT',
    start_datetime: start,
    end_datetime: toIso(e.end_datetime),
    banner_image_url: e.banner_image_url ? str(e.banner_image_url) : null,
    ticket_price: e.ticket_price ?? null,
    currency: e.currency ?? null,
    is_rsvp: e.is_rsvp ?? undefined,
    has_paid_tiers: e.has_paid_tiers ?? undefined,
    fee_incidence: e.fee_incidence ?? null,
    tickets_sold: Math.max(0, num(e.tickets_sold)),
    total_tickets: Math.max(0, num(e.total_tickets)),
    featured: e.featured === true || e.is_featured === true,
    lineup,
  }
}

/* -------------------------------------------------------------------------- */
/*  Time                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The clock the homepage reads in. Times show in the READER's zone — the
 * convention every other surface (cards, the event page) follows, and the
 * zone the organizer's browser stored them from. The server learns it from
 * the request (Vercel's x-vercel-ip-timezone) and hands the same zone to the
 * client, so the server render and hydration print identical strings. The
 * country table is the fallback when the request carries no zone.
 */
const ZONE_BY_COUNTRY: Record<string, string> = {
  HT: 'America/Port-au-Prince',
  US: 'America/New_York',
  CA: 'America/Toronto',
  FR: 'Europe/Paris',
  DO: 'America/Santo_Domingo',
}
export const DEFAULT_ZONE = ZONE_BY_COUNTRY.HT

/** A usable IANA zone, or null for junk / missing input. */
export function validZone(zone?: string | null): string | null {
  if (!zone) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return null
  }
}

export function zoneFor(country?: string | null): string {
  return ZONE_BY_COUNTRY[str(country).toUpperCase()] || DEFAULT_ZONE
}

/** 'YYYY-MM-DD' of an instant on a zone's calendar. */
export function dayKey(at: Date | number | string, zone: string): string {
  const d = new Date(at)
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** The day key `n` calendar days after `key` (DST-proof: pure date math). */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

const startMs = (e: HomeEvent) => new Date(e.start_datetime).getTime()

/** How long an event with no stored end is assumed to run. */
const DEFAULT_RUN_MS = 6 * 3_600_000

export function isLiveNow(e: HomeEvent, now: number): boolean {
  const start = startMs(e)
  if (!(start <= now)) return false
  const end = e.end_datetime ? new Date(e.end_datetime).getTime() : start + DEFAULT_RUN_MS
  return now < end
}

export function hasEnded(e: HomeEvent, now: number): boolean {
  const start = startMs(e)
  const end = e.end_datetime ? new Date(e.end_datetime).getTime() : start + DEFAULT_RUN_MS
  return end <= now
}

/* -------------------------------------------------------------------------- */
/*  Cities                                                                     */
/* -------------------------------------------------------------------------- */

/** Lowercase, accent-folded: "Montréal" and "Montreal" are one city. */
export const fold = (v: unknown) =>
  str(v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/** "Miami, FL" → "Miami": the config's US/CA keys carry a state suffix. */
const stripRegion = (city: string) => city.replace(/,\s*[A-Z]{2}$/, '').trim()

/**
 * The metro an event belongs to: subdivisions roll up to their parent city
 * (Pétion-Ville → Port-au-Prince), the same grouping the discover city filter
 * already applies, so a city chosen here lands on the same events there.
 */
export function metroOf(city: string, country: string): string {
  const cities = LOCATION_CONFIG[country]?.cities || {}
  const folded = fold(stripRegion(city))
  for (const [name, cfg] of Object.entries(cities)) {
    // Same city: keep the stored spelling — it carries the accents the
    // config's ASCII keys drop ("Montréal", not "Montreal, QC").
    if (fold(stripRegion(name)) === folded) return stripRegion(city)
    if ((cfg.subdivisions || []).some((s) => fold(s) === folded)) return stripRegion(name)
  }
  return stripRegion(city)
}

export interface HomeCity {
  /** Display spelling, also the ?city= value. */
  name: string
  /** Folded match key. */
  key: string
  country: string
  count: number
}

/**
 * Only cities that actually have upcoming events, busiest first. The spelling
 * shown is the one the config uses when it knows the city (accents included),
 * otherwise the most accented stored spelling.
 */
export function buildCityIndex(events: HomeEvent[]): HomeCity[] {
  const byKey = new Map<string, HomeCity>()
  for (const e of events) {
    if (!e.city) continue
    const metro = metroOf(e.city, e.country)
    const key = fold(metro)
    const existing = byKey.get(key)
    if (existing) {
      existing.count += 1
      // Prefer the spelling that carries diacritics ("Montréal" over "Montreal").
      if (metro.normalize('NFD').length > existing.name.normalize('NFD').length) existing.name = metro
    } else {
      byKey.set(key, { name: metro, key, country: e.country, count: 1 })
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export function inCity(e: HomeEvent, cityKey: string | null): boolean {
  if (!cityKey) return true
  return fold(metroOf(e.city, e.country)) === cityKey
}

/**
 * Which city the page opens on. An explicit ?city= wins ('all' means all);
 * otherwise the visitor's saved city, then the city their connection is in —
 * each only if it actually has events, so detection never lands a visitor on
 * an empty page.
 */
export function resolveActiveCity(
  cities: HomeCity[],
  param: string | undefined,
  ...fallbacks: (string | null | undefined)[]
): HomeCity | null {
  const find = (raw?: string | null) => {
    if (!raw) return null
    const key = fold(stripRegion(raw))
    return cities.find((c) => c.key === key) || null
  }
  if (param) return fold(param) === 'all' ? null : find(param)
  for (const f of fallbacks) {
    const hit = find(f)
    if (hit) return hit
  }
  return null
}

/* -------------------------------------------------------------------------- */
/*  Live ticker                                                                */
/* -------------------------------------------------------------------------- */

export type TickerSignal =
  | { kind: 'live'; eventId: string; title: string; city: string }
  | { kind: 'left'; eventId: string; title: string; city: string; n: number }
  | { kind: 'selling_fast'; eventId: string; title: string; city: string }
  | { kind: 'going'; eventId: string; title: string; city: string; n: number }

/** A "going" count reads as momentum only past this; below it, it reads as empty. */
export const GOING_MIN = 10
/** Share of capacity sold before "selling fast" is true. */
export const SELLING_FAST_SHARE = 0.7
/** "N tickets left" only when the remainder is genuinely low, in count AND share. */
export const LOW_LEFT_MAX = 25
export const LOW_LEFT_SHARE = 0.15
/** Signals are about what's near: nothing more than this far out. */
const TICKER_HORIZON_MS = 30 * 86_400_000

/**
 * One signal per event — the strongest true one — live first, then scarcity,
 * then momentum. Sold-out events say nothing (there's nothing to act on).
 */
export function buildTickerSignals(events: HomeEvent[], now: number, max = 12): TickerSignal[] {
  const out: { s: TickerSignal; rank: number; start: number }[] = []
  for (const e of events) {
    const start = startMs(e)
    const base = { eventId: e.id, title: e.title, city: metroOf(e.city, e.country) }
    if (isLiveNow(e, now)) {
      out.push({ s: { kind: 'live', ...base }, rank: 0, start })
      continue
    }
    if (start <= now || start - now > TICKER_HORIZON_MS) continue
    const total = e.total_tickets
    const sold = e.tickets_sold
    const remaining = total - sold
    if (total > 0 && remaining <= 0) continue
    if (total > 0 && remaining <= LOW_LEFT_MAX && remaining / total <= LOW_LEFT_SHARE) {
      out.push({ s: { kind: 'left', ...base, n: remaining }, rank: 1, start })
    } else if (total > 0 && sold / total >= SELLING_FAST_SHARE) {
      out.push({ s: { kind: 'selling_fast', ...base }, rank: 2, start })
    } else if (sold >= GOING_MIN) {
      out.push({ s: { kind: 'going', ...base, n: sold }, rank: 3, start })
    }
  }
  return out
    .sort((a, b) => a.rank - b.rank || a.start - b.start)
    .slice(0, max)
    .map((x) => x.s)
}

/* -------------------------------------------------------------------------- */
/*  Featured hero                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Up to `n` hero slides: the admin's featured picks first (soonest first),
 * then the most-sold upcoming events, soonest breaking ties. Artwork is
 * required — the hero is the poster.
 */
export function pickHeroEvents(events: HomeEvent[], now: number, n = 5): HomeEvent[] {
  const pool = events.filter((e) => e.banner_image_url && !hasEnded(e, now))
  const picks = pool.filter((e) => e.featured).sort((a, b) => startMs(a) - startMs(b))
  const rest = pool
    .filter((e) => !e.featured)
    .sort((a, b) => b.tickets_sold - a.tickets_sold || startMs(a) - startMs(b))
  return [...picks, ...rest].slice(0, n)
}

/* -------------------------------------------------------------------------- */
/*  This week                                                                  */
/* -------------------------------------------------------------------------- */

export interface WeekDay {
  /** 'YYYY-MM-DD' on the reader's calendar. */
  date: string
  isToday: boolean
  count: number
  top: { id: string; title: string; banner_image_url: string } | null
}

/** Seven days from today, on the reader's calendar. */
export function buildWeek(events: HomeEvent[], now: number, zone: string): WeekDay[] {
  const today = dayKey(now, zone)
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => ({
    date: addDays(today, i),
    isToday: i === 0,
    count: 0,
    top: null,
  }))
  const index = new Map(days.map((d) => [d.date, d]))
  const best = new Map<string, HomeEvent>()
  for (const e of events) {
    if (hasEnded(e, now)) continue
    const day = index.get(dayKey(e.start_datetime, zone))
    if (!day) continue
    day.count += 1
    if (!e.banner_image_url) continue
    const cur = best.get(day.date)
    const better =
      !cur ||
      e.tickets_sold > cur.tickets_sold ||
      (e.tickets_sold === cur.tickets_sold && Number(e.featured) > Number(cur.featured))
    if (better) best.set(day.date, e)
  }
  for (const d of days) {
    const e = best.get(d.date)
    if (e) d.top = { id: e.id, title: e.title, banner_image_url: e.banner_image_url as string }
  }
  return days
}

/* -------------------------------------------------------------------------- */
/*  Worlds                                                                     */
/* -------------------------------------------------------------------------- */

export interface HomeWorld {
  key: string
  label: string
  /** Canonical categories, for the discover link. */
  categories: string[]
  count: number
  poster: { id: string; title: string; banner_image_url: string } | null
}

/** The eight Kreyòl worlds in their canonical order, each with its real count. */
export function buildWorlds(events: HomeEvent[]): HomeWorld[] {
  return CULTURAL_CATEGORIES.map((w) => {
    const mine = events.filter((e) => w.categories.includes(normalizeEventCategory(e.category)))
    const art = mine
      .filter((e) => e.banner_image_url)
      .sort((a, b) => b.tickets_sold - a.tickets_sold || startMs(a) - startMs(b))[0]
    return {
      key: w.key,
      label: w.label,
      categories: w.categories,
      count: mine.length,
      poster: art ? { id: art.id, title: art.title, banner_image_url: art.banner_image_url as string } : null,
    }
  })
}

/* -------------------------------------------------------------------------- */
/*  Starting soon                                                              */
/* -------------------------------------------------------------------------- */

export const STARTING_SOON_MS = 48 * 3_600_000

export function startingSoon(events: HomeEvent[], now: number, max = 3): HomeEvent[] {
  return events
    .filter((e) => {
      const s = startMs(e)
      return s > now && s - now <= STARTING_SOON_MS
    })
    .sort((a, b) => startMs(a) - startMs(b))
    .slice(0, max)
}
