/**
 * One card per series.
 *
 * A recurring event is stored as one event doc per date. Listed as-is, a
 * daily party filled a whole rail with the same poster three times ("today",
 * "tomorrow", "Tuesday"), which made the platform look empty. Lists show a
 * series once, at its next date, with how many more dates follow.
 *
 * A series is one organizer's docs sharing `series_id` (set by the
 * composers for generated occurrences); docs without one group by title +
 * venue + city, so the same night copied by hand collapses too. Twin of the website's
 * lib/events/series.ts; keep the two in step.
 *
 * Calendar-style views (the home "this week" strip, a date filter) want every
 * date and should not collapse.
 */

const norm = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

export function seriesKey(e: {
  id?: unknown
  organizer_id?: unknown
  series_id?: unknown
  title?: unknown
  venue_name?: unknown
  city?: unknown
}): string {
  // Scoped to the organizer: without it, anyone could list an earlier event
  // with a competitor's title and venue (or copy a series_id) and replace that
  // competitor's card in every list. Only one organizer's own dates merge.
  const org = String(e.organizer_id ?? '')
  if (e.series_id) return `s:${org}:${String(e.series_id)}`
  const t = norm(e.title)
  // An untitled doc never merges with another.
  return t ? `t:${org}|${t}|${norm(e.venue_name)}|${norm(e.city)}` : `id:${String(e.id ?? '')}`
}

const startMs = (e: { start_datetime?: unknown }) => {
  const v: any = e.start_datetime
  const d = v && typeof v.toDate === 'function' ? v.toDate() : new Date(v)
  const ms = d.getTime()
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY
}

/**
 * Keeps each series' soonest date, in the position its first card had, and
 * sets `more_dates` to how many other dates it hides. Events that aren't
 * part of a series pass through with `more_dates: 0`.
 */
export function collapseSeries<T extends { start_datetime?: unknown }>(events: T[]): Array<T & { more_dates: number }> {
  const groups = new Map<string, { first: number; best: T; count: number }>()
  events.forEach((e, i) => {
    const k = seriesKey(e as any)
    const g = groups.get(k)
    if (!g) groups.set(k, { first: i, best: e, count: 1 })
    else {
      g.count++
      if (startMs(e) < startMs(g.best)) g.best = e
    }
  })
  return [...groups.values()]
    .sort((a, b) => a.first - b.first)
    .map((g) => ({ ...g.best, more_dates: g.count - 1 }))
}
