/**
 * Request-to-attend approval lists: the server side.
 * Spec: docs/specs/approval-lists-and-plus-ones.md.
 *
 * `attend_requests/{eventId}__{uid}` is server-only (the rules' default deny
 * covers it). Every read and write goes through the routes that call this
 * module, with the Admin SDK:
 *
 *   app/api/events/[id]/attend-request            the guest's own request
 *   app/api/organizer/events/[id]/requests        the organizer's list + decisions
 *
 * Approving issues the free tickets through `issueFreeClaim`, the same core the
 * /api/tickets/claim-free route runs, so inventory (shards), the one-claim lock,
 * MAX_FREE_TICKETS_PER_PERSON and delivery are exactly the free-claim rules.
 */

import { adminDb } from '@/lib/firebase/admin'
import { hasEventAccess } from '@/lib/events/access-guard'
import { checkEventPurchasable } from '@/lib/tickets/purchasable'
import { freeClaimAlreadyUsed, MAX_FREE_TICKETS_PER_CLAIM } from '@/lib/tickets/free-claim-policy'
import { issueFreeClaim } from '@/lib/tickets/free-claim-issue'
import { identityFromUser } from '@/lib/guest/checkout'
import { normalizePhone } from '@/lib/guest/identity'
import {
  ATTEND_REQUESTS_COLLECTION,
  approvalBlockedByPrice,
  attendRequestId,
  eventAllowedPlusOnes,
  eventRequiresApproval,
  parseAttendInput,
  sortAttendRequests,
  type AttendRequestStatus,
  type PlusOne,
} from '@/lib/events/approval'
import {
  notifyOrganizerNewRequest,
  notifyRequestApproved,
  notifyRequestDeclined,
} from '@/lib/notifications/attend-requests'

export type Refusal = { ok: false; status: number; error: string; code: string }

function refuse(status: number, code: string, error: string): Refusal {
  return { ok: false, status, error, code }
}

export interface AttendRequestDoc {
  event_id: string
  organizer_id: string
  requester_id: string
  requester_name: string
  requester_email: string
  requester_avatar_url: string | null
  plus_ones: PlusOne[]
  note: string
  quantity: number
  status: AttendRequestStatus
  ticket_ids?: string[]
  created_at: string
  updated_at: string
  decided_at?: string | null
  decided_by?: string | null
  last_error?: string | null
}

/** What the guest sees of their own request. */
export function requesterView(id: string, d: Partial<AttendRequestDoc>) {
  return {
    id,
    status: (d.status === 'approving' ? 'pending' : d.status) || 'pending',
    plus_ones: (d.plus_ones || []).map((p) => ({ first_name: p.first_name, phone: p.phone || null })),
    note: d.note || '',
    quantity: Number(d.quantity || 1),
    created_at: d.created_at || null,
    decided_at: d.decided_at || null,
  }
}

/** What the organizer sees of a request. */
export function organizerView(id: string, d: Partial<AttendRequestDoc>) {
  return {
    id,
    status: d.status || 'pending',
    requester_id: d.requester_id || '',
    name: d.requester_name || '',
    email: d.requester_email || '',
    avatar_url: d.requester_avatar_url || null,
    plus_ones: (d.plus_ones || []).map((p) => ({ first_name: p.first_name, phone: p.phone || null })),
    note: d.note || '',
    quantity: Number(d.quantity || 1),
    created_at: d.created_at || null,
    decided_at: d.decided_at || null,
    last_error: d.last_error || null,
  }
}

async function loadEvent(eventId: string): Promise<any | null> {
  const snap = await adminDb.collection('events').doc(eventId).get()
  return snap.exists ? { id: snap.id, ...snap.data() } : null
}

async function loadTiers(eventId: string): Promise<any[]> {
  const snap = await adminDb.collection('ticket_tiers').where('event_id', '==', eventId).get()
  return (snap?.docs || []).map((d: any) => ({ id: d.id, ...d.data() }))
}

/** True when this account may manage the event's list: its owner, or an admin. */
export function canManageEvent(user: { id: string; role?: string } | null, event: any): boolean {
  if (!user || !event) return false
  if (user.role === 'admin' || user.role === 'super_admin') return true
  return String(event.organizer_id ?? event.organizerId ?? '') === String(user.id)
}

