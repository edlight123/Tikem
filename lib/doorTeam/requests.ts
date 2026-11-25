/**
 * Door team service: the server side (Admin SDK only).
 *
 *   requested ──admin quote──▶ quoted ──paid──▶ paid ──admin confirm──▶ confirmed ──▶ done
 *       │                        │                │                         │
 *       ├─admin decline─▶ declined                └──────── organizer cancel ┘──▶ cancelled
 *       └─organizer cancel─▶ cancelled      quoted ──quote not paid in time──▶ expired
 *
 * Every state change is a transaction that re-checks the status it moves from
 * (canMoveRequest), and appends to the request's own `history`. Admin actions
 * are also written to admin_audit_log by the API routes.
 *
 * Crew access reuses the event door-staff seat (events/{eventId}/members/{uid},
 * the doc an accepted staff invite writes): role 'staff', permissions
 * { checkin: true, viewAttendees: false }, plus source 'tikem_door_team',
 * door_team_request_id and an access window (access_from / access_until) that
 * evaluateDoorAccess and the Firestore rules honour. Door staff never see
 * finances; viewAttendees false keeps them on the slim door list.
 */

import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import {
  DEFAULT_DOOR_TEAM_CONFIG,
  DOOR_TEAM_CONFIG_COLLECTION,
  DOOR_TEAM_CONFIG_DOC,
  normalizeStoredDoorTeamConfig,
  quoteDoorTeam,
  type DoorTeamConfig,
} from './config'
import {
  DOOR_TEAM_MEMBER_SOURCE,
  DOOR_TEAM_REQUESTS,
  canMoveRequest,
  crewAccessWindow,
  firstNameOf,
  quoteExpiresAt,
  toDate,
  validateQuotePrice,
  validateRequestInput,
  type DoorTeamFundsRail,
  type DoorTeamStatus,
  type RequestInput,
} from './rules'

// ── config ───────────────────────────────────────────────────────────────────

export async function loadDoorTeamConfig(): Promise<DoorTeamConfig> {
  try {
    const snap = await adminDb.collection(DOOR_TEAM_CONFIG_COLLECTION).doc(DOOR_TEAM_CONFIG_DOC).get()
    return snap.exists ? normalizeStoredDoorTeamConfig(snap.data()) : { ...DEFAULT_DOOR_TEAM_CONFIG }
  } catch (err: any) {
    console.error('[door-team] config read failed; using defaults', { message: err?.message })
    return { ...DEFAULT_DOOR_TEAM_CONFIG }
  }
}

export async function saveDoorTeamConfig(value: DoorTeamConfig, admin: { uid: string; email: string | null }) {
  const nowIso = new Date().toISOString()
  const ref = adminDb.collection(DOOR_TEAM_CONFIG_COLLECTION).doc(DOOR_TEAM_CONFIG_DOC)
  const before = await ref.get()
  const clean = { ...value }
  delete clean.updated_at
  delete clean.updated_by
  delete clean.updated_by_email
  await ref.set({ ...clean, updated_at: nowIso, updated_by: admin.uid, updated_by_email: admin.email })
  // A change history next to the config (the admin audit log gets one too).
  await ref.collection('history').add({
    before: before.exists ? before.data() : null,
    after: clean,
    changed_by: admin.uid,
    changed_by_email: admin.email,
    changed_at: nowIso,
  })
  return { ...clean, updated_at: nowIso, updated_by: admin.uid, updated_by_email: admin.email }
}

// ── requests ─────────────────────────────────────────────────────────────────

export interface DoorTeamRequest {
  id: string
  event_id: string
  organizer_id: string
  event_title: string
  event_start_at: string | null
  event_end_at: string | null
  staff_count: number
  arrival_at: string
  hours: number
  notes: string
  contact_name: string
  contact_phone: string
  standard_quote: Record<string, any> | null
  price_htg: number | null
  price_kind: 'standard' | 'negotiated' | null
  quote_note: string
  status: DoorTeamStatus
  payment: Record<string, any>
  crew: Array<{ uid: string; first_name: string; assigned_at: string; assigned_by: string }>
  crew_uids: string[]
  history: Array<Record<string, any>>
  created_by: string
  created_at: string
  updated_at: string
  [k: string]: any
}

