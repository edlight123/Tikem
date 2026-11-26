/**
 * The Thursday push: "this weekend in <your city>".
 *
 * One push per person per week, Thursday early evening in their own market's
 * time, naming what is on Friday to Sunday in the city they were last seen in
 * (lib/notifications/audience-city, from the IP Vercel resolves; no location
 * permission). Push and the bell only: there is no marketing email path.
 *
 * It REPLACES the old Thursday 17:00 UTC city-discovery push rather than
 * adding a second Thursday message about the same city. Per person:
 *  1. events in their city this weekend, and the weekend switch on
 *     (notify_weekend_digest) → the weekend digest;
 *  2. otherwise, events in their city in the next two weeks, and the
 *     "events near you" switch on (notify_discovery) → the old discovery push,
 *     same words as before;
 *  3. otherwise nothing.
 * Both share one cap key per week (`thursday:<friday>`), so nobody gets both.
 *
 * DISCRETIONARY: every send goes through sendDiscretionary (lib/notifications/
 * campaigns), which applies the category switch, quiet hours (21:00 to 09:00
 * local), the cap (recorded before sending) and fails closed.
 *
 * Pure parts (time windows, matching, copy) are exported for tests; the run
 * takes its I/O as deps.
 */
import { isPubliclyListed } from '@/lib/events/visibility'
import { isCategoryEnabled, marketTimezone, type NotificationCategory } from './policy'
import { sameCity } from './audience-city'
import type { NotificationType } from '@/types/database'

/** Used when the person's market is unknown: the main audience's zone. */
export const FALLBACK_TIMEZONE = 'America/Port-au-Prince'
/** Thursday, local time: the first hour the digest may go out ... */
export const DIGEST_FIRST_LOCAL_HOUR = 17
/** ... and the hour it stops (quiet hours start at 21:00). */
export const DIGEST_END_LOCAL_HOUR = 21
/** How far ahead the discovery fallback looks. */
export const DISCOVERY_HORIZON_DAYS = 14
/** Most events named in the discovery fallback. */
export const MAX_EVENTS_NAMED = 3

const THURSDAY = 4
const DAY_MS = 24 * 60 * 60 * 1000

export function personTimezone(country?: string | null): string {
  return marketTimezone(country) || FALLBACK_TIMEZONE
}

/** Calendar date, weekday (0 = Sunday) and hour of `now` in `tz`. */
export function localParts(now: Date, tz: string): { date: string; weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: weekdays[get('weekday')] ?? 0,
    hour: Number(get('hour')) % 24,
  }
}

/** Minutes `tz` is ahead of UTC at `at`. */
function offsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

