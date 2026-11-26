/**
 * Home's "new on Tikèm" rail (ported from Tikra's "new on tikra", 2026-11-25).
 * The feed lists events soonest first, so an organizer's event announced
 * today for a date six weeks out was buried at the bottom (or not read at
 * all). This rail shows what was ADDED lately, newest first:
 *   - publicly listed: published, not rejected, not held for review
 *     (hidden_pending_review), not unlisted (show_on_explore === false), not
 *     cancelled;
 *   - added in the last two weeks (published_at when stored, else
 *     created_at; either may be a Timestamp or an ISO string);
 *   - upcoming (not over: lib/home/feed eventHasEnded);
 *   - in the browsed country, and the browsed city/metro when the caller
 *     passes `inArea`;
 *   - real listings only: never a sample (isTemplateEvent);
 *   - a recurring series once, at its next date (lib/events/series key).
 *
 * The app keeps the same rule in mobile/lib/newOnTikem.ts;
 * __tests__/new-on-tikem.test.ts runs both.
 */

import { seriesKey } from '@/lib/events/series'
import { eventHasEnded, isTemplateEvent } from '@/lib/home/feed'

/** How far back "new" reaches. */
export const NEW_WINDOW_MS = 14 * 86_400_000
/** At most this many cards. */
export const NEW_MAX = 12
/** Fewer than this and the rail hides: two cards read as an empty shelf. */
export const NEW_MIN = 2

const DAY_MS = 86_400_000
/** The widening steps when the newest window is thin: 14, 30, 60 days, then any age read. */
export const NEW_WINDOWS_MS: readonly number[] = [14 * DAY_MS, 30 * DAY_MS, 60 * DAY_MS, Infinity]
/** How far back the reads go (the widest dated step). */
export const NEW_READ_WINDOW_MS = 60 * DAY_MS
/** Widen to the next window while fewer than this many are found. */
export const NEW_FILL = 8
/** The "see all" page's cap. */
export const NEW_PAGE_MAX = 60

/** Firestore Timestamp | {seconds} | Date | ISO string | ms → epoch ms (NaN when unknown). */
export function toMs(v: any): number {
  if (v == null || v === '') return NaN
  if (typeof v?.toMillis === 'function') return v.toMillis()
  if (typeof v?.toDate === 'function') return v.toDate().getTime()
  if (typeof v?.seconds === 'number') return v.seconds * 1000
  if (typeof v?._seconds === 'number') return v._seconds * 1000
  if (v instanceof Date) return v.getTime()
  const t = typeof v === 'number' ? v : Date.parse(String(v))
  return Number.isFinite(t) ? t : NaN
}

/** When the event was added: published_at when stored, else created_at. */
export function addedAtMs(e: any): number {
  for (const v of [e?.published_at, e?.created_at]) {
    const t = toMs(v)
    if (Number.isFinite(t)) return t
  }
  return NaN
}

/** Listed publicly: what /discover and the feed would show. */
export function isPubliclyListed(e: any): boolean {
  if (!e || e.is_published !== true) return false
  if (e.rejected === true || e.hidden_pending_review === true) return false
  if (e.show_on_explore === false) return false
  return String(e.status || '').toLowerCase() !== 'cancelled'
}

export interface NewOnTikemOpts {
  now: number
  /** The browsed country (ISO code); a missing event country reads as HT. */
  country: string
  /** The browsed city/metro, when one is chosen. */
  inArea?: (e: any) => boolean
  /** One fixed window; omitted = widen 14 → 30 → 60 days → any while under NEW_FILL. */
  windowMs?: number
  max?: number
  /** Below this many the rail is empty (default NEW_MIN). */
  min?: number
}

export function selectNewOnTikem<T extends Record<string, any>>(events: readonly T[], opts: NewOnTikemOpts): T[] {
  const min = opts.min ?? NEW_MIN
  // A quiet town still gets a full rail (Tikra 2026-11-25: Victoria showed 2):
  // the last two weeks first, then 30, 60 days, then any age, while thin.
  const windows = opts.windowMs ? [opts.windowMs] : NEW_WINDOWS_MS
  const fill = Math.min(NEW_FILL, opts.max ?? NEW_MAX)
  let picked: T[] = []
  for (const windowMs of windows) {
    picked = selectInWindow(events, opts, windowMs)
    if (picked.length >= fill) break
  }
  return picked.length >= min ? picked : []
}

function selectInWindow<T extends Record<string, any>>(events: readonly T[], opts: NewOnTikemOpts, windowMs: number): T[] {
  const { now } = opts
  const country = String(opts.country || '').toUpperCase()
  const seen = new Set<string>()
  const groups = new Map<string, { e: T; added: number; start: number }>()
  for (const e of events) {
    if (!e || !e.id || seen.has(String(e.id))) continue
    seen.add(String(e.id))
    if (!isPubliclyListed(e) || isTemplateEvent(e)) continue
    if (country && String(e.country || 'HT').toUpperCase() !== country) continue
    if (opts.inArea && !opts.inArea(e)) continue
    const added = addedAtMs(e)
    if (!Number.isFinite(added) || added > now + 60_000 || now - added > windowMs) continue
    const start = toMs(e.start_datetime)
    if (!Number.isFinite(start)) continue
    if (eventHasEnded({ start_datetime: start, end_datetime: Number.isFinite(toMs(e.end_datetime)) ? toMs(e.end_datetime) : null }, now)) continue
    // A series once: its next date, ranked by its newest addition.
    const key = seriesKey(e)
    const prev = groups.get(key)
    if (!prev) groups.set(key, { e, added, start })
    else
      groups.set(key, {
        e: start < prev.start ? e : prev.e,
        start: Math.min(start, prev.start),
        added: Math.max(added, prev.added),
      })
  }
  return [...groups.values()]
    .sort((a, b) => b.added - a.added || a.start - b.start || String(a.e.id).localeCompare(String(b.e.id)))
    .slice(0, opts.max ?? NEW_MAX)
    .map((p) => p.e)
}