export const requestRef = (id: string) => adminDb.collection(DOOR_TEAM_REQUESTS).doc(id)

export async function getRequest(id: string): Promise<DoorTeamRequest | null> {
  if (!id || id.includes('/')) return null
  const snap = await requestRef(id).get()
  return snap.exists ? ({ id: snap.id, ...(snap.data() as any) } as DoorTeamRequest) : null
}

const historyEntry = (by: string, action: string, extra: Record<string, any> = {}) => ({ at: new Date().toISOString(), by, action, ...extra })

const ERRORS: Record<string, string> = {
  disabled: 'The door team service is not available right now.',
  invalid_staff: 'Enter a whole number of staff.',
  below_min_staff: 'The minimum crew is {min} staff.',
  above_max_staff: 'The maximum crew is {max} staff.',
  invalid_hours: 'Enter a whole number of hours.',
  above_max_hours: 'The longest shift is {hours} hours.',
  event_has_no_date: 'Set the event date first.',
  too_late: 'Requests must be made at least {lead} hours before the event.',
  invalid_arrival: 'Choose when the crew should arrive.',
  arrival_too_early: 'The crew can arrive at most 12 hours before the event starts.',
  arrival_after_event: 'The crew must arrive before the event ends.',
  contact_name_required: 'Add the name of the contact on site.',
  contact_phone_invalid: 'Add a phone number for the contact on site.',
}

export function requestErrorMessage(code: string, config: DoorTeamConfig): string {
  return (ERRORS[code] || 'This request cannot be made.')
    .replace('{min}', String(config.minStaff))
    .replace('{max}', String(config.maxStaff))
    .replace('{hours}', String(config.maxHours))
    .replace('{lead}', String(config.minLeadHours))
}

export type CreateRequestResult = { ok: true; request: DoorTeamRequest } | { ok: false; status: number; code: string; error: string; field?: string }

/** One open request per event: a second one is refused until the first is closed. */
export async function openRequestForEvent(eventId: string): Promise<DoorTeamRequest | null> {
  const snap = await adminDb.collection(DOOR_TEAM_REQUESTS).where('event_id', '==', eventId).get()
  const open = snap.docs
    .map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .find((r: any) => ['requested', 'quoted', 'paid', 'confirmed'].includes(String(r.status)))
  return (open as DoorTeamRequest) || null
}

/** The organizer asks for a crew. Priced from the LIVE config (standard quote). */
export async function createRequest(params: {
  eventId: string
  event: Record<string, any>
  orgId: string
  input: Partial<RequestInput>
  createdBy: string
  now?: number
}): Promise<CreateRequestResult> {
  const config = await loadDoorTeamConfig()
  const now = params.now ?? Date.now()
  const eventStart = toDate(params.event?.start_datetime ?? params.event?.start_date)
  const eventEnd = toDate(params.event?.end_datetime ?? params.event?.end_date)
  const v = validateRequestInput(params.input, { config, now, eventStart, eventEnd })
  if (!v.ok) return { ok: false, status: 400, code: v.code, error: requestErrorMessage(v.code, config), field: v.field }
  const quote = quoteDoorTeam(config, { staff: v.value.staff_count, hours: v.value.hours })
  if (!quote.ok) return { ok: false, status: 400, code: quote.code, error: requestErrorMessage(quote.code, config) }
  if (await openRequestForEvent(params.eventId)) {
    return { ok: false, status: 409, code: 'already_requested', error: 'This event already has an open door team request.' }
  }

  const ref = adminDb.collection(DOOR_TEAM_REQUESTS).doc()
  const nowIso = new Date(now).toISOString()
  const { ok: _ok, ...standard } = quote
  const request: DoorTeamRequest = {
    id: ref.id,
    event_id: params.eventId,
    organizer_id: params.orgId,
    event_title: String(params.event?.title || ''),
    event_start_at: eventStart ? eventStart.toISOString() : null,
    event_end_at: eventEnd ? eventEnd.toISOString() : null,
    ...v.value,
    standard_quote: standard,
    price_htg: null,
    price_kind: null,
    quote_note: '',
    status: 'requested',
    payment: {},
    crew: [],
    crew_uids: [],
    needs_refund: false,
    history: [historyEntry(params.createdBy, 'requested', { standard_htg: standard.totalHtg })],
    created_by: params.createdBy,
    created_at: nowIso,
    updated_at: nowIso,
  }
  await ref.set(request)
  return { ok: true, request }
}