export interface RequesterUser {
  id: string
  email?: string | null
  full_name?: string | null
}

/** GET for the guest: their own request (or null) and what they may ask for. */
export async function getOwnRequest(eventId: string, user: RequesterUser) {
  const event = await loadEvent(eventId)
  if (!event) return refuse(404, 'event_not_found', 'Event not found')
  const snap = await adminDb.collection(ATTEND_REQUESTS_COLLECTION).doc(attendRequestId(eventId, user.id)).get()
  return {
    ok: true as const,
    requiresApproval: eventRequiresApproval(event),
    allowedPlusOnes: eventAllowedPlusOnes(event),
    request: snap.exists ? requesterView(snap.id, snap.data() || {}) : null,
  }
}

/** POST for the guest: ask for a spot (re-opens a request they cancelled). */
export async function createAttendRequest(
  eventId: string,
  user: RequesterUser,
  body: { plusOnes?: unknown; note?: unknown }
): Promise<Refusal | { ok: true; created: boolean; request: ReturnType<typeof requesterView> }> {
  const event = await loadEvent(eventId)
  if (!event) return refuse(404, 'event_not_found', 'Event not found')

  const purchasable = checkEventPurchasable(event)
  if (!purchasable.ok) return refuse(purchasable.status, purchasable.code, purchasable.error)

  if (!eventRequiresApproval(event)) {
    return refuse(409, 'approval_not_enabled', 'This event does not take requests. Claim your ticket instead.')
  }
  // v1 is free events only. Decided on the tiers themselves, not on what the
  // composer said: a paid tier added later must close the list.
  if (approvalBlockedByPrice(event, await loadTiers(eventId))) {
    return refuse(409, 'approval_paid_event', 'Requests are only for free events.')
  }
  if (!(await hasEventAccess(event, eventId, user.id))) {
    return refuse(403, 'access_code_required', 'access_code_required')
  }

  const parsed = parseAttendInput(body || {}, eventAllowedPlusOnes(event), (p) => normalizePhone(p))
  if (!parsed.ok) return refuse(400, parsed.code, parsed.error)
  const quantity = 1 + parsed.plusOnes.length
  if (quantity > MAX_FREE_TICKETS_PER_CLAIM) {
    return refuse(400, 'too_many_plus_ones', `You can bring at most ${MAX_FREE_TICKETS_PER_CLAIM - 1} plus-one.`)
  }

  if (await freeClaimAlreadyUsed(eventId, { isGuest: false, id: user.id })) {
    return refuse(409, 'already_claimed', 'You already have a ticket for this event.')
  }

  // Name and avatar from the profile; email from Firebase Auth (never the
  // client-writable profile copy), because the approval email goes there.
  let name = String(user.full_name || '').trim()
  let avatar: string | null = null
  try {
    const profile = await adminDb.collection('users').doc(user.id).get()
    const p = profile.exists ? profile.data() || {} : {}
    name = name || String(p.full_name || p.display_name || '').trim()
    avatar = String(p.photo_url || p.photoURL || p.avatar_url || '').trim() || null
  } catch {
    /* the request still works without a face */
  }

  const ref = adminDb.collection(ATTEND_REQUESTS_COLLECTION).doc(attendRequestId(eventId, user.id))
  const now = new Date().toISOString()
  const result = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const existing = snap?.exists ? (snap.data() as AttendRequestDoc) : null
    if (existing && ['pending', 'approving', 'approved'].includes(existing.status)) {
      return { kind: 'existing' as const, doc: existing }
    }
    if (existing && existing.status === 'declined') {
      return { kind: 'declined' as const }
    }
    const doc: AttendRequestDoc = {
      event_id: eventId,
      organizer_id: String(event.organizer_id || ''),
      requester_id: user.id,
      requester_name: name,
      requester_email: String(user.email || ''),
      requester_avatar_url: avatar,
      plus_ones: parsed.plusOnes,
      note: parsed.note,
      quantity,
      status: 'pending',
      created_at: now,
      updated_at: now,
      decided_at: null,
      decided_by: null,
      last_error: null,
    }
    tx.set(ref, doc)
    return { kind: 'created' as const, doc }
  })

  if (result.kind === 'declined') {
    return refuse(409, 'request_declined', 'The host already answered this request.')
  }
  if (result.kind === 'created') {
    await notifyOrganizerNewRequest({
      organizerId: String(event.organizer_id || ''),
      eventId,
      eventTitle: String(event.title || ''),
      requesterName: name,
      quantity,
      requestId: ref.id,
    })
  }
  return { ok: true, created: result.kind === 'created', request: requesterView(ref.id, result.doc) }
}

