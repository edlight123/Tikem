/**
 * The Profile tab's "attended" count and poster wall. A mirror of the web
 * /profile dashboard's lib/profile/dashboard.ts (this app cannot import from
 * the web tree); __tests__/mobile-profile-stats-parity.test.ts keeps them in
 * step, so the two profiles show the same number.
 *
 *  - attended = distinct events the reader holds a LIVE ticket to whose end
 *               (or start, when there is no end) is in the past
 *  - posters  = every one of those ticketed events, newest first, undated last
 */

/**
 * The web's lib/tickets/status.ts: a live ticket is `valid`, `confirmed` or
 * `active` depending on the payment rail, and an absent status counts as live
 * (older docs). Refunded, cancelled and transferred-away tickets do not.
 */
const LIVE_TICKET_STATUSES = ['valid', 'confirmed', 'active'];

export function isLiveTicketStatus(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase().trim();
  if (!s) return true;
  return LIVE_TICKET_STATUSES.includes(s);
}

/**
 * Mirrors countsTowardAttendance in lib/profile/dashboard.ts: tickets scanned
 * at the door (older flows set `checked_in` or `used`) also prove attendance.
 */
const SCANNED_TICKET_STATUSES = ['checked_in', 'used'];

export function countsTowardAttendance(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase().trim();
  return isLiveTicketStatus(status) || SCANNED_TICKET_STATUSES.includes(s);
}

export interface ProfileTicketLike {
  event_id?: unknown;
  status?: unknown;
}

export interface ProfileEventLike {
  id: string;
  start_datetime?: unknown;
  end_datetime?: unknown;
}

/** A Firestore Timestamp, Date, ISO string or epoch to a Date; null when it doesn't parse. */
export function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') {
    const d = maybe.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** The distinct event ids the reader holds a live ticket to. */
export function liveTicketEventIds(tickets: ProfileTicketLike[]): string[] {
  const ids = new Set<string>();
  for (const t of tickets) {
    if (!countsTowardAttendance(t.status)) continue;
    const id = String(t.event_id ?? '').trim();
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

/** How many of these events are over (end, else start, before `now`). */
export function countAttended(events: ProfileEventLike[], now: Date = new Date()): number {
  let n = 0;
  for (const e of events) {
    const cutoff = toDateOrNull(e.end_datetime) || toDateOrNull(e.start_datetime);
    if (cutoff && cutoff.getTime() < now.getTime()) n += 1;
  }
  return n;
}

/** Newest first; undated events sink to the bottom. Returns a new array. */
export function sortPostersNewestFirst<T extends ProfileEventLike>(events: T[]): T[] {
  const time = (e: T) => toDateOrNull(e.start_datetime)?.getTime() ?? 0;
  return [...events].sort((a, b) => time(b) - time(a));
}