export type Moved = { ok: true; request: DoorTeamRequest } | { ok: false; status: number; code: string; error: string }

/** Move a request inside a transaction that re-checks where it is now. */
async function move(
  id: string,
  to: DoorTeamStatus,
  by: string,
  patch: (r: DoorTeamRequest) => Record<string, any> | { refuse: string },
  action: string,
  extra: Record<string, any> = {}
): Promise<Moved> {
  const ref = requestRef(id)
  const out = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { code: 'not_found' as const }
    const r = { id: snap.id, ...(snap.data() || {}) } as DoorTeamRequest
    if (!canMoveRequest(r.status, to)) return { code: 'wrong_status' as const, status: r.status }
    const p = patch(r)
    if ('refuse' in p) return { code: p.refuse }
    const nowIso = new Date().toISOString()
    const next = { ...p, status: to, updated_at: nowIso, history: [...(r.history || []), historyEntry(by, action, extra)] }
    tx.update(ref, next)
    return { code: 'ok' as const, request: { ...r, ...next } as DoorTeamRequest }
  })
  if (out.code === 'ok') return { ok: true, request: out.request }
  if (out.code === 'not_found') return { ok: false, status: 404, code: 'not_found', error: 'Request not found' }
  if (out.code === 'wrong_status') return { ok: false, status: 409, code: 'wrong_status', error: `This request is ${(out as any).status}` }
  return { ok: false, status: 400, code: out.code, error: out.code }
}

/**
 * Admin: accept at the standard price, or set a negotiated one (note required,
 * audited). Only a platform admin route calls this; the organizer API has no
 * path to the price.
 */
export async function quoteRequest(id: string, admin: { uid: string }, input: { priceHtg?: unknown; note?: unknown }, now = Date.now()): Promise<Moved> {
  const current = await getRequest(id)
  if (!current) return { ok: false, status: 404, code: 'not_found', error: 'Request not found' }
  // The standard price at quoting time, from the live config (the admin may have changed rates since).
  const config = await loadDoorTeamConfig()
  const live = quoteDoorTeam({ ...config, enabled: true }, { staff: current.staff_count, hours: current.hours })
  const standardHtg = live.ok ? live.totalHtg : Number(current.standard_quote?.totalHtg) || 0
  const price = validateQuotePrice(input, standardHtg)
  if (!price.ok) {
    const msg = price.code === 'note_required' ? 'Add a note explaining the negotiated price.' : 'Enter a whole HTG price above 0.'
    return { ok: false, status: 400, code: price.code, error: msg }
  }
  const expires = quoteExpiresAt(now, toDate(current.event_start_at))
  return move(
    id,
    'quoted',
    admin.uid,
    () => ({
      price_htg: price.priceHtg,
      price_kind: price.kind,
      quote_note: price.note,
      standard_htg_at_quote: standardHtg,
      quoted_at: new Date(now).toISOString(),
      quoted_by: admin.uid,
      quote_expires_at: expires,
    }),
    'quoted',
    { price_htg: price.priceHtg, price_kind: price.kind, standard_htg: standardHtg, note: price.note }
  )
}

export async function declineRequest(id: string, admin: { uid: string }, reason: unknown): Promise<Moved> {
  const text = String(reason ?? '').trim().slice(0, 500)
  if (text.length < 3) return { ok: false, status: 400, code: 'reason_required', error: 'Add a reason the organizer will see.' }
  return move(
    id,
    'declined',
    admin.uid,
    (r) => (r.payment?.status === 'pending' && r.payment?.order_id ? { decline_reason: text, payment: { ...r.payment, status: 'abandoned' } } : { decline_reason: text }),
    'declined',
    { reason: text }
  )
}

