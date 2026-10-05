import { adminDb } from '@/lib/firebase/admin'
import { getServerSession } from '@/lib/firebase/server'
import { isLiveTicketStatus } from '@/lib/tickets/status'

/**
 * POST /api/refunds/request — a buyer asks the organizer for a refund
 * (mobile RefundRequestScreen). Body: { ticketId, reason }.
 * Success: { success: true, message }. Failure: { error } with a 4xx/5xx.
 *
 * This route used to fail for every ticket:
 *  - it went through the Supabase-shaped shim with `.eq('id', ticketId)`, but
 *    ticket docs do not carry an `id` field, so nothing matched (404);
 *  - it asked for an `events(*)` join the shim ignores, so `ticket.events` was
 *    undefined and reading the event threw (500);
 *  - a ticket with no `refund_status` (every ticket — purchases never write one)
 *    was treated as "already requested" (400).
 *
 * Now: the ticket is read by document id; ownership is attendee_id OR user_id
 * (card tickets often carry only attendee_id); the event is loaded separately;
 * a missing refund_status means none; and 'requested' is set in a transaction
 * that re-checks the ticket, so a double tap or a concurrent organizer action
 * cannot overwrite a refund already in flight.
 */

/** Refund states a buyer may request FROM. Missing / empty counts as none. */
const REQUESTABLE_REFUND_STATES = new Set(['', 'none'])

const REFUND_WINDOW_HOURS = 24

function toDate(value: any): Date | null {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  if (typeof value === 'object' && typeof value._seconds === 'number') return new Date(value._seconds * 1000)
  if (typeof value === 'object' && typeof value.seconds === 'number') return new Date(value.seconds * 1000)
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

class RequestError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await getServerSession()
    if (!user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const ticketId = String(body?.ticketId || '').trim()
    const reason = String(body?.reason || '').trim().slice(0, 1000)

    if (!ticketId || !reason || ticketId.includes('/')) {
      return Response.json({ error: 'Ticket ID and reason are required' }, { status: 400 })
    }

    const ticketRef = adminDb.collection('tickets').doc(ticketId)
    const firstSnap = await ticketRef.get()
    const first = firstSnap.exists ? ((firstSnap.data() as any) ?? {}) : null
    const owns = (t: any) =>
      Boolean(t) && (String(t.attendee_id || '') === user.id || String(t.user_id || '') === user.id)
    // Same answer for "missing" and "not yours", so ids can't be probed.
    if (!first || !owns(first)) {
      return Response.json({ error: 'Ticket not found' }, { status: 404 })
    }

    const eventId = String(first.event_id || first.eventId || '')
    const eventSnap = eventId ? await adminDb.collection('events').doc(eventId).get() : null
    const event = eventSnap?.exists ? ((eventSnap.data() as any) ?? {}) : null
    if (!event) {
      return Response.json({ error: 'Event not found' }, { status: 404 })
    }

    const start = toDate(event.start_datetime) || toDate(first.start_datetime) || toDate(first.event_date)
    if (!start) {
      return Response.json({ error: 'This event has no date, so a refund cannot be requested here' }, { status: 400 })
    }
    if (start.getTime() < Date.now()) {
      return Response.json({ error: 'Cannot refund tickets for past events' }, { status: 400 })
    }
    if (Date.now() > start.getTime() - REFUND_WINDOW_HOURS * 3_600_000) {
      return Response.json(
        { error: 'Refund deadline has passed. Refunds must be requested at least 24 hours before the event.' },
        { status: 400 }
      )
    }

    const nowIso = new Date().toISOString()
    try {
      await adminDb.runTransaction(async (tx: any) => {
        const snap = await tx.get(ticketRef)
        const t = snap.exists ? ((snap.data() as any) ?? {}) : null
        if (!t || !owns(t)) throw new RequestError('Ticket not found', 404)
        if (!isLiveTicketStatus(t.status)) {
          throw new RequestError('This ticket is no longer active and cannot be refunded', 400)
        }
        if (t.checked_in === true || t.checked_in_at) {
          throw new RequestError('This ticket has already been used', 400)
        }
        const current = String(t.refund_status ?? '').toLowerCase().trim()
        if (!REQUESTABLE_REFUND_STATES.has(current)) {
          throw new RequestError('Refund already requested or processed', 400)
        }
        tx.set(
          ticketRef,
          {
            refund_status: 'requested',
            refund_reason: reason,
            refund_requested_at: nowIso,
            refund_requested_by: user.id,
            updated_at: nowIso,
          },
          { merge: true }
        )
      })
    } catch (e: any) {
      if (e instanceof RequestError) return Response.json({ error: e.message }, { status: e.status })
      throw e
    }

    // Notify the organizer. Best-effort: the request is recorded either way and
    // shows in their refund queue.
    try {
      const organizerId = String(event.organizer_id || '')
      if (organizerId) {
        const { sendEmail, getRefundRequestEmail } = await import('@/lib/email')
        const orgSnap = await adminDb.collection('users').doc(organizerId).get()
        const organizer = orgSnap.exists ? ((orgSnap.data() as any) ?? {}) : null
        if (organizer?.email) {
          await sendEmail({
            to: organizer.email,
            subject: `Refund Request for ${event.title || 'your event'}`,
            html: getRefundRequestEmail({
              organizerName: organizer.full_name || 'Organizer',
              eventTitle: event.title || 'your event',
              attendeeEmail: user.email || 'Unknown',
              reason,
              ticketId,
              amount: Number(first.price_paid ?? first.price ?? 0) || 0,
            }),
          })
        }
      }
    } catch (emailError) {
      console.error('Failed to send organizer refund-request notification:', emailError)
    }

    return Response.json({
      success: true,
      message: 'Refund request submitted. The organizer will review your request.',
    })
  } catch (error) {
    console.error('Refund request error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
