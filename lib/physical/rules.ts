/**
 * Printed (physical) tickets: the pure rules. No Firebase import, so every
 * decision here is unit-tested and the Expo app can mirror it for offline use
 * (mobile/lib/physicalTickets.ts).
 *
 * DATA MODEL (decision: reuse the `tickets` collection)
 * ----------------------------------------------------
 * A printed ticket is a normal `tickets` doc with `kind: 'physical'`, so the
 * door scanner, the door list, attendee lists, check-in reports and the seat
 * return code read it with no new plumbing. What differs:
 *
 *   status            'printed_unsold' (printed, not sold: refused at the door)
 *                     → 'valid' on activation (holder name required)
 *                     | 'voided'   (lost/stolen range, or replaced by a reprint)
 *                     | 'released' (unsold seat given back to online sales)
 *   physical_serial   human serial printed on the ticket, e.g. "FETE-VIP-0001"
 *   physical_serial_no   its number (1..N within the batch)
 *   physical_batch_id    physical_batches/{id}
 *   physical_seller_uid  the seller the serial range is assigned to (or null)
 *   qr_version / qr_code / qr_code_data
 *                     the QR. Version starts at 1 and a reprint bumps it, so
 *                     the existing scanners (web, app online and offline)
 *                     already refuse an old code: from version 1 only the exact
 *                     current payload admits. The payload has the signed-ticket
 *                     shape {"ticketId","v","s"} but `s` is a crypto-random
 *                     128-bit token (not an HMAC), checked against the stored
 *                     payload. Nothing in it derives from the serial.
 *   price_paid: 0     always. Cash for a paper ticket never passes through
 *                     Tikèm, so no fee, ledger or payout path may see it; the
 *                     sale is recorded on `physical_sale` (like door_* fields).
 *   reservation_id    'phys_{batchId}': the seats were reserved on the sharded
 *                     inventory when the batch was ordered.
 */

export const PHYSICAL_KIND = 'physical'
export const PHYSICAL_BATCHES = 'physical_batches'
/** Where a batch's seats are counted on the sharded inventory. */
export const physicalReservationId = (batchId: string) => `phys_${batchId}`
/**
 * Deterministic ticket doc id for serial n of a batch. Written with create(), so
 * two concurrent issuers (webhook + return + "check payment") can never mint the
 * same serial twice: the second create fails harmlessly. The id is not a
 * secret: only the random token in the QR admits.
 */
export const physicalTicketId = (batchId: string, n: number) => `phys_${batchId}_${n}`
/** An unpaid batch holds its seats this long, then is cancelled by the sweep. */
export const PAYMENT_WINDOW_MS = 2 * 60 * 60 * 1000

export type PhysicalTicketStatus = 'printed_unsold' | 'valid' | 'voided' | 'released'

export type BatchStatus = 'awaiting_payment' | 'paid' | 'printing' | 'ready' | 'active' | 'cancelled'

export const BATCH_FLOW: BatchStatus[] = ['awaiting_payment', 'paid', 'printing', 'ready', 'active']

/** Which status moves are allowed (admin console + payment confirmation). */
export function canMoveBatch(from: BatchStatus, to: BatchStatus): boolean {
  if (from === to) return false
  if (to === 'cancelled') return from === 'awaiting_payment'
  const a = BATCH_FLOW.indexOf(from)
  const b = BATCH_FLOW.indexOf(to)
  return a >= 0 && b === a + 1
}

export type SaleMethod = 'cash' | 'moncash' | 'natcash' | 'card' | 'other'
export const SALE_METHODS: SaleMethod[] = ['cash', 'moncash', 'natcash', 'card', 'other']

export function isPhysicalTicket(ticket: Record<string, any> | null | undefined): boolean {
  return String(ticket?.kind || '') === PHYSICAL_KIND
}

// ── serials ──────────────────────────────────────────────────────────────────

