import { adminDb } from '@/lib/firebase/admin'
import { isLiveTicketStatus } from '@/lib/tickets/status'

/**
 * A buyer ASKING for a refund. Shared by the account route
 * (app/api/refunds/request) and the guest-link route
 * (app/api/refunds/request/guest).
 *
 * Owner rule (2026-10-10): "Don't make refunds easy. Add a button to request
 * it, and they need a reason — then we investigate, but never automatic."
 *
 * So this module ONLY ever records `refund_status: 'requested'` on the ticket.
 * No money moves and nothing is approved here. The request is worked by the
 * organizer (app/api/refunds/process, which re-checks it) and, where the
 * policy says so, by a Tikèm admin (lib/tickets/refundReview.ts). A test pins
 * that this module never imports or calls the refund executor.
 *
 * A reason is required: a category from REASON_CATEGORIES AND a free-text
 * explanation of at least MIN_DETAILS_LENGTH characters.
 */

/** Refund states a buyer may request FROM. Missing / empty counts as none. */
const REQUESTABLE_REFUND_STATES = new Set(['', 'none'])

export const REFUND_WINDOW_HOURS = 24
export const MIN_DETAILS_LENGTH = 20
export const MAX_DETAILS_LENGTH = 1000

/**
 * Accepted categories. The first four are the web form's; the rest are the
 * keys the mobile RefundRequestScreen has always sent, kept so a shipped build
 * still validates once it sends an explanation.
 */
export const REASON_CATEGORIES: Record<string, string> = {
  cant_attend: "Can't attend",
  event_changed: 'Event changed or cancelled',
  billing_issue: 'Charged twice or wrong amount',
  other: 'Other',
  // Mobile (legacy keys)
  cannot_attend: "Can't attend",
  schedule_conflict: 'Schedule conflict',
  bought_wrong: 'Bought the wrong tickets',
  financial: 'Financial reasons',
}

export class RefundRequestError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message)
  }
}

export type ParsedRefundReason = {
  category: string
  details: string
  /** What organizers and admins read: "<Category>: <details>". */
  combined: string
}

/**
 * Validate the reason from a request body. Accepts the web shape
 * `{ reasonCategory, details }` and the older mobile shape `{ reason }`, where
 * `reason` is either a category key (no explanation — rejected) or free text
 * (the "Other" path).
 */
export function parseRefundRequestReason(body: any): ParsedRefundReason {
  const rawCategory = String(body?.reasonCategory ?? '').trim().toLowerCase()
  const rawReason = String(body?.reason ?? '').trim()
  let details = String(body?.details ?? '').trim()
  let category = rawCategory

  if (!category) {
    const reasonKey = rawReason.toLowerCase()
    if (reasonKey && Object.prototype.hasOwnProperty.call(REASON_CATEGORIES, reasonKey)) {
      category = reasonKey
    } else if (rawReason) {
      category = 'other'
      if (!details) details = rawReason
    }
  } else if (!details && rawReason && rawReason.toLowerCase() !== rawCategory) {
    details = rawReason
  }

  if (!category || !Object.prototype.hasOwnProperty.call(REASON_CATEGORIES, category)) {
    throw new RefundRequestError('Choose a reason for the refund request', 400, 'reason_required')
  }
  if (details.length < MIN_DETAILS_LENGTH) {
    throw new RefundRequestError(
      `Please explain why you are asking for a refund (at least ${MIN_DETAILS_LENGTH} characters)`,
      400,
      'details_too_short'
    )
  }
  details = details.slice(0, MAX_DETAILS_LENGTH)
  return { category, details, combined: `${REASON_CATEGORIES[category]}: ${details}` }
}

