/**
 * `published_at`: when an event FIRST went public (ISO string, like the web's
 * created_at). Home's "Recently added" rail (lib/home/recently-added) reads
 * it, so a draft made weeks ago and published today still counts as new.
 *
 * Stamped once, by every path that publishes (the publish route, admin
 * publish, Eventbrite import/sync, community submissions); an unpublish and
 * republish keeps the first stamp. Older events get it from
 * /api/admin/events/backfill-published-at.
 */

/** The fields to merge when publishing: `published_at` only when it is not stamped yet. */
export function firstPublishStamp(
  prev: { published_at?: unknown } | null | undefined,
  nowIso: string = new Date().toISOString()
): { published_at?: string } {
  return prev?.published_at ? {} : { published_at: nowIso }
}

/** A stored instant (ISO string, Date, Firestore Timestamp, {seconds}) as ISO, or null. */
function instantIso(v: any): string | null {
  if (v == null || v === '') return null
  let ms = NaN
  if (typeof v?.toDate === 'function') ms = v.toDate().getTime()
  else if (v instanceof Date) ms = v.getTime()
  else if (typeof v?.seconds === 'number') ms = v.seconds * 1000
  else if (typeof v?._seconds === 'number') ms = v._seconds * 1000
  else if (typeof v === 'string' || typeof v === 'number') ms = new Date(v).getTime()
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * For the backfill of a published event with no `published_at`: its best-known
 * publish time, the first-publish email stamp `live_email_sent_at`, else
 * `created_at`. Null when it is not published, already stamped, or neither is known.
 */
export function backfillPublishedAt(
  e: Record<string, any> | null | undefined
): { published_at: string; from: 'live_email_sent_at' | 'created_at' } | null {
  if (!e || e.is_published !== true || e.published_at) return null
  const live = instantIso(e.live_email_sent_at)
  if (live) return { published_at: live, from: 'live_email_sent_at' }
  const created = instantIso(e.created_at)
  return created ? { published_at: created, from: 'created_at' } : null
}