export type PaidProof = { funds_rail: DoorTeamFundsRail; reference: string; amount: number; currency: string; price_htg: number; extra?: Record<string, any> }

/**
 * The request was paid: record it once.
 *
 * Safe to call from the MonCash return, the Stripe webhook, "check payment"
 * and the sweep at the same time: only the call that performs quoted → paid
 * records it. A payment that lands on a request that is no longer quoted
 * (declined, cancelled, expired), a second different payment, or one for a
 * different price than the request's, is recorded under late_payments and the
 * request is flagged needs_refund. A balance payment is never flagged: its
 * caller credits it straight back.
 */
export async function markRequestPaid(id: string, proof: PaidProof): Promise<{ ok: boolean; alreadyPaid?: boolean; code?: string; needsRefund?: boolean }> {
  const selfCrediting = proof.funds_rail === 'balance_offset'
  const ref = requestRef(id)
  const outcome: string = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return 'not_found'
    const r = snap.data() || {}
    const nowIso = new Date().toISOString()
    const record = { ...proof, received_at: nowIso }
    const late = Array.isArray(r.late_payments) ? r.late_payments : []
    const flagLate = () => {
      if (selfCrediting) return
      if (!late.some((p: any) => p?.reference === proof.reference)) {
        tx.update(ref, { needs_refund: true, late_payments: [...late, record], updated_at: nowIso })
      }
    }
    // The payment this request already recorded (any status, even after a
    // cancel or a manual refund): nothing new happened, never a "late" payment.
    if (r.payment?.reference && String(r.payment.reference) === String(proof.reference)) return 'already'
    if (r.status === 'quoted') {
      if (Number(r.price_htg) !== Number(proof.price_htg)) {
        flagLate()
        return 'price_mismatch'
      }
      tx.update(ref, {
        status: 'paid',
        payment: {
          ...(r.payment || {}),
          status: 'paid',
          funds_rail: proof.funds_rail,
          reference: proof.reference,
          amount: proof.amount,
          currency: proof.currency,
          paid_at: nowIso,
          ...(proof.extra || {}),
        },
        paid_at: nowIso,
        updated_at: nowIso,
        history: [...(r.history || []), historyEntry('system', 'paid', { funds_rail: proof.funds_rail, reference: proof.reference })],
      })
      return 'ok'
    }
    flagLate()
    return ['paid', 'confirmed', 'done'].includes(r.status) ? 'duplicate' : 'closed'
  })
  if (outcome === 'ok') return { ok: true }
  if (outcome === 'already') return { ok: true, alreadyPaid: true }
  if (outcome === 'not_found') return { ok: false, code: 'not_found' }
  if (!selfCrediting) console.error('[door-team] payment not applicable; flagged needs_refund', { id, outcome, reference: proof.reference })
  return { ok: false, code: outcome, needsRefund: !selfCrediting }
}

// ── crew ─────────────────────────────────────────────────────────────────────

const memberRef = (eventId: string, uid: string) => adminDb.collection('events').doc(eventId).collection('members').doc(uid)

/** Pure: is this events/{id}/members doc a door seat this request granted? */
export function isOurSeat(member: Record<string, any> | null | undefined, requestId: string): boolean {
  return !!member && member.source === DOOR_TEAM_MEMBER_SOURCE && member.door_team_request_id === requestId
}

export async function findCrewAccount(emailRaw: string): Promise<{ uid: string; firstName: string } | null> {
  const email = String(emailRaw || '').trim().toLowerCase()
  if (!email || !email.includes('@')) return null
  let uid: string | null = null
  let display = ''
  try {
    const rec = await adminAuth.getUserByEmail(email)
    uid = rec.uid
    display = rec.displayName || ''
  } catch {
    const snap = await adminDb.collection('users').where('email', '==', email).limit(1).get()
    if (!snap.empty) uid = snap.docs[0].id
  }
  if (!uid) return null
  const user = await adminDb.collection('users').doc(uid).get()
  const u = user.exists ? user.data() || {} : {}
  const firstName = firstNameOf(u.first_name || u.full_name || u.display_name || display) || 'Tikèm'
  return { uid, firstName }
}

