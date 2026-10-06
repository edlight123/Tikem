import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin as isAdminEmail } from '@/lib/admin'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'
import {
  belongsOnDoorList,
  checkInFields,
  displayNameOf,
  evaluateDoorAccess,
  isRefundInFlight,
  judgeDoorRow,
  parseSignedTicketQr,
  parseTicketCode,
  resolveTier,
  ticketQrVersionOf,
  ticketEventIdOf,
  ticketTierIdOf,
  ticketTierNameOf,
  toDoorRow,
  type CheckInMethod,
  type DoorRole,
  type DoorRow,
  type DoorVerdict,
  type ScannedCodeCheck,
} from '@/lib/scan/doorRules'
import { verifyScannedTicketCode } from '@/lib/tickets/qr'

export type DoorAccess =
  | {
      ok: true
      uid: string
      role: DoorRole
      canViewAttendees: boolean
      event: Record<string, any> & { id: string }
    }
  | { ok: false; status: number; error: string }

/** Owner, admin, or staff with permissions.checkin === true. */
export async function authorizeDoorAccess(eventId: string): Promise<DoorAccess> {
  if (!eventId) return { ok: false, status: 400, error: 'Event ID is required' }
  const user: any = await getCurrentUser()
  if (!user?.id) return { ok: false, status: 401, error: 'Not authenticated' }

  const eventRef = adminDb.collection('events').doc(eventId)
  const [eventSnap, memberSnap] = await Promise.all([
    eventRef.get(),
    eventRef.collection('members').doc(String(user.id)).get(),
  ])
  const event = eventSnap.exists ? { id: eventSnap.id, ...(eventSnap.data() as any) } : null
  const decision = evaluateDoorAccess({
    uid: user.id,
    isAdmin: user.role === 'admin' || user.role === 'super_admin' || isAdminEmail(((user as any).email_verified) ? user.email : null),
    event,
    member: memberSnap.exists ? ((memberSnap.data() as any) ?? {}) : null,
  })
  if (!decision.allowed) return { ok: false, status: decision.status, error: decision.error }
  return { ok: true, uid: String(user.id), role: decision.role, canViewAttendees: decision.canViewAttendees, event: event! }
}

async function loadTierDocs(ids: string[]): Promise<Map<string, Record<string, any>>> {
  const out = new Map<string, Record<string, any>>()
  const unique = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < unique.length; i += 300) {
    const refs = unique.slice(i, i + 300).map((id) => adminDb.collection('ticket_tiers').doc(id))
    if (refs.length === 0) continue
    const docs = await adminDb.getAll(...refs)
    for (const doc of docs as any[]) if (doc.exists) out.set(doc.id, doc.data() || {})
  }
  return out
}

/** Display names for older account tickets that predate attendee_name. Name only. */
async function loadProfileNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = Array.from(new Set(ids.filter((id) => id && !id.startsWith('guest_'))))
  for (let i = 0; i < unique.length; i += 300) {
    const refs = unique.slice(i, i + 300).map((id) => adminDb.collection('users').doc(id))
    if (refs.length === 0) continue
    const docs = await adminDb.getAll(...refs)
    for (const doc of docs as any[]) {
      const name = doc.exists ? String(doc.data()?.full_name || '').trim() : ''
      if (name) out.set(doc.id, name)
    }
  }
  return out
}

/** Slim rows for every live (or already checked-in) ticket of the event. */
export async function loadDoorList(event: Record<string, any> & { id: string }): Promise<DoorRow[]> {
  const docs = await loadTicketDocsForEvent(event.id)
  const tickets = docs
    .map((d) => ({ id: d.id, data: (d.data() || {}) as Record<string, any> }))
    .filter(({ data }) => belongsOnDoorList(data))

  const eventTiers = Array.isArray(event.ticket_tiers) ? event.ticket_tiers : []
  const embeddedIds = new Set(eventTiers.map((x: any) => String(x?.id ?? x?.tier_id ?? x?.tierId ?? '')))
  const tierDocs = await loadTierDocs(
    tickets.map(({ data }) => ticketTierIdOf(data)).filter((id) => id && !embeddedIds.has(id))
  )
  const names = await loadProfileNames(
    tickets
      .filter(({ data }) => !displayNameOf(data))
      .map(({ data }) => String(data.attendee_id || data.user_id || ''))
  )

  return tickets.map(({ id, data }) => {
    const tierId = ticketTierIdOf(data)
    const tier = resolveTier(eventTiers, tierId, ticketTierNameOf(data), tierDocs.get(tierId) || null)
    return toDoorRow(id, data, {
      tier,
      event,
      profileName: names.get(String(data.attendee_id || data.user_id || '')) || null,
    })
  })
}

export type DoorCheckInRequest = {
  eventId: string
  uid: string
  ticketId?: string | null
  code?: string | null
  method: CheckInMethod
  entryPoint?: string | null
  reentry?: boolean
  override?: boolean
}

export type DoorCheckInResult = {
  verdict: DoorVerdict
  /** Present unless NOT_FOUND / WRONG_EVENT: the door row as it is NOW. */
  row: DoorRow | null
  /** ALREADY_CHECKED_IN by this same user: an earlier request that timed out on the phone but landed. */
  mine?: boolean
  /**
   * Why a code was refused, when the verdict had to be sent as CANCELLED to a
   * client that predates the TRANSFERRED / INVALID_CODE verdicts.
   */
  reason?: 'TRANSFERRED' | 'INVALID_CODE' | 'REFUNDED'
}

