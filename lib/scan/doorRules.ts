/**
 * Door check-in rules for staff who may check people in but may NOT read the
 * attendee list (members/{uid}.permissions.checkin == true, viewAttendees false).
 *
 * Firestore cannot restrict fields on read, so those staff never read `tickets`
 * directly. They get a slim door list and check in through the server instead
 * (app/api/staff/events/[id]/door-list and .../check-in). Everything here is
 * pure so the authorization matrix and the verdicts can be unit-tested.
 *
 * The verdict order mirrors the mobile scanner (mobile/screens/organizer/
 * TicketScannerScreen.tsx validateTicket): wrong event, expired, already in,
 * status, entry window. The Expo app carries a copy in mobile/lib/doorList.ts
 * for offline use; __tests__/staff-door-check-in.test.ts holds them to parity.
 */

import { createHash } from 'crypto'

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

export type DoorRole = 'owner' | 'admin' | 'staff'

export type DoorAccessInput = {
  uid: string | null | undefined
  isAdmin: boolean
  event: Record<string, any> | null
  /** events/{eventId}/members/{uid}, or null when the user is not a member. */
  member: Record<string, any> | null
}

export type DoorAccessDecision =
  | { allowed: true; role: DoorRole; canViewAttendees: boolean }
  | { allowed: false; status: 401 | 403 | 404; error: string }

/**
 * Same predicates as firestore.rules isEventOwner / canCheckin: the event's
 * organizer, a member with role 'owner', or a member whose
 * permissions.checkin is exactly true. Platform admins are also allowed, as on
 * every other organizer API.
 */
export function evaluateDoorAccess(input: DoorAccessInput): DoorAccessDecision {
  const uid = String(input.uid || '')
  if (!uid) return { allowed: false, status: 401, error: 'Not authenticated' }
  if (!input.event) return { allowed: false, status: 404, error: 'Event not found' }

  const organizerId = String(input.event.organizer_id || input.event.organizerId || '')
  const member = input.member
  if (organizerId === uid || String(member?.role || '') === 'owner') {
    return { allowed: true, role: 'owner', canViewAttendees: true }
  }
  if (input.isAdmin) return { allowed: true, role: 'admin', canViewAttendees: true }
  if (member && member.permissions?.checkin === true) {
    return { allowed: true, role: 'staff', canViewAttendees: member.permissions?.viewAttendees === true }
  }
  return { allowed: false, status: 403, error: 'You do not have check-in access for this event' }
}

// ---------------------------------------------------------------------------
// Ticket helpers
// ---------------------------------------------------------------------------

/** live = valid | confirmed | active, plus legacy tickets with no status. */
export function isLiveStatus(raw: unknown): boolean {
  const s = String(raw ?? '').trim().toLowerCase()
  return s === '' || s === 'valid' || s === 'active' || s === 'confirmed'
}

/** ISO string for a Firestore Timestamp, Date, millis or date string; null otherwise. */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  try {
    const v: any = value
    const d: Date =
      typeof v?.toDate === 'function'
        ? v.toDate()
        : v instanceof Date
          ? v
          : typeof v === 'object' && typeof v._seconds === 'number'
            ? new Date(v._seconds * 1000)
            : typeof v === 'object' && typeof v.seconds === 'number'
              ? new Date(v.seconds * 1000)
              : new Date(v)
    return isNaN(d.getTime()) ? null : d.toISOString()
  } catch {
    return null
  }
}

export function ticketEventIdOf(ticket: Record<string, any>): string {
  return String(ticket?.event_id ?? ticket?.eventId ?? '')
}

export function ticketTierIdOf(ticket: Record<string, any>): string {
  return String(ticket?.ticket_tier_id || ticket?.tier_id || ticket?.ticketTierId || '')
}

export function ticketTierNameOf(ticket: Record<string, any>): string {
  return String(
    ticket?.tier_name || ticket?.ticket_tier_name || ticket?.ticket_type || ticket?.ticketType || ticket?.tierName || ''
  )
}

