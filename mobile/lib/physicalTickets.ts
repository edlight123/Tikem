/**
 * Printed (physical) tickets in the app: the pure helpers (a mirror of the
 * web's lib/physical/rules.ts, held to parity by
 * __tests__/mobile-physical-tickets.test.ts) and the offline activation queue.
 *
 * Pure: no React, Expo or Firebase imports, so root Jest tests import it. The
 * network call and storage are injected (see physicalTicketsApi.ts).
 *
 * Selling a printed ticket = ACTIVATING it: the seller scans its QR (or types
 * its serial), enters the buyer's NAME (required), and the ticket becomes
 * valid. With no connection the activation is queued on the phone and synced
 * later; the server resolves conflicts: the FIRST activation wins and a later
 * one comes back ALREADY_ACTIVATED with the holder's name.
 */

export type SaleMethod = 'cash' | 'moncash' | 'natcash' | 'card' | 'other';
export const SALE_METHODS: SaleMethod[] = ['cash', 'moncash', 'natcash', 'card', 'other'];

export type ActivationCode =
  | 'NOT_FOUND'
  | 'WRONG_EVENT'
  | 'NOT_PHYSICAL'
  | 'NAME_REQUIRED'
  | 'ALREADY_ACTIVATED'
  | 'VOIDED'
  | 'RELEASED'
  | 'INVALID_CODE'
  | 'NOT_YOUR_RANGE'
  | 'BATCH_NOT_READY'
  | 'AMBIGUOUS_SERIAL';

export type ActivationResponse =
  | { ok: true; ticketId: string; serial: string; holderName: string; tier: string; alreadyDone?: boolean }
  | { ok: false; code: ActivationCode; serial?: string | null; holderName?: string | null; activatedAt?: string | null };

/** A printed ticket's QR: {"ticketId","v","s"} with v >= 1 and a random token s. */
export function parsePhysicalQr(raw: unknown): { ticketId: string; v: number; s: string } | null {
  const s = String(raw ?? '').trim();
  if (!s.startsWith('{')) return null;
  try {
    const j = JSON.parse(s);
    if (typeof j?.ticketId !== 'string' || !j.ticketId) return null;
    if (typeof j?.v !== 'number' || !Number.isInteger(j.v) || j.v < 1) return null;
    if (typeof j?.s !== 'string' || !/^[A-Za-z0-9_-]{22,64}$/.test(j.s)) return null;
    return { ticketId: j.ticketId, v: j.v, s: j.s };
  } catch {
    return null;
  }
}

