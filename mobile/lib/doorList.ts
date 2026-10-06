/**
 * Door list: the slim, door-only view of an event's tickets that staff WITHOUT
 * the view-attendees permission work from (GET /api/staff/events/:id/door-list).
 * Name, tier, status, checked-in state and a hash of the ticket code (never the
 * code itself). No email, phone or money.
 *
 * Pure on purpose (no React Native imports): the root jest suite holds this
 * copy to parity with the server's lib/scan/doorRules.ts, which is the source
 * of truth (__tests__/staff-door-check-in.test.ts). Offline, the scanner judges
 * a scan with judgeDoorRow; online, the server re-judges in a transaction.
 */

export type DoorRow = {
  id: string;
  /**
   * SHA-256 of the ticket's current QR code (doorCodeHash). The server never
   * ships the code itself: a signed code admits on its own, and this list is
   * cached on every staffer's phone.
   */
  codeHash?: string;
  /**
   * The raw code. Only on a list cached by an older build (scrubbed to a hash
   * on load, see doorCheckIn.loadCachedDoorList) and on the full-access
   * scanner's direct Firestore path. Never sent by the current server.
   */
  code?: string;
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

/** Does this row's current code match a scanned value? By hash; raw only for legacy rows. */
function rowCodeMatches(row: { code?: string; codeHash?: string }, scanned: string, scannedHash: string): boolean {
  if (row.codeHash) return row.codeHash === scannedHash;
  if (row.code) return canonicalDoorCode(row.code) === canonicalDoorCode(scanned);
  return false;
}

/**
 * A row the server marked not-live while its status still reads live: the
 * ticket has a refund in flight (lib/scan/doorRules.ts isDoorLive). The door
 * says so instead of "cancelled".
 */
export function isRefundHeldRow(row: Pick<DoorRow, 'live' | 'status'> | null | undefined): boolean {
  if (!row || row.live) return false;
  const s = String(row.status ?? '').trim().toLowerCase();
  return s === '' || s === 'valid' || s === 'active' || s === 'confirmed';
}

/** Find a scanned/typed value on the list: by ticket id first, then by its QR code. */
export function findDoorRow(rows: DoorRow[], value: string): DoorRow | null {
  const v = String(value || '').trim();
  if (!v) return null;
  const signedId = parseSignedTicketQr(v)?.ticketId;
  const byId = rows.find((r) => r.id === v);
  if (byId) return byId;
  const hash = doorCodeHash(v);
  return (
    rows.find((r) => rowCodeMatches(r, v, hash)) ||
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
 * Empty `scanned` = nothing to judge (a manual pick by name). The row carries
 * a hash of the current code (door list) or, on the full-access Firestore
 * path, the code itself.
 */
export function judgeScannedCodeAgainstRow(
  scanned: string | null | undefined,
  row: { id: string; code?: string; codeHash?: string; qrVersion?: number | null },
): ScannedCodeCheck {
  const raw = String(scanned ?? '').trim();
  if (!raw) return 'OK';
  const current = Number.isInteger(row.qrVersion) && (row.qrVersion as number) > 0 ? (row.qrVersion as number) : 0;
  const signed = parseSignedTicketQr(raw);
  if (!signed) return current >= 1 ? 'TRANSFERRED' : 'OK';
  if (signed.ticketId !== row.id) return 'INVALID_CODE';
  if (signed.v < current) return 'TRANSFERRED';
  if (signed.v > current) return 'INVALID_CODE';
  return rowCodeMatches(row, raw, doorCodeHash(raw)) ? 'OK' : 'INVALID_CODE';
}

// ---------------------------------------------------------------------------
// Code hashing. Mirror of doorCodeHash in lib/scan/doorRules.ts (node crypto
// there; a phone has no synchronous SHA-256, so a small pure one here).
// ---------------------------------------------------------------------------

/** A signed payload by its fields (JSON key order/whitespace never matter), anything else trimmed. */
export function canonicalDoorCode(raw: unknown): string {
  const signed = parseSignedTicketQr(raw);
  if (signed) return `signed\n${signed.ticketId}\n${signed.v}\n${signed.s}`;
  return `raw\n${String(raw ?? '').trim()}`;
}

/** Hex SHA-256 of the canonical code: what the door list carries instead of the code. */
export function doorCodeHash(raw: unknown): string {
  return sha256Hex(canonicalDoorCode(raw));
}

/** A row from an older cache that still holds the raw code, rewritten to carry only its hash. */
export function scrubDoorRow(row: DoorRow): DoorRow {
  if (row.code === undefined) return row;
  const { code, ...rest } = row;
  return { ...rest, codeHash: rest.codeHash || doorCodeHash(code) };
}

function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];

/** Plain FIPS 180-4 SHA-256 over the UTF-8 bytes of `text`, as lowercase hex. */
export function sha256Hex(text: string): string {
  const bytes = utf8Bytes(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push((high >>> 24) & 255, (high >>> 16) & 255, (high >>> 8) & 255, high & 255);
  bytes.push((low >>> 24) & 255, (low >>> 16) & 255, (low >>> 8) & 255, low & 255);

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
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
