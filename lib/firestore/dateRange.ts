/**
 * Documents whose date `field` falls in a range, however the date was stored.
 *
 * The same field is a Firestore Timestamp on some docs and an ISO string on
 * others (paid tickets store `purchased_at`/`created_at` as strings; free and
 * comp tickets as Timestamps; web-made events use strings, app-made ones
 * Timestamps). A range on a Date matches only Timestamps and a range on a
 * string only strings, so a single query silently drops one kind: admin
 * revenue showed only free tickets. This runs the range once per type and
 * merges the results.
 *
 * `base` is any admin-SDK query without the range (equality filters only, no
 * orderBy on another field). ISO bounds compare correctly because every
 * writer stores Date.toISOString() (UTC, fixed width).
 */
export async function docsInDateRange(
  base: any,
  field: string,
  from?: Date | null,
  to?: Date | null,
  { toExclusive = false }: { toExclusive?: boolean } = {},
): Promise<any[]> {
  const ranged = (lo?: Date | string | null, hi?: Date | string | null) => {
    let q = base
    if (lo != null) q = q.where(field, '>=', lo)
    if (hi != null) q = q.where(field, toExclusive ? '<' : '<=', hi)
    return q.get().then((s: any) => s.docs as any[])
  }
  const [asTimestamps, asStrings] = await Promise.all([
    ranged(from, to),
    ranged(from?.toISOString(), to?.toISOString()),
  ])
  const seen = new Set<string>()
  return [...asTimestamps, ...asStrings].filter((d) => !seen.has(d.ref.path) && !!seen.add(d.ref.path))
}

/** A stored date (Timestamp, Date or ISO string) as epoch ms, NaN if unreadable. */
export function storedDateMs(v: any): number {
  if (!v) return NaN
  if (typeof v?.toMillis === 'function') return v.toMillis()
  return new Date(v).getTime()
}