/**
 * Put a Tikèm crew member on this event's door, for this event's window only.
 * Writes the same door seat an accepted staff invite writes, scoped:
 * door check-in only, no attendee list, and access_from / access_until.
 * Refuses to touch a seat the organizer created (an existing member of theirs).
 */
export async function assignCrew(id: string, crew: { uid: string; firstName: string }, admin: { uid: string }): Promise<Moved> {
  const r = await getRequest(id)
  if (!r) return { ok: false, status: 404, code: 'not_found', error: 'Request not found' }
  if (r.status !== 'paid' && r.status !== 'confirmed') return { ok: false, status: 409, code: 'not_paid', error: 'Assign the crew once the request is paid' }
  if (crew.uid === r.organizer_id) return { ok: false, status: 400, code: 'is_organizer', error: 'That account is the organizer' }
  if ((r.crew_uids || []).includes(crew.uid)) return { ok: true, request: r }
  if ((r.crew || []).length >= r.staff_count) return { ok: false, status: 409, code: 'crew_full', error: `This request is for ${r.staff_count} staff` }

  const window = crewAccessWindow(r)
  const seatRef = memberRef(r.event_id, crew.uid)
  const ref = requestRef(id)
  const out = await adminDb.runTransaction(async (tx: any) => {
    const [snap, seat] = [await tx.get(ref), await tx.get(seatRef)]
    if (!snap.exists) return { code: 'not_found' }
    const cur = { id: snap.id, ...(snap.data() || {}) } as DoorTeamRequest
    if (cur.status !== 'paid' && cur.status !== 'confirmed') return { code: 'not_paid' }
    const existing = seat.exists ? seat.data() || {} : null
    if (existing && !isOurSeat(existing, id)) return { code: 'already_member' }
    // Re-checked here: two admins adding crew at once can neither pass the
    // requested crew size nor add the same person twice.
    if ((cur.crew_uids || []).includes(crew.uid)) return { code: 'ok', request: cur }
    if ((cur.crew || []).length >= Number(cur.staff_count)) return { code: 'crew_full' }
    const nowIso = new Date().toISOString()
    tx.set(seatRef, {
      uid: crew.uid,
      eventId: r.event_id,
      role: 'staff',
      permissions: { checkin: true, viewAttendees: false },
      source: DOOR_TEAM_MEMBER_SOURCE,
      door_team_request_id: id,
      // What the organizer's staff screens show for this seat (no uid/email).
      first_name: crew.firstName,
      access_from: window.from,
      access_until: window.until,
      createdAt: new Date(),
      createdBy: admin.uid,
      updated_at: FieldValue.serverTimestamp(),
    })
    const entry = { uid: crew.uid, first_name: crew.firstName, assigned_at: nowIso, assigned_by: admin.uid }
    const next = {
      crew: [...(cur.crew || []), entry],
      crew_uids: [...(cur.crew_uids || []), crew.uid],
      access_from: window.from.toISOString(),
      access_until: window.until.toISOString(),
      updated_at: nowIso,
      history: [...(cur.history || []), historyEntry(admin.uid, 'crew_assigned', { crew_uid: crew.uid })],
    }
    tx.update(ref, next)
    return { code: 'ok', request: { ...cur, ...next } }
  })
  if (out.code === 'ok') return { ok: true, request: (out as any).request }
  if (out.code === 'crew_full') return { ok: false, status: 409, code: 'crew_full', error: `This request is for ${r.staff_count} staff` }
  if (out.code === 'already_member') {
    return { ok: false, status: 409, code: 'already_member', error: "That person is already on this event's team; Tikèm will not change their access" }
  }
  return { ok: false, status: out.code === 'not_found' ? 404 : 409, code: out.code, error: out.code === 'not_found' ? 'Request not found' : 'Assign the crew once the request is paid' }
}

