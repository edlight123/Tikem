import { getGuestOrderByToken } from '@/lib/guest/identity'
import { consumeRateLimit } from '@/lib/rate-limit'
import {
  REFUND_REQUEST_SUBMITTED_MESSAGE,
  RefundRequestError,
  notifyOrganizerOfRefundRequest,
  parseRefundRequestReason,
  recordRefundRequest,
} from '@/lib/tickets/refundRequest'

/**
 * POST /api/refunds/request/guest — a guest (no account) ASKS for a refund
 * from their ticket link (/tickets/guest/<token>).
 * Body: { token, ticketId, reasonCategory, details }.
 *
 * The signed retrieval token is the credential (lib/guest/identity.ts). The
 * ticketId in the body is only a selector among the token's own tickets: it
 * must be listed on the order the token names AND still be held by that
 * order's guest id. A ticketId without a valid token reaches nothing.
 *
 * Same rules and same pending-only outcome as the account route — see
 * lib/tickets/refundRequest.ts. Never refunds anything.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const token = String(body?.token || '').trim()
    const ticketId = String(body?.ticketId || '').trim()

    const order = token ? await getGuestOrderByToken(token) : null
    if (!order || !order.guestId) {
      return Response.json({ error: 'This ticket link is not valid.' }, { status: 404 })
    }

    // Per order: a token can only make a handful of attempts an hour. Fails
    // open — the transaction still allows one open request per ticket.
    const { limited } = await consumeRateLimit({
      key: `refund-request-guest:${order.orderKey}`,
      limit: 10,
      windowMs: 60 * 60 * 1000,
      failOpen: true,
    })
    if (limited) {
      return Response.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
    }

    if (!ticketId) {
      return Response.json({ error: 'Ticket ID and reason are required' }, { status: 400 })
    }

    try {
      const reason = parseRefundRequestReason(body)
      const onOrder = order.ticketIds.includes(ticketId)
      const owns = (t: any) => onOrder && Boolean(t) && String(t.attendee_id || '') === order.guestId
      const recorded = await recordRefundRequest({
        ticketId,
        owns,
        requesterId: order.guestId,
        via: 'guest_link',
        reason,
      })
      await notifyOrganizerOfRefundRequest({
        ticketId,
        ticket: recorded.ticket,
        event: recorded.event,
        eventId: recorded.eventId,
        requesterEmail: order.email || order.phone || '',
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
    console.error('Guest refund request error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
