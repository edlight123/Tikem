/**
 * Start/end date-time rules shared by the event pickers and the add-on sales
 * window (web composer, app editor). Pure and dependency-free; the Expo app
 * keeps a copy in mobile/lib/dateTimeDefaults.ts (parity-tested).
 *
 *   - A new end defaults to the start + 2 hours.
 *   - Moving the start moves a valid end with it (the length is kept), the
 *     way a calendar does; an end that was missing or not after the old start
 *     becomes start + 2 hours.
 *   - The end must be after the start.
 */

export const DEFAULT_EVENT_HOURS = 2
const HOUR = 3_600_000

const pad = (n: number) => String(n).padStart(2, '0')

/** The default end for a start: start + 2 hours. */
export function defaultEndFor(start: Date, hours: number = DEFAULT_EVENT_HOURS): Date {
  return new Date(start.getTime() + hours * HOUR)
}

const valid = (d: Date | null | undefined): d is Date => !!d && !Number.isNaN(d.getTime())

/** The end after the start moved from `prevStart` to `nextStart`. */
export function nextEndOnStartChange(
  prevStart: Date | null | undefined,
  nextStart: Date,
  end: Date | null | undefined,
  hours: number = DEFAULT_EVENT_HOURS,
): Date {
  if (valid(end) && valid(prevStart) && end.getTime() > prevStart.getTime()) {
    return new Date(nextStart.getTime() + (end.getTime() - prevStart.getTime()))
  }
  if (valid(end) && !valid(prevStart) && end.getTime() > nextStart.getTime()) return end
  return defaultEndFor(nextStart, hours)
}

/** True when both are set and the end is not after the start. */
export function endNotAfterStart(start: Date | null | undefined, end: Date | null | undefined): boolean {
  return valid(start) && valid(end) && end.getTime() <= start.getTime()
}

/** A local Date → its `yyyy-MM-dd` and `HH:mm` parts (the pickers' values). */
export function toLocalParts(d: Date): { date: string; time: string } {
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

/** `yyyy-MM-dd` (+ `HH:mm`, else midnight) → a local Date; null when unset or invalid. */
export function fromLocalParts(date: string | null | undefined, time?: string | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '').trim())
  if (!m) return null
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim())
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), t ? Number(t[1]) : 0, t ? Number(t[2]) : 0)
  return Number.isNaN(d.getTime()) ? null : d
}
