/**
 * Published events whose start falls in [from, to], read server-side.
 *
 * WHY: `events where is_published == true limit(N)` with no order returns an
 * ARBITRARY N once the catalogue outgrows N (seeded showcase events plus every
 * past event), so a cron scanning "upcoming" events can silently miss them.
 *
 * `start_datetime` is a Firestore Timestamp on app-made events and an ISO
 * string on web-made ones, and a range only matches its own type, so the window
 * is read ONCE PER TYPE and merged (the same trick as
 * lib/notifications/favorite-reminders.ts). Index used: events is_published ASC,
 * start_datetime ASC (already deployed).
 *
 * If either typed read fails (e.g. an index still building), it falls back to
 * the old unordered read filtered in memory, so the cron keeps working.
 */

export type EventRow = { id: string } & Record<string, any>

export interface WindowReadResult {
  events: EventRow[]
  /** True when a read hit `max`, so the window may hold more than was read. */
  truncated: boolean
}

function toMillis(v: any): number {
  if (!v) return 0
  if (typeof v?.toDate === 'function') return v.toDate().getTime()
  if (typeof v?.seconds === 'number') return v.seconds * 1000
  if (typeof v?._seconds === 'number') return v._seconds * 1000
  const ms = new Date(v).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/** De-dupe by id, keep rows inside [from, to], sort soonest first. */
export function mergeWindowRows(lists: Array<Array<{ id: string; data: () => any }>>, from: Date, to: Date): EventRow[] {
  const lo = from.getTime()
  const hi = to.getTime()
  const byId = new Map<string, EventRow>()
  for (const docs of lists) {
    for (const d of docs) {
      if (byId.has(d.id)) continue
      const data = d.data() || {}
      const ms = toMillis(data.start_datetime)
      if (!ms || ms < lo || ms > hi) continue
      byId.set(d.id, { id: d.id, ...data })
    }
  }
  return Array.from(byId.values()).sort((a, b) => toMillis(a.start_datetime) - toMillis(b.start_datetime))
}

export async function readPublishedEventsInWindow(
  db: any,
  from: Date,
  to: Date,
  max: number
): Promise<WindowReadResult> {
  const base = () => db.collection('events').where('is_published', '==', true)
  const typed = (lo: Date | string, hi: Date | string) =>
    base().where('start_datetime', '>=', lo).where('start_datetime', '<=', hi).orderBy('start_datetime', 'asc').limit(max).get()

  try {
    const [asTimestamp, asString] = await Promise.all([typed(from, to), typed(from.toISOString(), to.toISOString())])
    return {
      events: mergeWindowRows([asTimestamp.docs, asString.docs], from, to),
      truncated: asTimestamp.size >= max || asString.size >= max,
    }
  } catch (err) {
    console.warn('[published-in-window] typed window read failed; using the unordered fallback', err)
  }

  const snap = await base().limit(max).get()
  return { events: mergeWindowRows([snap.docs], from, to), truncated: snap.size >= max }
}