/** DELETE for the guest: withdraw a request the host has not answered yet. */
export async function cancelOwnRequest(eventId: string, user: RequesterUser) {
  const ref = adminDb.collection(ATTEND_REQUESTS_COLLECTION).doc(attendRequestId(eventId, user.id))
  const outcome = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap?.exists) return 'missing'
    const d = snap.data() as AttendRequestDoc
    // The id is derived from the caller's uid, but check anyway.
    if (d.requester_id !== user.id) return 'missing'
    if (d.status !== 'pending') return 'not_pending'
    tx.update(ref, { status: 'cancelled', updated_at: new Date().toISOString() })
    return 'cancelled'
  })
  if (outcome === 'missing') return refuse(404, 'request_not_found', 'No request to cancel.')
  if (outcome === 'not_pending') return refuse(409, 'request_not_pending', 'This request was already answered.')
  return { ok: true as const }
}

/** The organizer's list: pending first (oldest first), with counts. */
export async function listEventRequests(eventId: string) {
  const snap = await adminDb.collection(ATTEND_REQUESTS_COLLECTION).where('event_id', '==', eventId).get()
  const views: Array<ReturnType<typeof organizerView>> = (snap?.docs || []).map((d: any) =>
    organizerView(d.id, d.data() || {})
  )
  const rows = sortAttendRequests(views).filter((r) => r.status !== 'cancelled')
  const counts = { pending: 0, approved: 0, declined: 0 }
  for (const r of rows) {
    if (r.status === 'pending' || r.status === 'approving') counts.pending += 1
    else if (r.status === 'approved') counts.approved += 1
    else if (r.status === 'declined') counts.declined += 1
  }
  return { requests: rows, counts }
}

/** Move a pending request to `next` atomically. Null when it was not pending. */
async function claimPending(ref: any, eventId: string, next: AttendRequestStatus, extra: Record<string, any> = {}) {
  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap?.exists) return { kind: 'missing' as const }
    const d = snap.data() as AttendRequestDoc
    if (d.event_id !== eventId) return { kind: 'missing' as const }
    if (d.status !== 'pending') return { kind: 'not_pending' as const, status: d.status }
    tx.update(ref, { status: next, updated_at: new Date().toISOString(), ...extra })
    return { kind: 'claimed' as const, doc: d }
  })
}

export async function declineRequest(eventId: string, event: any, requestId: string, actorId: string) {
  const ref = adminDb.collection(ATTEND_REQUESTS_COLLECTION).doc(requestId)
  const now = new Date().toISOString()
  const claimed = await claimPending(ref, eventId, 'declined', { decided_at: now, decided_by: actorId })
  if (claimed.kind === 'missing') return refuse(404, 'request_not_found', 'Request not found')
  if (claimed.kind === 'not_pending') return refuse(409, 'request_not_pending', 'This request was already answered.')
  await notifyRequestDeclined({
    userId: claimed.doc.requester_id,
    eventId,
    eventTitle: String(event?.title || ''),
    requestId,
  })
  return { ok: true as const, request: organizerView(requestId, { ...claimed.doc, status: 'declined', decided_at: now }) }
}

/**
 * Approve one request: pending -> approving (so a second tap cannot issue
 * twice), issue through issueFreeClaim, then approved with its ticket ids. A
 * refusal (sold out, already claimed) puts it back to pending with last_error.
 */
