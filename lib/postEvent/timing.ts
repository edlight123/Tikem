/**
 * When the morning-after follow-up goes out. Pure, so it is unit-tested.
 *
 * The follow-up ("how was it?" to attendees, the recap to the organizer) is
 * sent the morning AFTER the event ends, from 10:00 in the event's own
 * timezone, until 21:00 (quiet hours). An hourly cron calls this for every
 * recently ended event; the first run inside the window sends. Past
 * FOLLOWUP_MAX_AGE_HOURS the moment has gone and nothing is sent.
 */

export const FOLLOWUP_LOCAL_HOUR = 10
export const FOLLOWUP_LAST_LOCAL_HOUR = 21 // exclusive: quiet hours start
export const FOLLOWUP_MAX_AGE_HOURS = 60
/** An event with no end time is treated as ending this long after it starts. */
export const DEFAULT_EVENT_HOURS = 4

const FALLBACK_TZ = 'America/New_York'

function localParts(at: Date, tz: string): { date: string; hour: number } {
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    })
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: FALLBACK_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    })
  }
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 }
}

/** Is `now` inside the follow-up window for an event that ended at `end`? */
export function followupDue(end: Date, now: Date, tz: string | null | undefined): boolean {
  if (!(end instanceof Date) || isNaN(end.getTime())) return false
  const ageH = (now.getTime() - end.getTime()) / 3_600_000
  if (ageH <= 0 || ageH > FOLLOWUP_MAX_AGE_HOURS) return false
  const zone = tz || FALLBACK_TZ
  const e = localParts(end, zone)
  const n = localParts(now, zone)
  if (n.date <= e.date) return false // not the next day yet
  return n.hour >= FOLLOWUP_LOCAL_HOUR && n.hour < FOLLOWUP_LAST_LOCAL_HOUR
}

/** A Firestore Timestamp, ISO string, Date or millis, as a Date (or null). */
export function toDate(v: any): Date | null {
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

/** When the event ended: end_datetime, else start + DEFAULT_EVENT_HOURS. */
export function eventEnd(event: Record<string, any> | null | undefined): Date | null {
  const end = toDate(event?.end_datetime)
  if (end) return end
  const start = toDate(event?.start_datetime)
  return start ? new Date(start.getTime() + DEFAULT_EVENT_HOURS * 3_600_000) : null
}

/** Check-ins per 30-minute slot, for the recap's arrival chart. */
export function arrivalBuckets(times: Date[], slotMinutes = 30): Array<{ at: string; count: number }> {
  const slot = slotMinutes * 60_000
  const counts = new Map<number, number>()
  for (const t of times) {
    if (!(t instanceof Date) || isNaN(t.getTime())) continue
    const k = Math.floor(t.getTime() / slot) * slot
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  if (counts.size === 0) return []
  const keys = Array.from(counts.keys()).sort((a, b) => a - b)
  const out: Array<{ at: string; count: number }> = []
  // Contiguous slots (empty ones included) so the chart has no gaps in time.
  for (let k = keys[0]; k <= keys[keys.length - 1]; k += slot) {
    out.push({ at: new Date(k).toISOString(), count: counts.get(k) || 0 })
    if (out.length > 48) break // a day at most
  }
  return out
}
