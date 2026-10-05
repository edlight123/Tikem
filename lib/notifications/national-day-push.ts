import type { Query, QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { sendDiscretionary } from '@/lib/notifications/campaigns'
import { localHour } from '@/lib/notifications/policy'
import {
  activeNationalDay,
  nationalDayPushable,
  nationalDayText,
  type ActiveNationalDay,
  type NationalDay,
  type NationalDayConfig,
  type NationalDayLang,
} from '@/lib/nationalDays'

/**
 * The national-day push: one short note, at 09:00 the recipient's time, on a
 * Haitian holiday itself (lib/nationalDays). A DISCRETIONARY campaign
 * (category `national_day`), so it goes out through `sendDiscretionary` like
 * every other one: per-category opt-out, quiet hours, and a cap claimed before
 * anything is sent.
 *
 * The cron (app/api/cron/national-day-push) runs hourly. Each run does nothing
 * unless the active day is in its 'today' phase, is not low-key and is not
 * silenced (`push: false`), and then only addresses the users for whom it is
 * 09:00–09:59. A user's time comes from the same place quiet hours read it:
 * `localHour(now, last_seen_country)` in policy.ts.
 *
 * The cap is per day and YEAR (`national_day:<key>:<year>`), not per calendar
 * date, so a three-day Kanaval is one push, and a second run in the same hour
 * finds every cap already claimed.
 */

export const NATIONAL_DAY_PUSH_HOUR = 9

/** Users read per page, and sends in flight at once. */
const PAGE_SIZE = 500
const SEND_CONCURRENCY = 20

/**
 * Ceiling for one run. Unlike city-discovery's single read this pages with a
 * cursor, but a run still has a function timeout; hitting the ceiling is
 * reported as `truncated` instead of passing as a quiet holiday.
 */
const MAX_USERS_PER_RUN = 20000

/**
 * The markets policy.ts maps to a zone, plus `null` for everyone else (the
 * UTC-5 fallback). Used only to skip the user scan in hours when nobody can be
 * at 09:00.
 */
const KNOWN_COUNTRIES = ['HT', 'US', 'CA', 'FR'] as const

export function nationalDayCapKey(dayKey: string, year: number | string): string {
  return `national_day:${dayKey}:${year}`
}

export function isNationalDayPushHour(now: Date, countryCode?: string | null): boolean {
  return localHour(now, countryCode) === NATIONAL_DAY_PUSH_HOUR
}

/**
 * The recipient's language: the saved `users/{uid}.language`, as the
 * withdrawal notices read it. English when unset, matching user-profile's
 * default, so a new account reads the same language everywhere.
 */
export function pushLanguage(raw: unknown): NationalDayLang {
  const code = String(raw || 'en').slice(0, 2).toLowerCase()
  return code === 'fr' || code === 'ht' ? code : 'en'
}

export function nationalDayPushCopy(day: NationalDay, language: unknown): { title: string; body: string } {
  const { title, message } = nationalDayText(day, pushLanguage(language))
  return { title, body: message }
}

/**
 * Where a tap lands. `url` is the web page (also the bell entry's actionUrl);
 * `deepLink` is what the app's push handler prefers, mapped to the themed
 * CategoryEvents page in mobile/navigation/linkingConfig.ts.
 */
export function nationalDayPushLinks(dayKey: string): { url: string; deepLink: string } {
  const key = encodeURIComponent(dayKey)
  return { url: `/discover?day=${key}`, deepLink: `tikem://national-day/${key}` }
}

/**
 * Which countries are at the push hour right now, and whether the fallback
 * band (unknown country) is too. Pure, for the early exit and the query.
 */
export function pushHourBands(now: Date): { countries: string[]; fallback: boolean } {
  return {
    countries: KNOWN_COUNTRIES.filter((c) => isNationalDayPushHour(now, c)),
    fallback: isNationalDayPushHour(now, null),
  }
}

/** The day this run may push for, or null with the reason it may not. */
export function pushableDay(
  now: Date,
  config: NationalDayConfig | null | undefined
): { active: ActiveNationalDay; year: number } | { active: null; reason: string } {
  const active = activeNationalDay(now, config)
  if (!active) return { active: null, reason: 'no national day' }
  if (active.phase !== 'today') return { active: null, reason: 'upcoming' }
  if (active.day.lowKey) return { active: null, reason: 'low-key day' }
  if (!nationalDayPushable(active)) return { active: null, reason: 'push disabled for this day' }
  // The occurrence's year, not today's: a cap must not reset mid-occurrence.
  return { active, year: Number(active.start.slice(0, 4)) }
}

export interface NationalDayPushResult {
  ok: true
  day?: string
  notified: number
  scanned: number
  reason?: string
  truncated?: boolean
}

/**
 * One run. `config` is the remote `config/national_days` doc (null = the
 * built-in calendar). Never sends outside `sendDiscretionary`.
 */
export async function runNationalDayPush(
  now: Date,
  config: NationalDayConfig | null
): Promise<NationalDayPushResult> {
  const pick = pushableDay(now, config)
  if (!pick.active) return { ok: true, notified: 0, scanned: 0, reason: pick.reason }
  const { active, year } = pick
  const day = active.day

  const bands = pushHourBands(now)
  if (bands.countries.length === 0 && !bands.fallback) {
    // The common case: 21 of the day's 24 runs end here without a read.
    return { ok: true, day: day.key, notified: 0, scanned: 0, reason: 'not 09:00 for anyone' }
  }

  // Only users who registered a push token (that is what stamps
  // last_seen_country). When the fallback band is at 09:00 the query cannot
  // name "every other country", so it reads all of them and filters below.
  let base: Query = adminDb.collection('users')
  base = bands.fallback
    ? base.where('last_seen_country', '!=', null)
    : base.where('last_seen_country', 'in', bands.countries)

  const capKey = nationalDayCapKey(day.key, year)
  const { url, deepLink } = nationalDayPushLinks(day.key)

  let scanned = 0
  let notified = 0
  let cursor: QueryDocumentSnapshot | null = null
  let truncated = false

  while (true) {
    let q = base.limit(PAGE_SIZE)
    if (cursor) q = q.startAfter(cursor)
    const page = await q.get()
    if (page.empty) break
    scanned += page.size

    const due = page.docs.filter((d) => isNationalDayPushHour(now, (d.data() || {}).last_seen_country))
    for (let i = 0; i < due.length; i += SEND_CONCURRENCY) {
      const results = await Promise.all(
        due.slice(i, i + SEND_CONCURRENCY).map((doc) => {
          const { title, body } = nationalDayPushCopy(day, (doc.data() || {}).language)
          return sendDiscretionary({
            userId: doc.id,
            category: 'national_day',
            capKey,
            type: 'national_day',
            title,
            body,
            url,
            data: { nationalDay: day.key, deepLink },
          })
        })
      )
      notified += results.filter(Boolean).length
    }

    if (page.size < PAGE_SIZE) break
    if (scanned >= MAX_USERS_PER_RUN) {
      truncated = true
      break
    }
    cursor = page.docs[page.docs.length - 1]
  }

  return { ok: true, day: day.key, notified, scanned, ...(truncated ? { truncated: true } : {}) }
}