/**
 * A refund that is moving (or waiting on a Tikèm admin): the ticket must not
 * also be used, whatever its status says yet. Same set as lib/tickets/refundPlan
 * IN_FLIGHT_REFUND_STATUSES and checkInTicket's ticketBlockReason. 'requested'
 * is NOT here: a buyer who asked for a refund and came anyway is admitted and
 * the request is denied by the check-in (performDoorCheckIn).
 */
export const DOOR_IN_FLIGHT_REFUND_STATUSES = new Set(['processing', 'approved', 'manual_required', 'admin_review'])

export function isRefundInFlight(ticket: Record<string, any> | null | undefined): boolean {
  return DOOR_IN_FLIGHT_REFUND_STATUSES.has(String(ticket?.refund_status ?? '').trim().toLowerCase())
}

/** Admits at the door: a live status and no refund in flight. */
export function isDoorLive(ticket: Record<string, any> | null | undefined): boolean {
  return isLiveStatus(ticket?.status) && !isRefundInFlight(ticket)
}

export function isCheckedIn(ticket: Record<string, any>): boolean {
  return Boolean(ticket?.checked_in_at) || ticket?.checked_in === true
}

/** Display name only — never an email or phone number. */
export function displayNameOf(ticket: Record<string, any>, profileName?: string | null): string {
  return String(ticket?.attendee_name || ticket?.user_name || ticket?.userName || profileName || '').trim()
}

/**
 * Resolve a ticket's tier PREFERRING its tier id within the event's embedded
 * ticket_tiers; `fetched` is ticket_tiers/{id} when the caller loaded it; then
 * a name match for older tickets. Same order as the mobile scanner.
 */
export function resolveTier(
  eventTiers: unknown,
  tierId: string,
  tierName: string,
  fetched?: Record<string, any> | null
): Record<string, any> | null {
  const tiers = Array.isArray(eventTiers) ? eventTiers : []
  if (tierId) {
    const byId = tiers.find((x: any) => String(x?.id ?? x?.tier_id ?? x?.tierId ?? '') === tierId)
    if (byId) return byId
    if (fetched) return fetched
  }
  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()
  const target = norm(tierName)
  if (!target) return null
  return tiers.find((x: any) => norm(x?.name) === target) || null
}

// ---------------------------------------------------------------------------
// The door row — everything the door needs, nothing else.
// ---------------------------------------------------------------------------

export type DoorRow = {
  id: string
  /**
   * SHA-256 of what the QR encodes (doorCodeHash), never the code itself. From
   * QR version 1 the code is a signed payload that admits on its own, and the
   * list is cached on every staffer's phone: shipping it raw handed each one a
   * working ticket. The phone hashes what it scans and compares.
   */
  codeHash: string
  name: string
  tier: string
  status: string
  live: boolean
  checkedIn: boolean
  checkedInAt: string | null
  /** When the ticket stops admitting (the scanner's "event has ended" check). */
  endsAt: string | null
  /** The tier's entry window. */
  validFrom: string | null
  validUntil: string | null
  /**
   * The ticket's QR version (0 = never changed hands). From 1 on, only the
   * exact signed `code` admits, so an offline door refuses a pre-transfer code.
   */
  qrVersion: number
}

export function toDoorRow(
  id: string,
  ticket: Record<string, any>,
  opts: { tier?: Record<string, any> | null; profileName?: string | null; event?: Record<string, any> | null } = {}
): DoorRow {
  const tier = opts.tier || null
  return {
    id,
    codeHash: doorCodeHash(String(ticket?.qr_code_data || ticket?.qr_code || id)),
    name: displayNameOf(ticket, opts.profileName),
    tier: ticketTierNameOf(ticket) || String(tier?.name || ''),
    status: String(ticket?.status || ''),
    // A refund in flight (processing / approved / manual_required / admin_review)
    // refuses at the door even while the status still reads live: the offline
    // door list judges from this flag alone.
    live: isDoorLive(ticket),
    checkedIn: isCheckedIn(ticket),
    checkedInAt: toIso(ticket?.checked_in_at),
    endsAt:
      toIso(ticket?.end_datetime || ticket?.event_date || ticket?.start_datetime) ??
      toIso(opts.event?.end_datetime),
    validFrom: toIso(tier?.valid_from),
    validUntil: toIso(tier?.valid_until),
    qrVersion: ticketQrVersionOf(ticket),
  }
}