/** Find the ticket ref by id, then by the code its QR encodes, within the event. */
async function resolveTicketRef(eventId: string, ticketId?: string | null, code?: string | null) {
  const tickets = adminDb.collection('tickets')
  const id = parseTicketCode(ticketId) || null
  if (id) {
    const ref = tickets.doc(id)
    const snap = await ref.get()
    if (snap.exists) return ref
  }
  const parsed = parseTicketCode(code)
  if (!parsed) return null
  const direct = tickets.doc(parsed)
  if ((await direct.get()).exists) return direct
  for (const field of ['qr_code_data', 'qr_code']) {
    const snap = await tickets.where('event_id', '==', eventId).where(field, '==', parsed).limit(1).get()
    if (!snap.empty) return snap.docs[0].ref
  }
  return null
}

/**
 * Check one ticket in, in a TRANSACTION: the ticket is re-read inside it, so
 * two doors scanning the same QR at once cannot both admit it.
 */
export async function performDoorCheckIn(req: DoorCheckInRequest): Promise<DoorCheckInResult> {
  const ticketRef = await resolveTicketRef(req.eventId, req.ticketId, req.code)
  if (!ticketRef) return { verdict: 'NOT_FOUND', row: null }
  const eventRef = adminDb.collection('events').doc(req.eventId)

  return adminDb.runTransaction(async (tx: any) => {
    const [ticketSnap, eventSnap] = await Promise.all([tx.get(ticketRef), tx.get(eventRef)])
    if (!ticketSnap.exists) return { verdict: 'NOT_FOUND', row: null } as DoorCheckInResult
    const ticket = (ticketSnap.data() || {}) as Record<string, any>
    const event = (eventSnap.exists ? eventSnap.data() : {}) as Record<string, any>

    if (ticketEventIdOf(ticket) !== req.eventId) return { verdict: 'WRONG_EVENT', row: null } as DoorCheckInResult

    const eventTiers = Array.isArray(event.ticket_tiers) ? event.ticket_tiers : []
    const tierId = ticketTierIdOf(ticket)
    let fetched: Record<string, any> | null = null
    if (tierId && !eventTiers.some((x: any) => String(x?.id ?? x?.tier_id ?? x?.tierId ?? '') === tierId)) {
      const tierSnap = await tx.get(adminDb.collection('ticket_tiers').doc(tierId))
      fetched = tierSnap.exists ? tierSnap.data() || null : null
    }
    const tier = resolveTier(eventTiers, tierId, ticketTierNameOf(ticket), fetched)
    const row = toDoorRow(ticketSnap.id, ticket, { tier, event })

    // The scanned code against the ticket's current QR version. A client that
    // sends `code` is told TRANSFERRED / INVALID_CODE. A SCAN that arrives with
    // only a ticket id comes from an app build that predates QR versions (it
    // parsed the id out of the code and dropped the rest): for a ticket that
    // has changed hands the server cannot tell the new holder's code from the
    // old one, so it refuses, and staff admit the new holder by name (manual).
    const scanned = req.code || (parseSignedTicketQr(req.ticketId) ? String(req.ticketId) : null)
    let codeCheck: ScannedCodeCheck | undefined
    if (scanned) codeCheck = verifyScannedTicketCode(scanned, ticketSnap.id, ticket)
    else if (req.method === 'scan' && ticketQrVersionOf(ticket) >= 1) codeCheck = 'TRANSFERRED'

    const judgement = judgeDoorRow(row, {
      eventId: req.eventId,
      allowReentry: Boolean(event.allow_reentry),
      reentry: req.reentry,
      override: req.override,
      codeCheck,
    })
    if (!judgement.admit) {
      if ((judgement.verdict === 'TRANSFERRED' || judgement.verdict === 'INVALID_CODE') && !req.code) {
        // Older clients map unknown verdicts to "valid"; CANCELLED is one they
        // all render as a refusal.
        return { verdict: 'CANCELLED', row, reason: judgement.verdict } as DoorCheckInResult
      }
      if (judgement.verdict === 'CANCELLED' && isRefundInFlight(ticket)) {
        // Still CANCELLED (every client renders it as a refusal); the reason
        // says why: the ticket's money is on its way back to the buyer.
        return { verdict: 'CANCELLED', row, reason: 'REFUNDED' } as DoorCheckInResult
      }
      const mine = judgement.verdict === 'ALREADY_CHECKED_IN' && String(ticket.checked_in_by || '') === req.uid
      return { verdict: judgement.verdict, row, mine } as DoorCheckInResult
    }

    // A refund the holder asked for but nobody has acted on yet is DENIED by
    // walking in (same as lib/scan/checkInTicket.ts): attending and then being
    // refunded is the abuse this closes.
    const pendingRefundRequest =
      String(ticket.refund_status ?? '').toLowerCase().trim() === 'requested'
        ? {
            refund_status: 'denied',
            refund_denied_reason: 'checked_in',
            refund_processed_at: new Date().toISOString(),
          }
        : {}

    tx.update(ticketRef, {
      ...pendingRefundRequest,
      ...checkInFields({ uid: req.uid, method: req.method, entryPoint: req.entryPoint, reentry: judgement.reentry }),
      checked_in_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    })
    return {
      verdict: 'CHECKED_IN',
      row: { ...row, checkedIn: true, checkedInAt: new Date().toISOString() },
    } as DoorCheckInResult
  })
}