export async function approveRequest(eventId: string, event: any, requestId: string, actorId: string) {
  const ref = adminDb.collection(ATTEND_REQUESTS_COLLECTION).doc(requestId)
  const claimed = await claimPending(ref, eventId, 'approving')
  if (claimed.kind === 'missing') return refuse(404, 'request_not_found', 'Request not found')
  if (claimed.kind === 'not_pending') return refuse(409, 'request_not_pending', 'This request was already answered.')
  const d = claimed.doc

  const backToPending = async (r: Refusal): Promise<Refusal> => {
    try {
      await ref.update({ status: 'pending', last_error: r.code, updated_at: new Date().toISOString() })
    } catch (e) {
      console.error('[attend-requests] could not reopen request', { requestId, message: (e as any)?.message })
    }
    return r
  }

  try {
    const purchasable = checkEventPurchasable(event)
    if (!purchasable.ok) return backToPending(refuse(purchasable.status, purchasable.code, purchasable.error))
    if (approvalBlockedByPrice(event, await loadTiers(eventId))) {
      return backToPending(refuse(409, 'approval_paid_event', 'Requests are only for free events.'))
    }
    // The requester passed the access code when they asked; the grant must still hold.
    if (!(await hasEventAccess(event, eventId, d.requester_id))) {
      return backToPending(refuse(403, 'access_code_required', 'access_code_required'))
    }
    const plusOnes = Array.isArray(d.plus_ones) ? d.plus_ones : []
    const quantity = 1 + plusOnes.length
    // The cap may have dropped since the request was made.
    if (quantity > MAX_FREE_TICKETS_PER_CLAIM) {
      return backToPending(
        refuse(409, 'too_many_plus_ones', `Guests can bring at most ${MAX_FREE_TICKETS_PER_CLAIM - 1} plus-one now.`)
      )
    }

    let phone: string | null = null
    try {
      const profile = await adminDb.collection('users').doc(d.requester_id).get()
      phone = profile.exists ? profile.data()?.phone_number || null : null
    } catch {
      /* optional */
    }
    const identity = identityFromUser({
      id: d.requester_id,
      email: d.requester_email,
      full_name: d.requester_name,
      phone_number: phone,
    })

    const outcome = await issueFreeClaim(
      { eventId, event, identity, ticketQuantity: quantity },
      {
        plusOnes,
        ticketFields: { approval_request_id: requestId },
        // The approval notification below replaces the generic purchase one,
        // and the organizer is the one who just approved.
        notifyBuyer: false,
        notifyOrganizer: false,
        approved: true,
      }
    )
    if (!outcome.ok) return backToPending(refuse(outcome.status, outcome.code, outcome.error))

    const now = new Date().toISOString()
    const ticketIds = outcome.tickets.map((t: any) => String(t.id))
    await ref.update({
      status: 'approved',
      ticket_ids: ticketIds,
      decided_at: now,
      decided_by: actorId,
      updated_at: now,
      last_error: null,
      // They already held free tickets for the event (claimed before the list
      // was switched on): nothing new was issued.
      ...(outcome.kind === 'existing' ? { already_held: true } : {}),
    })
    await notifyRequestApproved({
      userId: d.requester_id,
      eventId,
      eventTitle: String(event?.title || ''),
      quantity: ticketIds.length || quantity,
      requestId,
    })
    return {
      ok: true as const,
      request: organizerView(requestId, { ...d, status: 'approved', decided_at: now }),
      ticketCount: ticketIds.length,
    }
  } catch (error) {
    console.error('[attend-requests] approval failed', { requestId, message: (error as any)?.message })
    return backToPending(refuse(500, 'server_error', 'Could not approve this request. Try again.'))
  }
}

/** Codes after which "approve all" stops: nothing more can be issued. */
const STOP_CODES = new Set(['no_tickets_available', 'limited_availability', 'tier_sold_out', 'event_cancelled', 'event_unavailable', 'event_ended', 'approval_paid_event'])

/** Approve every pending request, oldest first, one by one. */
export async function approveAllPending(eventId: string, event: any, actorId: string) {
  const { requests } = await listEventRequests(eventId)
  const pending = requests.filter((r) => r.status === 'pending')
  const results: Array<{ id: string; ok: boolean; code?: string }> = []
  let stopped: string | null = null
  for (const r of pending) {
    if (stopped) {
      results.push({ id: r.id, ok: false, code: stopped })
      continue
    }
    const res = await approveRequest(eventId, event, r.id, actorId)
    if (res.ok) {
      results.push({ id: r.id, ok: true })
    } else {
      results.push({ id: r.id, ok: false, code: res.code })
      if (STOP_CODES.has(res.code)) stopped = res.code
    }
  }
  return {
    ok: true as const,
    approved: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    stoppedBecause: stopped,
    results,
  }
}
