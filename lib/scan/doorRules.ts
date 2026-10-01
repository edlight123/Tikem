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
  /** What the QR encodes (qr_code_data), which is the ticket id on every current ticket. */
  code: string
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
}

export function toDoorRow(
  id: string,
  ticket: Record<string, any>,
  opts: { tier?: Record<string, any> | null; profileName?: string | null; event?: Record<string, any> | null } = {}
): DoorRow {
  const tier = opts.tier || null
  return {
    id,
    code: String(ticket?.qr_code_data || ticket?.qr_code || id),
    name: displayNameOf(ticket, opts.profileName),
    tier: ticketTierNameOf(ticket) || String(tier?.name || ''),
    status: String(ticket?.status || ''),
    live: isLiveStatus(ticket?.status),
    checkedIn: isCheckedIn(ticket),
    checkedInAt: toIso(ticket?.checked_in_at),
    endsAt:
      toIso(ticket?.end_datetime || ticket?.event_date || ticket?.start_datetime) ??
      toIso(opts.event?.end_datetime),
    validFrom: toIso(tier?.valid_from),
    validUntil: toIso(tier?.valid_until),
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

export type CheckInOptions = {
  /** Staff tapped "Allow re-entry" on an already-checked-in ticket. */
  reentry?: boolean
  /** Staff tapped "Override — check in anyway" outside the tier's entry window. */
  override?: boolean
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