function toDate(value: any): Date | null {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  if (typeof value === 'object' && typeof value._seconds === 'number') return new Date(value._seconds * 1000)
  if (typeof value === 'object' && typeof value.seconds === 'number') return new Date(value.seconds * 1000)
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export type RecordedRefundRequest = {
  ticket: Record<string, any>
  event: Record<string, any>
  eventId: string
}

/**
 * Record a pending refund request on `ticketId`. `owns` decides whether the
 * caller holds the ticket (it is re-run inside the transaction). Throws
 * RefundRequestError for every refusal. Never refunds anything.
 */
export async function recordRefundRequest(input: {
  ticketId: string
  owns: (ticket: Record<string, any>) => boolean
  requesterId: string
  via: 'account' | 'guest_link'
  reason: ParsedRefundReason
}): Promise<RecordedRefundRequest> {
  const { ticketId, owns, requesterId, via, reason } = input
  if (!ticketId || ticketId.includes('/')) throw new RefundRequestError('Ticket ID is required', 400)

  const ticketRef = adminDb.collection('tickets').doc(ticketId)
  const firstSnap = await ticketRef.get()
  const first = firstSnap.exists ? ((firstSnap.data() as any) ?? {}) : null
  // Same answer for "missing" and "not yours", so ids can't be probed.
  if (!first || !owns(first)) throw new RefundRequestError('Ticket not found', 404)

  const eventId = String(first.event_id || first.eventId || '')
  const eventSnap = eventId ? await adminDb.collection('events').doc(eventId).get() : null
  const event = eventSnap?.exists ? ((eventSnap.data() as any) ?? {}) : null
  if (!event) throw new RefundRequestError('Event not found', 404)

  if (String(event.status || '').toLowerCase() === 'cancelled') {
    throw new RefundRequestError(
      'This event was cancelled. Its refunds are handled for you; there is nothing to request.',
      400,
      'event_cancelled'
    )
  }

  const start = toDate(event.start_datetime) || toDate(first.start_datetime) || toDate(first.event_date)
  if (!start) {
    throw new RefundRequestError('This event has no date, so a refund cannot be requested here', 400)
  }
  if (start.getTime() < Date.now()) {
    throw new RefundRequestError('Cannot refund tickets for past events', 400, 'event_past')
  }
  if (Date.now() > start.getTime() - REFUND_WINDOW_HOURS * 3_600_000) {
    throw new RefundRequestError(
      'Refund deadline has passed. Refunds must be requested at least 24 hours before the event.',
      400,
      'deadline_passed'
    )
  }

  const nowIso = new Date().toISOString()
  let latest: Record<string, any> = first
  await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ticketRef)
    const t = snap.exists ? ((snap.data() as any) ?? {}) : null
    if (!t || !owns(t)) throw new RefundRequestError('Ticket not found', 404)
    if (!isLiveTicketStatus(t.status)) {
      throw new RefundRequestError('This ticket is no longer active and cannot be refunded', 400, 'not_live')
    }
    if (t.checked_in === true || t.checked_in_at) {
      throw new RefundRequestError('This ticket has already been used', 400, 'checked_in')
    }
    const current = String(t.refund_status ?? '').toLowerCase().trim()
    if (!REQUESTABLE_REFUND_STATES.has(current)) {
      throw new RefundRequestError('Refund already requested or processed', 400, 'already_requested')
    }
    latest = t
    // A REQUEST only. Nothing here moves money or approves anything.
    tx.set(
      ticketRef,
      {
        refund_status: 'requested',
        refund_reason: reason.combined,
        refund_reason_category: reason.category,
        refund_reason_details: reason.details,
        refund_requested_at: nowIso,
        refund_requested_by: requesterId,
        refund_requested_via: via,
        updated_at: nowIso,
      },
      { merge: true }
    )
  })

  return { ticket: latest, event, eventId }
}

/**
 * Tell the organizer (existing refund-request email). Best-effort: the request
 * is recorded either way and shows in their refund queue.
 */
export async function notifyOrganizerOfRefundRequest(input: {
  ticketId: string
  ticket: Record<string, any>
  event: Record<string, any>
  eventId: string
  requesterEmail: string
  reason: string
}): Promise<void> {
  const { ticketId, ticket, event, eventId, requesterEmail, reason } = input
  try {
    const organizerId = String(event.organizer_id || '')
    if (!organizerId) return
    const { sendEmail, getRefundRequestEmail, emailSubjects } = await import('@/lib/email')
    const { resolveEmailLang } = await import('@/lib/email-kit/recipient')
    const orgSnap = await adminDb.collection('users').doc(organizerId).get()
    const organizer = orgSnap.exists ? ((orgSnap.data() as any) ?? {}) : null
    if (!organizer?.email) return
    // The organizer's profile is already loaded: their language, else the event's region.
    const lang = await resolveEmailLang({ explicit: organizer.language, event })
    const eventTitle =
      String(event.title || '').trim() || { en: 'your event', fr: 'votre événement', ht: 'evènman ou' }[lang]
    // price_paid is the face value in the ticket's (event) currency.
    const currency = String(ticket.currency || event.currency || '').trim() || undefined
    await sendEmail({
      to: organizer.email,
      subject: emailSubjects.refundRequest(lang, eventTitle),
      html: getRefundRequestEmail({
        lang,
        organizerName: organizer.full_name || '',
        eventTitle,
        attendeeEmail: requesterEmail || '—',
        reason,
        ticketId,
        amount: Number(ticket.price_paid ?? ticket.price ?? 0) || 0,
        currency,
        eventId,
      }),
    })
  } catch (emailError) {
    console.error('Failed to send organizer refund-request notification:', emailError)
  }
}

export const REFUND_REQUEST_SUBMITTED_MESSAGE =
  'Refund request submitted. The organizer and Tikèm will review it and email you the decision.'