/** A short upper-case code from free text: "Fête de la Musique" → "FETE". */
export function serialCode(text: string, max = 4, fallback = 'TKT'): string {
  const plain = String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .trim()
  const words = plain.split(/\s+/).filter(Boolean)
  if (words.length === 0) return fallback
  const first = words[0].slice(0, max)
  return first.length >= 2 ? first : (words.join('').slice(0, max) || fallback)
}

/**
 * "FETE-VIP-B2" from an event title, a tier name and the batch's sequence
 * within the event: two batches of the same tier never share a serial.
 */
export function serialPrefix(eventTitle: string, tierName: string, batchSeq?: number): string {
  const base = `${serialCode(eventTitle, 4, 'EVT')}-${serialCode(tierName, 4, 'GEN')}`
  return batchSeq && batchSeq > 0 ? `${base}-B${batchSeq}` : base
}

/** Serial for ticket n (1-based) of a batch; zero-padded to at least 4 digits. */
export function formatSerial(prefix: string, n: number, total: number): string {
  const width = Math.max(4, String(total).length)
  return `${prefix}-${String(n).padStart(width, '0')}`
}

/** Normalize a typed serial: trim, upper-case, unify dashes and spaces. */
export function normalizeSerial(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[‐-―\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
}

export function looksLikeSerial(raw: unknown): boolean {
  return /^[A-Z0-9]{1,8}-[A-Z0-9]{1,8}(-B\d{1,4})?-\d{3,6}$/.test(normalizeSerial(raw))
}

// ── QR payload ───────────────────────────────────────────────────────────────

/** 128-bit token in base64url (22 chars). `bytes` is 16 crypto-random bytes. */
export function tokenFromBytes(bytes: Uint8Array): string {
  if (!bytes || bytes.length < 16) throw new Error('A physical QR token needs at least 16 random bytes')
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The QR payload. Same JSON shape as a signed ticket code, so every scanner resolves it. */
export function physicalQrPayload(ticketId: string, version: number, token: string): string {
  return JSON.stringify({ ticketId: String(ticketId), v: version, s: token })
}

/** Pull the token out of a scanned payload, or null. */
export function parsePhysicalQr(raw: unknown): { ticketId: string; v: number; s: string } | null {
  const s = String(raw ?? '').trim()
  if (!s.startsWith('{')) return null
  try {
    const j = JSON.parse(s)
    if (typeof j?.ticketId !== 'string' || !j.ticketId) return null
    if (typeof j?.v !== 'number' || !Number.isInteger(j.v) || j.v < 1) return null
    if (typeof j?.s !== 'string' || !/^[A-Za-z0-9_-]{22,64}$/.test(j.s)) return null
    return { ticketId: j.ticketId, v: j.v, s: j.s }
  } catch {
    return null
  }
}

/** Constant-time-ish string compare (both sides are short, server-held values). */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export type PhysicalCodeCheck = 'OK' | 'VOIDED_CODE' | 'INVALID_CODE'

/**
 * A scanned code against a printed ticket: OK only for the ticket's CURRENT
 * payload. An older version is a code a reprint replaced (VOIDED_CODE).
 * No code (serial typed / manual pick) is OK: the caller decides.
 */
export function checkPhysicalCode(scanned: string | null | undefined, ticketId: string, ticket: Record<string, any>): PhysicalCodeCheck {
  const raw = String(scanned ?? '').trim()
  if (!raw) return 'OK'
  const parsed = parsePhysicalQr(raw)
  if (!parsed || parsed.ticketId !== String(ticketId)) return 'INVALID_CODE'
  const current = parsePhysicalQr(ticket?.qr_code_data)
  if (!current) return 'INVALID_CODE'
  if (parsed.v < current.v) return 'VOIDED_CODE'
  if (parsed.v !== current.v || !sameString(parsed.s, current.s)) return 'INVALID_CODE'
  return 'OK'
}

// ── activation ───────────────────────────────────────────────────────────────

export type ActivationRefusal =
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
  /** A typed serial that matches more than one ticket (legacy batches): scan the QR instead. */
  | 'AMBIGUOUS_SERIAL'

export interface ActivationInput {
  name: string
  phone?: string | null
  method?: string | null
  amount?: number | null
}

export interface ActivationActor {
  uid: string
  /** 'seller' is limited to tickets assigned to them; anyone else with door/manage rights is not. */
  role: 'seller' | 'manager'
}

export function cleanHolderName(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

export function cleanPhone(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/[^\d+]/g, '').slice(0, 20)
  return s.length >= 6 ? s : null
}

export function cleanMethod(raw: unknown): SaleMethod {
  const m = String(raw ?? '').toLowerCase().trim()
  return (SALE_METHODS as string[]).includes(m) ? (m as SaleMethod) : 'cash'
}

/**
 * May this ticket be activated by this actor right now? Null = yes.
 * First activation wins: a ticket that is already `valid` refuses the second.
 */
export function activationRefusal(params: {
  ticketId: string
  ticket: Record<string, any> | null
  eventId: string
  actor: ActivationActor
  input: ActivationInput
  code?: string | null
  batchStatus?: string | null
}): ActivationRefusal | null {
  const { ticket } = params
  if (!ticket) return 'NOT_FOUND'
  if (String(ticket.event_id || '') !== params.eventId) return 'WRONG_EVENT'
  if (!isPhysicalTicket(ticket)) return 'NOT_PHYSICAL'
  if (!cleanHolderName(params.input?.name)) return 'NAME_REQUIRED'
  const codeCheck = checkPhysicalCode(params.code, params.ticketId, ticket)
  if (codeCheck !== 'OK') return codeCheck === 'VOIDED_CODE' ? 'VOIDED' : 'INVALID_CODE'
  const status = String(ticket.status || '')
  if (status === 'voided') return 'VOIDED'
  if (status === 'released') return 'RELEASED'
  if (status !== 'printed_unsold') return 'ALREADY_ACTIVATED'
  if (params.batchStatus && !['ready', 'active', 'printing'].includes(params.batchStatus)) return 'BATCH_NOT_READY'
  if (params.actor.role === 'seller' && String(ticket.physical_seller_uid || '') !== params.actor.uid) return 'NOT_YOUR_RANGE'
  return null
}

/** The fields an activation writes. */
export function activationPatch(params: {
  actor: ActivationActor
  input: ActivationInput
  nowIso: string
  clientActivatedAt?: string | null
  offline?: boolean
  currency?: string | null
}): Record<string, any> {
  const name = cleanHolderName(params.input.name)
  const amount = Number(params.input.amount)
  return {
    status: 'valid',
    attendee_name: name,
    recipient_name: name,
    holder_phone: cleanPhone(params.input.phone),
    physical_sale: {
      method: cleanMethod(params.input.method),
      amount: Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null,
      currency: params.currency || 'HTG',
      activated_by: params.actor.uid,
      activated_role: params.actor.role,
      activated_at: params.nowIso,
      client_activated_at: params.clientActivatedAt || null,
      offline: params.offline === true,
    },
    purchased_at: params.nowIso,
    updated_at: params.nowIso,
  }
}

// ── door ─────────────────────────────────────────────────────────────────────

export type PhysicalDoorReason = 'NOT_SOLD' | 'VOIDED' | 'RELEASED' | null

/** Why a printed ticket's STATUS refuses it at the door (null = its status admits). */
export function physicalDoorReason(ticket: Record<string, any> | null | undefined): PhysicalDoorReason {
  if (!isPhysicalTicket(ticket)) return null
  const s = String(ticket?.status || '')
  if (s === 'printed_unsold') return 'NOT_SOLD'
  if (s === 'voided') return 'VOIDED'
  if (s === 'released') return 'RELEASED'
  return null
}

// ── ranges ───────────────────────────────────────────────────────────────────

export interface SerialRange {
  from: number
  to: number
}

/** A range within 1..total, from <= to. */
export function validRange(r: Partial<SerialRange> | null | undefined, total: number): r is SerialRange {
  const from = Number(r?.from)
  const to = Number(r?.to)
  return Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from && to <= total
}

export function inRange(n: number, r: SerialRange): boolean {
  return n >= r.from && n <= r.to
}

// ── pay from balance ─────────────────────────────────────────────────────────

/**
 * Show "Pay from my Tikèm balance"? Only to who may spend it, and only when the
 * RELEASED HTG balance one event holds covers the WHOLE batch (no partial).
 * Display only: the server re-checks everything when it debits.
 */
export function showBalanceOption(balance: { canUse?: boolean; availableHtg?: number } | null | undefined, totalHtg: number): boolean {
  if (!balance?.canUse) return false
  const total = Number(totalHtg)
  return Number.isFinite(total) && total > 0 && Number(balance.availableHtg) >= total
}

// ── dashboard ────────────────────────────────────────────────────────────────

export interface BatchCounts {
  printed: number
  unsold: number
  activated: number
  checkedIn: number
  voided: number
  released: number
  /** Seats still reserved by tickets nobody bought (unsold, or voided before the seat came back). */
  held: number
}

export function emptyCounts(): BatchCounts {
  return { printed: 0, unsold: 0, activated: 0, checkedIn: 0, voided: 0, released: 0, held: 0 }
}

/** Tally printed tickets: overall and per seller uid ('' = unassigned). */
export function tallyPhysical(tickets: Array<Record<string, any>>): { total: BatchCounts; bySeller: Record<string, BatchCounts> } {
  const total = emptyCounts()
  const bySeller: Record<string, BatchCounts> = {}
  for (const t of tickets) {
    const seller = String(t.physical_seller_uid || '')
    const bucket = (bySeller[seller] ||= emptyCounts())
    for (const c of [total, bucket]) {
      c.printed++
      const s = String(t.status || '')
      if (s === 'printed_unsold') c.unsold++
      else if (s === 'voided') c.voided++
      else if (s === 'released') c.released++
      else c.activated++
      if (t.checked_in === true || t.checked_in_at) c.checkedIn++
      if ((s === 'printed_unsold' || s === 'voided') && !t.seat_returned_at) c.held++
    }
  }
  return { total, bySeller }
}

/**
 * On the event doc: seats printed batches hold without a buyer (sum of
 * batchHeldSeats over the event's batches). Kept by lib/physical/batches.ts
 * (recomputed on every batch change, minus one per activation) so every
 * list / card can show sold for people without loading the batches.
 */
export const EVENT_HELD_SEATS_FIELD = 'physical_held_seats'

/**
 * Tickets sold to people: the event's tickets_sold rollup counts every seat a
 * printed batch reserved, sold or not; take the unsold ones out.
 */
export function soldForPeople(event: { tickets_sold?: unknown; physical_held_seats?: unknown } | null | undefined): number {
  const sold = Math.max(0, Math.round(Number(event?.tickets_sold) || 0))
  const held = Math.max(0, Math.round(Number(event?.physical_held_seats) || 0))
  return Math.max(0, sold - held)
}

/**
 * Seats a batch still holds on the event's inventory without a buyer: its
 * unsold (or voided, seat not yet returned) tickets, plus the whole quantity
 * of tickets not issued yet (a batch awaiting payment reserves its seats at
 * order time). A cancelled batch gave its seats back. The event's
 * tickets_sold counts these seats, so "sold" for people = tickets_sold − held.
 */
export function batchHeldSeats(batch: { status?: unknown; quantity?: unknown }, counts: Pick<BatchCounts, 'printed' | 'held'>): number {
  if (String(batch?.status || '') === 'cancelled') return 0
  const quantity = Math.max(0, Math.round(Number(batch?.quantity) || 0))
  return Math.max(0, counts.held) + Math.max(0, quantity - Math.max(0, counts.printed))
}
