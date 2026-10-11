import { getServerSession } from '@/lib/firebase/server'
import {
  REFUND_REQUEST_SUBMITTED_MESSAGE,
  RefundRequestError,
  notifyOrganizerOfRefundRequest,
  parseRefundRequestReason,
  recordRefundRequest,
} from '@/lib/tickets/refundRequest'

/**
 * POST /api/refunds/request — a signed-in buyer ASKS for a refund (web ticket
 * page, mobile RefundRequestScreen).
 * Body: { ticketId, reasonCategory, details } — or the older mobile
 * { ticketId, reason }, where a free-text reason counts as the explanation.
 * Success: { success: true, message }. Failure: { error, code? } with a 4xx/5xx.
 *
 * Never automatic (owner rule, 2026-10-10): this records refund_status
 * 'requested' and nothing else. The organizer decides through
 * app/api/refunds/process; Tikèm admins through lib/tickets/refundReview.ts.
 * All rules (reason + explanation required, one open request per ticket, not
 * checked in, live ticket, at least 24 h before the event, caller owns the
 * ticket) live in lib/tickets/refundRequest.ts, shared with the guest-link
 * route app/api/refunds/request/guest.
 *
 * Ownership is attendee_id OR user_id (card tickets often carry only
 * attendee_id); a missing ticket and someone else's ticket both answer 404.
 */
export async function POST(request: Request) {
  try {
    const { user } = await getServerSession()
    if (!user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const ticketId = String(body?.ticketId || '').trim()
    if (!ticketId) {
      return Response.json({ error: 'Ticket ID and reason are required' }, { status: 400 })
    }

    try {
      const reason = parseRefundRequestReason(body)
      const owns = (t: any) =>
        Boolean(t) && (String(t.attendee_id || '') === user.id || String(t.user_id || '') === user.id)
      const recorded = await recordRefundRequest({
        ticketId,
        owns,
        requesterId: user.id,
        via: 'account',
        reason,
      })
      await notifyOrganizerOfRefundRequest({
        ticketId,
        ticket: recorded.ticket,
        event: recorded.event,
        eventId: recorded.eventId,
        requesterEmail: user.email || '',
        reason: reason.combined,
      })
    } catch (e: any) {
      if (e instanceof RefundRequestError) {
        return Response.json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: e.status })
      }
      throw e
    }

    return Response.json({ success: true, message: REFUND_REQUEST_SUBMITTED_MESSAGE })
  } catch (error) {
    console.error('Refund request error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