/** Normalize a typed serial: trim, upper-case, unify dashes and spaces. */
export function normalizeSerial(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[‐-―\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

export function looksLikeSerial(raw: unknown): boolean {
  return /^[A-Z0-9]{1,8}-[A-Z0-9]{1,8}(-B\d{1,4})?-\d{3,6}$/.test(normalizeSerial(raw));
}

export function cleanHolderName(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** A door-list row / ticket status that means "printed, never sold". */
export function isUnsoldPrinted(status: unknown): boolean {
  return String(status ?? '') === 'printed_unsold';
}

/** A door-list row / ticket status that means "printed, voided or released". */
export function isVoidedPrinted(status: unknown): boolean {
  const s = String(status ?? '');
  return s === 'voided' || s === 'released';
}

// ---------------------------------------------------------------------------
// Offline queue
// ---------------------------------------------------------------------------

export type QueuedActivation = {
  /** Idempotency key sent to the server: a retry of the same item is not a conflict. */
  clientRef: string;
  eventId: string;
  code: string | null;
  serial: string | null;
  name: string;
  phone: string | null;
  method: SaleMethod;
  /** When the seller tapped "Sell" (device clock). */
  clientActivatedAt: string;
};

export function newClientRef(now: number = Date.now(), rand: () => number = Math.random): string {
  return `act_${now.toString(36)}_${Math.floor(rand() * 1e12).toString(36)}`;
}

/** What identifies the TICKET of a queued item (one paper ticket = one queued sale). */
export function activationTicketKey(item: Pick<QueuedActivation, 'eventId' | 'code' | 'serial'>): string {
  const qr = parsePhysicalQr(item.code);
  return `${item.eventId}|${qr ? `id:${qr.ticketId}` : `serial:${normalizeSerial(item.serial || item.code)}`}`;
}

/**
 * Add an item. Same clientRef = the same item (replaced). Same ticket already
 * queued = refused (`duplicate`): a second offline sale of one paper ticket on
 * the same phone is a mistake, not a conflict for the server to settle.
 */
export function enqueueActivation(
  queue: QueuedActivation[],
  item: QueuedActivation,
): { queue: QueuedActivation[]; duplicate: boolean } {
  const withoutSame = queue.filter((q) => q.clientRef !== item.clientRef);
  const key = activationTicketKey(item);
  if (withoutSame.some((q) => activationTicketKey(q) === key)) return { queue, duplicate: true };
  return { queue: [...withoutSame, item], duplicate: false };
}

export type SyncItemOutcome =
  | { item: QueuedActivation; kind: 'activated'; response: ActivationResponse }
  /** Judged and refused (first activation wins, voided, not your range…): dropped from the queue. */
  | { item: QueuedActivation; kind: 'refused'; response: ActivationResponse }
  /** Never accepted (no longer a seller, event gone): dropped. */
  | { item: QueuedActivation; kind: 'denied'; status: number }
  /** No connection / server error: kept for the next sync. */
  | { item: QueuedActivation; kind: 'kept' };

/** What one POST returned: a judged 200, an auth/input refusal, or a network/server failure. */
export type PostOutcome =
  | { type: 'judged'; response: ActivationResponse }
  | { type: 'denied'; status: number }
  | { type: 'offline' };

export type SyncReport = {
  queue: QueuedActivation[];
  outcomes: SyncItemOutcome[];
  activated: number;
  refused: number;
  remaining: number;
};

/**
 * Replay queued activations in order. Drops every item the server judged (ok
 * or refused) and every item it will never accept; keeps the rest from the
 * first network/server failure on.
 */
export async function syncActivationQueue(
  queue: QueuedActivation[],
  post: (item: QueuedActivation) => Promise<PostOutcome>,
  opts: { eventId?: string } = {},
): Promise<SyncReport> {
  const keep: QueuedActivation[] = [];
  const outcomes: SyncItemOutcome[] = [];
  let offline = false;
  for (const item of queue) {
    if (offline || (opts.eventId && item.eventId !== opts.eventId)) {
      keep.push(item);
      if (offline && (!opts.eventId || item.eventId === opts.eventId)) outcomes.push({ item, kind: 'kept' });
      continue;
    }
    let res: PostOutcome;
    try {
      res = await post(item);
    } catch {
      res = { type: 'offline' };
    }
    if (res.type === 'offline') {
      offline = true;
      keep.push(item);
      outcomes.push({ item, kind: 'kept' });
    } else if (res.type === 'denied') {
      outcomes.push({ item, kind: 'denied', status: res.status });
    } else if (res.response.ok) {
      outcomes.push({ item, kind: 'activated', response: res.response });
    } else {
      outcomes.push({ item, kind: 'refused', response: res.response });
    }
  }
  return {
    queue: keep,
    outcomes,
    activated: outcomes.filter((o) => o.kind === 'activated').length,
    refused: outcomes.filter((o) => o.kind === 'refused' || o.kind === 'denied').length,
    remaining: keep.filter((q) => !opts.eventId || q.eventId === opts.eventId).length,
  };
}

/** The i18n key (scanner.sell.result.*) for a refusal code. */
export function activationMessageKey(code: ActivationCode): string {
  switch (code) {
    case 'ALREADY_ACTIVATED':
      return 'physicalSell.result.alreadySold';
    case 'VOIDED':
    case 'RELEASED':
      return 'physicalSell.result.voided';
    case 'NOT_YOUR_RANGE':
      return 'physicalSell.result.notYourRange';
    case 'NAME_REQUIRED':
      return 'physicalSell.result.nameRequired';
    case 'WRONG_EVENT':
      return 'physicalSell.result.wrongEvent';
    case 'BATCH_NOT_READY':
      return 'physicalSell.result.batchNotReady';
    case 'AMBIGUOUS_SERIAL':
      return 'physicalSell.result.ambiguousSerial';
    case 'NOT_PHYSICAL':
      return 'physicalSell.result.notPrinted';
    case 'INVALID_CODE':
    case 'NOT_FOUND':
    default:
      return 'physicalSell.result.notFound';
  }
}