/** Take a crew member off: their door seat for this event is removed. */
export async function removeCrew(id: string, uid: string, admin: { uid: string }): Promise<Moved> {
  const ref = requestRef(id)
  const r = await getRequest(id)
  if (!r) return { ok: false, status: 404, code: 'not_found', error: 'Request not found' }
  if (!(r.crew_uids || []).includes(uid)) return { ok: true, request: r }
  const seatRef = memberRef(r.event_id, uid)
  const out = await adminDb.runTransaction(async (tx: any) => {
    const [snap, seat] = [await tx.get(ref), await tx.get(seatRef)]
    const cur = { id: snap.id, ...(snap.data() || {}) } as DoorTeamRequest
    if (seat.exists && isOurSeat(seat.data(), id)) tx.delete(seatRef)
    const next = {
      crew: (cur.crew || []).filter((c) => c.uid !== uid),
      crew_uids: (cur.crew_uids || []).filter((u) => u !== uid),
      updated_at: new Date().toISOString(),
      history: [...(cur.history || []), historyEntry(admin.uid, 'crew_removed', { crew_uid: uid })],
    }
    tx.update(ref, next)
    return { ...cur, ...next }
  })
  return { ok: true, request: out as DoorTeamRequest }
}

/** Remove every door seat this request granted (cancel, done). Never touches the organizer's own seats. */
export async function revokeCrewAccess(r: Pick<DoorTeamRequest, 'id' | 'event_id' | 'crew_uids'>): Promise<number> {
  let removed = 0
  for (const uid of r.crew_uids || []) {
    const ref = memberRef(r.event_id, uid)
    const snap = await ref.get()
    if (snap.exists && isOurSeat(snap.data(), r.id)) {
      await ref.delete()
      removed++
    }
  }
  return removed
}

/** Admin: crew assigned → confirmed (the organizer is told the crew's first names). */
export async function confirmRequest(id: string, admin: { uid: string }): Promise<Moved> {
  return move(id, 'confirmed', admin.uid, (r) => ((r.crew || []).length === 0 ? { refuse: 'no_crew' } : {}), 'confirmed')
}

/** After the event: done, and the crew's door access is removed. */
export async function completeRequest(id: string, by: string): Promise<Moved> {
  const moved = await move(id, 'done', by, () => ({ done_at: new Date().toISOString() }), 'done')
  if (moved.ok) await revokeCrewAccess(moved.request)
  return moved
}

/** Admin: a refund flagged on the request was made by hand (MonCash / Stripe dashboard). */
export async function markRefunded(id: string, admin: { uid: string }, reference: unknown): Promise<Moved> {
  const ref = requestRef(id)
  const text = String(reference ?? '').trim().slice(0, 200)
  const out = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    const cur = { id: snap.id, ...(snap.data() || {}) } as DoorTeamRequest
    if (!cur.needs_refund) return { refuse: true, cur }
    const nowIso = new Date().toISOString()
    const next = {
      needs_refund: false,
      refund: { ...(cur.refund || {}), status: 'refunded', reference: text || null, refunded_at: nowIso, refunded_by: admin.uid },
      updated_at: nowIso,
      history: [...(cur.history || []), historyEntry(admin.uid, 'refunded', { reference: text || null })],
    }
    tx.update(ref, next)
    return { cur: { ...cur, ...next } }
  })
  if (!out) return { ok: false, status: 404, code: 'not_found', error: 'Request not found' }
  if ((out as any).refuse) return { ok: false, status: 409, code: 'no_refund_due', error: 'No refund is due on this request' }
  return { ok: true, request: (out as any).cur }
}

/** Requests for one event, newest first. */
export async function loadEventRequests(eventId: string): Promise<DoorTeamRequest[]> {
  const snap = await adminDb.collection(DOOR_TEAM_REQUESTS).where('event_id', '==', eventId).get()
  return snap.docs
    .map((d: any) => ({ id: d.id, ...(d.data() || {}) }) as DoorTeamRequest)
    .sort((a: DoorTeamRequest, b: DoorTeamRequest) => String(b.created_at).localeCompare(String(a.created_at)))
}

/** The admin queue: everything open, plus anything with a refund due, plus the last 50 closed. */
export async function loadAdminQueue(): Promise<DoorTeamRequest[]> {
  const snap = await adminDb.collection(DOOR_TEAM_REQUESTS).orderBy('created_at', 'desc').limit(300).get()
  return snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }) as DoorTeamRequest)
}

export { toDate }
