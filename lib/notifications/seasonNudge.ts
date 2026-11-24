/**
 * "Kanaval is in 3 weeks. Make your poster in one tap." The organizer season
 * nudge: about three weeks before an occasion that has holiday poster
 * templates (lib/holidayTemplates), organizers who have made at least one
 * event hear once that it is coming, with a link to the occasion's page
 * (its posters, its ideas, "Add an event").
 *
 * Pure: no Firestore. The cron (app/api/cron/organizer-season) does the
 * reading and sends through sendDiscretionary, category 'organizer_season':
 * quiet hours, the notify_organizer_season switch (opt-in in Canada and
 * France, userPreferences CONSENT_MARKETS) and a once-per-occasion-per-year
 * cap per person.
 */
import { occasionDaysUntil, occasionName, occasionWindow, type OccasionKey } from '@/lib/occasions'
import { occasionsWithTemplates } from '@/lib/holidayTemplates'

/** The nudge goes out this many days before the occasion starts... */
export const SEASON_NUDGE_DAYS = 21
/**
 * ...or up to this many days later if a run is missed or the person was in
 * quiet hours: a daily cron retries, and the cap keeps it to once.
 */
export const SEASON_NUDGE_GRACE_DAYS = 3

export interface SeasonNudge {
  occasion: OccasionKey
  /** YYYY-MM-DD the occurrence starts (its window's first day). */
  start: string
  /** Once per occasion per year, per person. */
  capKey: string
  daysUntil: number
}

/**
 * The occasions to nudge about on `now`: ones with templates whose window
 * starts in SEASON_NUDGE_DAYS days (down to SEASON_NUDGE_DAYS - GRACE).
 */
export function seasonNudgesDue(now: Date | number = Date.now(), keys: readonly OccasionKey[] = occasionsWithTemplates()): SeasonNudge[] {
  const out: SeasonNudge[] = []
  for (const occasion of keys) {
    const range = occasionWindow(occasion, now)
    // Kanaval's window opens with the pre-kanaval Sundays in January; the
    // nudge is about the fat days, so count to its main start.
    const start = occasion === 'kanaval' ? range.mainStart : range.start
    const daysUntil = occasionDaysUntil({ ...range, start }, now)
    if (daysUntil <= SEASON_NUDGE_DAYS && daysUntil > SEASON_NUDGE_DAYS - SEASON_NUDGE_GRACE_DAYS - 1) {
      out.push({ occasion, start, capKey: `season:${occasion}:${start.slice(0, 4)}`, daysUntil })
    }
  }
  return out
}

/**
 * The organizer accounts worth telling: every organizer_id on a real event
 * (seeded showcase events don't count, and neither do deleted ones). An
 * organizer_id is the org owner's uid; the cron fans out to its team.
 */
export function eligibleOrganizerIds(events: Array<Record<string, any>>): string[] {
  const ids = new Set<string>()
  for (const e of events) {
    if (!e || e.seed_batch || e.deleted === true || e.is_deleted === true) continue
    const id = typeof e.organizer_id === 'string' ? e.organizer_id.trim() : ''
    if (id) ids.add(id)
  }
  return [...ids]
}

type Lang = 'en' | 'fr' | 'ht'
const langOf = (raw: unknown): Lang => {
  const code = String(raw || 'en').slice(0, 2).toLowerCase()
  return code === 'fr' || code === 'ht' ? code : 'en'
}

/** The push in the recipient's language (users/{uid}.language, English when unset). */
export function seasonNudgeCopy(occasion: OccasionKey, daysUntil: number, language: unknown): { title: string; body: string } {
  const lang = langOf(language)
  const name = occasionName(occasion, lang)
  const weeks = Math.max(1, Math.round(daysUntil / 7))
  if (lang === 'fr') {
    return {
      title: weeks === 1 ? `${name}, c’est dans une semaine` : `${name}, c’est dans ${weeks} semaines`,
      body: 'Faites votre affiche en un geste.',
    }
  }
  if (lang === 'ht') {
    return {
      title: weeks === 1 ? `${name} nan yon semèn` : `${name} nan ${weeks} semèn`,
      body: 'Fè afich ou an yon sèl klik.',
    }
  }
  return {
    title: weeks === 1 ? `${name} is in a week` : `${name} is in ${weeks} weeks`,
    body: 'Make your poster in one tap.',
  }
}

/** Where a tap lands: the occasion's page, which has its posters and "Add an event". */
export function seasonNudgeLinks(occasion: OccasionKey): { url: string; deepLink: string } {
  return { url: `/occasions/${occasion}`, deepLink: `tikem://occasions/${occasion}` }
}
