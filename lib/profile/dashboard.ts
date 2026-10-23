/**
 * Pure helpers behind the /profile dashboard (no Firebase imports, so they are
 * unit-testable). The server read lives in ./dashboard-server.ts.
 *
 * The numbers mirror the mobile ProfileScreen:
 *  - attended  = events the reader holds a live ticket to whose end (or start,
 *                when there is no end) is in the past
 *  - posters   = every one of those ticketed events, newest first, undated last
 */

import { isLiveTicketStatus } from '@/lib/tickets/status'

export interface DashboardTicketLike {
  event_id?: unknown
  status?: unknown
}

export interface DashboardEventLike {
  id: string
  start_datetime?: unknown
  end_datetime?: unknown
}

/** A Firestore Timestamp, Date, ISO string or epoch to a Date; null when it doesn't parse. */
export function toDateOrNull(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const maybe = value as { toDate?: () => Date }
  if (typeof maybe.toDate === 'function') {
    const d = maybe.toDate()
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * A ticket that was scanned at the door is the clearest proof of attendance,
 * but older door flows overwrote its status to `checked_in` (or `used`), which
 * isLiveTicketStatus rejects. Attendance counts those too; nothing else here
 * (payouts, transfers) should.
 */
const SCANNED_TICKET_STATUSES = new Set(['checked_in', 'used'])

export function countsTowardAttendance(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase().trim()
  return isLiveTicketStatus(status) || SCANNED_TICKET_STATUSES.has(s)
}

/**
 * The distinct event ids the reader holds a LIVE (or scanned) ticket to. Refunded,
 * cancelled and transferred-away tickets don't count (lib/tickets/status.ts:
 * live = valid | confirmed | active, or no status at all on older docs).
 */
export function liveTicketEventIds(tickets: DashboardTicketLike[]): string[] {
  const ids = new Set<string>()
  for (const t of tickets) {
    if (!countsTowardAttendance(t.status)) continue
    const id = String(t.event_id ?? '').trim()
    if (id) ids.add(id)
  }
  return Array.from(ids)
}

/** How many of these events are over (end, else start, before `now`). */
export function countAttended(events: DashboardEventLike[], now: Date = new Date()): number {
  let n = 0
  for (const e of events) {
    const cutoff = toDateOrNull(e.end_datetime) || toDateOrNull(e.start_datetime)
    if (cutoff && cutoff.getTime() < now.getTime()) n += 1
  }
  return n
}

/** Newest first; undated events sink to the bottom. Returns a new array. */
export function sortPostersNewestFirst<T extends DashboardEventLike>(events: T[]): T[] {
  const time = (e: T) => toDateOrNull(e.start_datetime)?.getTime() ?? 0
  return [...events].sort((a, b) => time(b) - time(a))
}