/** The instant of local midnight on `date` (YYYY-MM-DD) in `tz`. */
export function localMidnight(date: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  const first = guess - offsetMinutes(new Date(guess), tz) * 60_000
  // Second pass settles a DST change between the guess and the answer.
  return new Date(guess - offsetMinutes(new Date(first), tz) * 60_000)
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * This weekend in `tz`: the coming (or current) Friday 00:00 to Monday 00:00,
 * local. `weekKey` is that Friday's date: the cap key, so it expires weekly.
 */
export function weekendWindow(now: Date, tz: string): { from: Date; to: Date; weekKey: string } {
  const { date, weekday } = localParts(now, tz)
  // Friday..Sunday is "this weekend"; Monday..Thursday looks ahead to Friday.
  const daysToFriday = weekday === 0 ? -2 : weekday === 6 ? -1 : 5 - weekday
  const friday = addDays(date, daysToFriday)
  return { from: localMidnight(friday, tz), to: localMidnight(addDays(friday, 3), tz), weekKey: friday }
}

/** Thursday, between DIGEST_FIRST_LOCAL_HOUR and DIGEST_END_LOCAL_HOUR, in `tz`. */
export function isDigestHour(now: Date, tz: string): boolean {
  const { weekday, hour } = localParts(now, tz)
  return weekday === THURSDAY && hour >= DIGEST_FIRST_LOCAL_HOUR && hour < DIGEST_END_LOCAL_HOUR
}

export interface DigestEvent {
  id: string
  title: string
  city: string
  start: Date
}

/** A Firestore Timestamp, ISO string, Date or millis, as a Date (or null). */
function toDate(v: any): Date | null {
  if (!v) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  if (typeof v?.toDate === 'function') {
    const d = v.toDate()
    return d instanceof Date && !isNaN(d.getTime()) ? d : null
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof v?._seconds === 'number') return new Date(v._seconds * 1000)
  return null
}

/**
 * Published events worth naming, starting after `now` and within the discovery
 * horizon. Cancelled, rejected and held-for-review events are left out.
 */
export function upcomingDigestEvents(rows: Record<string, any>[], now: Date): DigestEvent[] {
  const horizon = now.getTime() + DISCOVERY_HORIZON_DAYS * DAY_MS
  const out: DigestEvent[] = []
  for (const e of rows) {
    if (!e || e.is_published !== true) continue
    if (!isPubliclyListed(e) || e.status === 'cancelled' || e.rejected === true || e.hidden_pending_review === true) continue
    const start = toDate(e.start_datetime)
    if (!start || start.getTime() <= now.getTime() || start.getTime() > horizon) continue
    const title = String(e.title || '').trim()
    if (!title) continue
    out.push({ id: String(e.id || ''), title, city: String(e.city || ''), start })
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}

export type DigestLang = 'en' | 'fr' | 'ht'

export function digestLang(user: Record<string, any> | null | undefined): DigestLang {
  const lang = String(user?.language || '').toLowerCase().slice(0, 2)
  if (lang === 'fr' || lang === 'ht' || lang === 'en') return lang
  return String(user?.last_seen_country || '').toUpperCase() === 'FR' ? 'fr' : 'en'
}

/** "A", "A and B", "A, B and 3 more", in the person's language. */
function nameList(titles: string[], lang: DigestLang): string {
  const names = Array.from(new Set(titles))
  const [a, b] = names
  const more = names.length - 2
  const and = { en: 'and', fr: 'et', ht: 'ak' }[lang]
  if (names.length === 1) return a
  if (names.length === 2) return `${a} ${and} ${b}`
  const rest = {
    en: `${more} more`,
    fr: more === 1 ? '1 autre' : `${more} autres`,
    ht: `${more} lòt ankò`,
  }[lang]
  return `${a}, ${b} ${and} ${rest}`
}

/** The weekend push, or null when there is nothing to say. */
export function weekendDigestCopy(
  city: string,
  events: Array<{ title: string }>,
  lang: DigestLang
): { title: string; body: string } | null {
  if (events.length === 0 || !city) return null
  const title = {
    en: `This weekend in ${city}`,
    fr: `Ce week-end à ${city}`,
    ht: `Wikenn sa a nan ${city}`,
  }[lang]
  return { title, body: nameList(events.map((e) => e.title), lang) }
}

/** The old city-discovery push, word for word (it was English only). */
export function discoveryCopy(city: string, events: Array<{ title: string }>): { title: string; body: string } | null {
  if (events.length === 0 || !city) return null
  const named = events.slice(0, MAX_EVENTS_NAMED)
  return {
    title: events.length === 1 ? `New in ${city}: ${named[0].title}` : `${events.length} new events in ${city}`,
    body: named.map((e) => e.title).join(' · '),
  }
}

export const thursdayCapKey = (weekKey: string) => `thursday:${weekKey}`

export interface PlannedSend {
  category: NotificationCategory
  capKey: string
  type: NotificationType
  title: string
  body: string
  url: string
  data: Record<string, any>
}

/**
 * What (if anything) the run at `now` sends this person. Pure: the cap,
 * quiet hours and the switch are re-checked by sendDiscretionary.
 */
export function planThursdaySend(
  user: Record<string, any>,
  upcoming: DigestEvent[],
  now: Date
): PlannedSend | null {
  const city = String(user?.last_seen_city || '').trim()
  if (!city) return null
  const tz = personTimezone(user?.last_seen_country)
  if (!isDigestHour(now, tz)) return null

  const inCity = upcoming.filter((e) => sameCity(city, e.city))
  if (inCity.length === 0) return null

  const { from, to, weekKey } = weekendWindow(now, tz)
  const capKey = thursdayCapKey(weekKey)
  const weekend = inCity.filter((e) => e.start.getTime() >= from.getTime() && e.start.getTime() < to.getTime())

  if (weekend.length > 0 && isCategoryEnabled(user, 'weekend_digest')) {
    const copy = weekendDigestCopy(city, weekend, digestLang(user))
    if (copy) {
      return {
        category: 'weekend_digest',
        capKey,
        type: 'weekend_digest',
        ...copy,
        url: '/discover',
        data: { city, eventCount: weekend.length, weekKey },
      }
    }
  }

  if (isCategoryEnabled(user, 'discovery')) {
    const copy = discoveryCopy(city, inCity)
    if (copy) {
      return {
        category: 'discovery',
        capKey,
        type: 'city_discovery',
        ...copy,
        url: '/discover',
        data: { city, eventCount: inCity.length },
      }
    }
  }
  return null
}

export interface ThursdayDeps {
  loadEvents(): Promise<Record<string, any>[]>
  /** Users whose city is known: [{ id, data }]. */
  loadUsers(): Promise<Array<{ id: string; data: Record<string, any> }>>
  send(userId: string, plan: PlannedSend): Promise<boolean>
}

export interface ThursdayResult {
  users: number
  candidates: number
  weekend: number
  discovery: number
}

export async function runThursdayDigest(now: Date, deps: ThursdayDeps): Promise<ThursdayResult> {
  const upcoming = upcomingDigestEvents(await deps.loadEvents(), now)
  const result: ThursdayResult = { users: 0, candidates: upcoming.length, weekend: 0, discovery: 0 }
  if (upcoming.length === 0) return result

  const users = await deps.loadUsers()
  result.users = users.length
  for (const { id, data } of users) {
    const plan = planThursdaySend(data || {}, upcoming, now)
    if (!plan) continue
    const sent = await deps.send(id, plan)
    if (sent) result[plan.category === 'weekend_digest' ? 'weekend' : 'discovery'] += 1
  }
  return result
}
