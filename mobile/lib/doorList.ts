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
  /**
   * The ticket's QR version (0 = never changed hands). From 1 on only the
   * exact signed `code` admits, so an offline door refuses a pre-transfer
   * code. Optional: a list cached by an older build has no such field.
   */
  qrVersion?: number;
};

export type DoorVerdict =
  | 'CHECKED_IN'
  | 'ALREADY_CHECKED_IN'
  | 'OUTSIDE_WINDOW'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'WRONG_EVENT'
  | 'NOT_FOUND'
  /** A code from before the ticket's latest transfer. */
  | 'TRANSFERRED'
  /** A signed code that does not verify. */
  | 'INVALID_CODE';

export type ScannedCodeCheck = 'OK' | 'TRANSFERRED' | 'INVALID_CODE';

export type DoorJudgement = { verdict: DoorVerdict; admit: boolean; reentry: boolean };

/** Same order as the server and the scanner: expired, already in, status, entry window. */
export function judgeDoorRow(
  row: DoorRow | null,
  ctx: { allowReentry: boolean; now?: Date; reentry?: boolean; override?: boolean; codeCheck?: ScannedCodeCheck },
): DoorJudgement {
  const refuse = (verdict: DoorVerdict): DoorJudgement => ({ verdict, admit: false, reentry: false });
  if (!row) return refuse('NOT_FOUND');
  // Before "already in", as on the server: a pre-transfer code reads as
  // transferred, never as a duplicate of the new holder's check-in.
  if (ctx.codeCheck === 'TRANSFERRED') return refuse('TRANSFERRED');
  if (ctx.codeCheck === 'INVALID_CODE') return refuse('INVALID_CODE');

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
  const signedId = parseSignedTicketQr(v)?.ticketId;
  return (
    rows.find((r) => r.id === v) ||
    rows.find((r) => r.code === v) ||
    (signedId ? rows.find((r) => r.id === signedId) : undefined) ||
    null
  );
}

// ---------------------------------------------------------------------------
// QR versions. Mirror of lib/scan/doorRules.ts (held to parity by
// __tests__/staff-door-check-in.test.ts). A phone has no signing key, so
// offline the scanned code must equal the CURRENT code the list carries.
// ---------------------------------------------------------------------------

/** A signed payload `{"ticketId","v","s"}`, or null for anything else (legacy codes). */
export function parseSignedTicketQr(raw: unknown): { ticketId: string; v: number; s: string } | null {
  const cleaned = String(raw ?? '').trim();
  if (!cleaned.startsWith('{')) return null;
  try {
    const json = JSON.parse(cleaned);
    const ticketId = json?.ticketId;
    const v = json?.v;
    const s = json?.s;
    if (typeof ticketId !== 'string' || !ticketId) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null;
    if (typeof s !== 'string' || !s) return null;
    return { ticketId, v, s };
  } catch {
    return null;
  }
}

/** The ticket's QR version from a ticket doc; absent or junk = 0. */
export function ticketQrVersionOf(ticket: any): number {
  const v = Number(ticket?.qr_version);
  return Number.isInteger(v) && v > 0 ? v : 0;
}

/**
 * Judge a scanned code against the ticket's current code and version.
 * Empty `scanned` = nothing to judge (a manual pick by name).
 */
export function judgeScannedCodeAgainstRow(
  scanned: string | null | undefined,
  row: { id: string; code: string; qrVersion?: number | null },
): ScannedCodeCheck {
  const raw = String(scanned ?? '').trim();
  if (!raw) return 'OK';
  const current = Number.isInteger(row.qrVersion) && (row.qrVersion as number) > 0 ? (row.qrVersion as number) : 0;
  const signed = parseSignedTicketQr(raw);
  if (!signed) return current >= 1 ? 'TRANSFERRED' : 'OK';
  if (signed.ticketId !== row.id) return 'INVALID_CODE';
  if (signed.v < current) return 'TRANSFERRED';
  if (signed.v > current) return 'INVALID_CODE';
  const stored = parseSignedTicketQr(row.code);
  return stored && stored.ticketId === signed.ticketId && stored.v === signed.v && stored.s === signed.s
    ? 'OK'
    : 'INVALID_CODE';
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
  /** The raw scanned code, so the server judges its QR version on sync. Absent for a manual pick. */
  code?: string | null;
};

/** One entry per ticket: re-queuing the same ticket offline is a no-op. */
export function enqueueCheckIn(queue: QueuedCheckIn[], item: QueuedCheckIn): QueuedCheckIn[] {
  if (queue.some((q) => q.eventId === item.eventId && q.ticketId === item.ticketId && q.reentry === item.reentry)) {
    return queue;
  }
  return [...queue, item].slice(-500);
}