/** On the door list: live tickets, plus checked-in ones so "already in" can show. */
export function belongsOnDoorList(ticket: Record<string, any>): boolean {
  return isLiveStatus(ticket?.status) || isCheckedIn(ticket)
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

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
  /** A signed code that does not verify (forged, or names another ticket). */
  | 'INVALID_CODE'

export type CheckInOptions = {
  /** Staff tapped "Allow re-entry" on an already-checked-in ticket. */
  reentry?: boolean
  /** Staff tapped "Override — check in anyway" outside the tier's entry window. */
  override?: boolean
  /**
   * The scanned code's judgement against the ticket (server: HMAC verified,
   * lib/tickets/qr.ts; offline: code hash match, judgeScannedCodeAgainstRow).
   * Absent = no code was judged (a manual pick by name).
   */
  codeCheck?: ScannedCodeCheck
}

export type DoorJudgement = {
  verdict: DoorVerdict
  /** True when the check-in should be written. */
  admit: boolean
  /** True when it is written as a re-entry (reentry_override). */
  reentry: boolean
}

/**
 * Judge one door row. `row` is null when the ticket does not exist. The order
 * is the scanner's: wrong event, expired, already in, status, entry window.
 */
export function judgeDoorRow(
  row: (DoorRow & { eventId?: string }) | null,
  ctx: { eventId: string; allowReentry: boolean; now?: Date } & CheckInOptions
): DoorJudgement {
  const refuse = (verdict: DoorVerdict): DoorJudgement => ({ verdict, admit: false, reentry: false })
  if (!row) return refuse('NOT_FOUND')
  if (row.eventId !== undefined && row.eventId !== ctx.eventId) return refuse('WRONG_EVENT')
  // Before "already in": a pre-transfer code must read as transferred, not as
  // a duplicate of the new holder's check-in. Override and re-entry never
  // bypass it.
  if (ctx.codeCheck === 'TRANSFERRED') return refuse('TRANSFERRED')
  if (ctx.codeCheck === 'INVALID_CODE') return refuse('INVALID_CODE')

  const now = (ctx.now ?? new Date()).getTime()
  const ends = row.endsAt ? Date.parse(row.endsAt) : NaN
  if (!isNaN(ends) && now > ends) return refuse('EXPIRED')

  if (row.checkedIn) {
    // Re-entry re-admits only a ticket that is still live, and only when the
    // organizer turned re-entry on for the event.
    if (ctx.reentry && ctx.allowReentry && row.live) return { verdict: 'CHECKED_IN', admit: true, reentry: true }
    return refuse('ALREADY_CHECKED_IN')
  }

  if (!row.live) return refuse('CANCELLED')

  if (!ctx.override) {
    const from = row.validFrom ? Date.parse(row.validFrom) : NaN
    const until = row.validUntil ? Date.parse(row.validUntil) : NaN
    if ((!isNaN(from) && now < from) || (!isNaN(until) && now > until)) return refuse('OUTSIDE_WINDOW')
  }

  return { verdict: 'CHECKED_IN', admit: true, reentry: false }
}

export type CheckInMethod = 'scan' | 'manual'

/**
 * The fields the scanner writes today (and that firestore.rules lets door
 * staff touch), minus the server timestamps the caller adds.
 */
export function checkInFields(params: {
  uid: string
  method: CheckInMethod
  entryPoint?: string | null
  reentry: boolean
}): Record<string, any> {
  const out: Record<string, any> = {
    checked_in: true,
    checked_in_by: params.uid,
    check_in_method: params.method,
  }
  if (params.entryPoint) out.entry_point = params.entryPoint
  if (params.reentry) out.reentry_override = true
  return out
}

/** Free text like the web door mode's, trimmed and capped. */
export function normalizeEntryPoint(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  return s.length <= 60 ? s : s.slice(0, 60)
}

/** Same rules as the scanner's parseTicketId: a /tickets/{id} URL, a JSON payload, or a bare code. */
export function parseTicketCode(scanResult: unknown): string | null {
  const cleaned = String(scanResult ?? '').trim()
  if (!cleaned) return null
  try {
    const url = new URL(cleaned)
    const match = url.pathname.match(/\/tickets\/([a-zA-Z0-9_-]+)/)
    if (match) return match[1]
  } catch {
    // not a URL
  }
  try {
    const json = JSON.parse(cleaned)
    if (json && typeof json === 'object') {
      const id = json.ticketId ?? json.ticket_id ?? json.id
      if (id) return String(id)
    }
  } catch {
    // not JSON
  }
  return /^[a-zA-Z0-9_-]{1,128}$/.test(cleaned) ? cleaned : null
}

// ---------------------------------------------------------------------------
// QR versions (see lib/tickets/qr.ts). Pure, so the Expo app's offline copy in
// mobile/lib/doorList.ts can be held to parity.
// ---------------------------------------------------------------------------

export type ScannedCodeCheck = 'OK' | 'TRANSFERRED' | 'INVALID_CODE'

/** The ticket's QR version; absent, negative or junk = 0 (never transferred). */
export function ticketQrVersionOf(ticket: Record<string, any> | null | undefined): number {
  const v = Number(ticket?.qr_version)
  return Number.isInteger(v) && v > 0 ? v : 0
}

/** A signed payload `{"ticketId","v","s"}`, or null for anything else (legacy codes). */
export function parseSignedTicketQr(raw: unknown): { ticketId: string; v: number; s: string } | null {
  const cleaned = String(raw ?? '').trim()
  if (!cleaned.startsWith('{')) return null
  try {
    const json = JSON.parse(cleaned)
    const ticketId = json?.ticketId
    const v = json?.v
    const s = json?.s
    if (typeof ticketId !== 'string' || !ticketId) return null
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null
    if (typeof s !== 'string' || !s) return null
    return { ticketId, v, s }
  } catch {
    return null
  }
}

/**
 * The canonical form of a scanned/stored code: a signed payload by its fields
 * (so key order and whitespace in the JSON never matter), anything else trimmed.
 */
export function canonicalDoorCode(raw: unknown): string {
  const signed = parseSignedTicketQr(raw)
  if (signed) return `signed\n${signed.ticketId}\n${signed.v}\n${signed.s}`
  return `raw\n${String(raw ?? '').trim()}`
}

/** What the door list carries instead of the code: hex SHA-256 of its canonical form. */
export function doorCodeHash(raw: unknown): string {
  return createHash('sha256').update(canonicalDoorCode(raw), 'utf8').digest('hex')
}

/**
 * Offline judgement (no signing key on a phone): the door row carries a hash of
 * the ticket's CURRENT code, so from version 1 on only that exact signed payload
 * admits. A legacy code or an older version reads as transferred; a payload
 * at the current version whose hash differs is invalid.
 */
export function judgeScannedCodeAgainstRow(
  scanned: string | null | undefined,
  row: { id: string; codeHash: string; qrVersion?: number | null }
): ScannedCodeCheck {
  const raw = String(scanned ?? '').trim()
  if (!raw) return 'OK'
  const current = Number.isInteger(row.qrVersion) && (row.qrVersion as number) > 0 ? (row.qrVersion as number) : 0
  const signed = parseSignedTicketQr(raw)
  if (!signed) return current >= 1 ? 'TRANSFERRED' : 'OK'
  if (signed.ticketId !== row.id) return 'INVALID_CODE'
  if (signed.v < current) return 'TRANSFERRED'
  if (signed.v > current) return 'INVALID_CODE'
  return row.codeHash && doorCodeHash(raw) === row.codeHash ? 'OK' : 'INVALID_CODE'
}
