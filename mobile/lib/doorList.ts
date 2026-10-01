/**
 * Door list: the slim, door-only view of an event's tickets that staff WITHOUT
 * the view-attendees permission work from (GET /api/staff/events/:id/door-list).
 * Name, tier, status, checked-in state and ticket code. No email, phone or money.
 *
 * Pure on purpose (no React Native imports): the root jest suite holds this
 * copy to parity with the server's lib/scan/doorRules.ts, which is the source
 * of truth (__tests__/staff-door-check-in.test.ts). Offline, the scanner judges
 * a scan with judgeDoorRow; online, the server re-judges in a transaction.
 */

export type DoorRow = {
  id: string;
  code: string;
  name: string;
  tier: string;
  status: string;
  live: boolean;
  checkedIn: boolean;
  checkedInAt: string | null;
  endsAt: string | null;
  validFrom: string | null;
  validUntil: string | null;
};

export type DoorVerdict =
  | 'CHECKED_IN'
  | 'ALREADY_CHECKED_IN'
  | 'OUTSIDE_WINDOW'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'WRONG_EVENT'
  | 'NOT_FOUND';

export type DoorJudgement = { verdict: DoorVerdict; admit: boolean; reentry: boolean };

/** Same order as the server and the scanner: expired, already in, status, entry window. */
export function judgeDoorRow(
  row: DoorRow | null,
  ctx: { allowReentry: boolean; now?: Date; reentry?: boolean; override?: boolean },
): DoorJudgement {
  const refuse = (verdict: DoorVerdict): DoorJudgement => ({ verdict, admit: false, reentry: false });
  if (!row) return refuse('NOT_FOUND');

  const now = (ctx.now ?? new Date()).getTime();
  const ends = row.endsAt ? Date.parse(row.endsAt) : NaN;
  if (!isNaN(ends) && now > ends) return refuse('EXPIRED');

  if (row.checkedIn) {
    if (ctx.reentry && ctx.allowReentry && row.live) return { verdict: 'CHECKED_IN', admit: true, reentry: true };
    return refuse('ALREADY_CHECKED_IN');
  }

  if (!row.live) return refuse('CANCELLED');

  if (!ctx.override) {
    const from = row.validFrom ? Date.parse(row.validFrom) : NaN;
    const until = row.validUntil ? Date.parse(row.validUntil) : NaN;
    if ((!isNaN(from) && now < from) || (!isNaN(until) && now > until)) return refuse('OUTSIDE_WINDOW');
  }

  return { verdict: 'CHECKED_IN', admit: true, reentry: false };
}

/** Find a scanned/typed value on the list: by ticket id first, then by its QR code. */
export function findDoorRow(rows: DoorRow[], value: string): DoorRow | null {
  const v = String(value || '').trim();
  if (!v) return null;
  return rows.find((r) => r.id === v) || rows.find((r) => r.code === v) || null;
}

/** The row after a check-in on this device, so a re-scan reads "already in". */
export function markRowCheckedIn(rows: DoorRow[], ticketId: string, at: string = new Date().toISOString()): DoorRow[] {
  return rows.map((r) => (r.id === ticketId ? { ...r, checkedIn: true, checkedInAt: r.checkedInAt || at } : r));
}

// ---------------------------------------------------------------------------
// Offline queue (pure parts)
// ---------------------------------------------------------------------------

export type QueuedCheckIn = {
  /** Client id, so a retried flush never double-counts. */
  key: string;
  eventId: string;
  ticketId: string;
  method: 'scan' | 'manual';
  entryPoint: string | null;
  reentry: boolean;
  override: boolean;
  queuedAt: string;
  /** For the "already in elsewhere" notice after sync. Display name only. */
  name: string;
};

/** One entry per ticket: re-queuing the same ticket offline is a no-op. */
export function enqueueCheckIn(queue: QueuedCheckIn[], item: QueuedCheckIn): QueuedCheckIn[] {
  if (queue.some((q) => q.eventId === item.eventId && q.ticketId === item.ticketId && q.reentry === item.reentry)) {
    return queue;
  }
  return [...queue, item].slice(-500);
}
