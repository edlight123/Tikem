import { createClient } from '@/lib/firebase-db/server'
import { ADMIN_REVIEW_MESSAGE, refundTicket, reversePromoterCommission } from '@/lib/tickets/refundExecution'
import { adminDb } from '@/lib/firebase/admin'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { ticketId, action } = body || {}

    if (!ticketId || !action || !['approve', 'deny'].includes(action)) {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Fetch the ticket. NOTE: the Firestore shim ignores SQL-style joins ('*, events(*)'),
    // so we fetch the event document separately below instead of relying on ticket.events.
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .single()

    if (ticketError || !ticket) {
      return Response.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Fetch the event document directly and verify organizer ownership explicitly.
    const eventDoc = ticket.event_id
      ? await adminDb.collection('events').doc(String(ticket.event_id)).get()
      : null
    const event = eventDoc?.exists ? { id: eventDoc.id, ...(eventDoc.data() as any) } : null

    if (!event) {
      return Response.json({ error: 'Event not found' }, { status: 404 })
    }

    // Verify user is the organizer
    if (event.organizer_id !== user.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Check if refund was requested
    if (ticket.refund_status !== 'requested') {
      return Response.json({ error: 'No pending refund request for this ticket' }, { status: 400 })
    }

    if (action === 'approve') {
      // The request belongs to whoever made it. A ticket that has since changed
      // hands (or a request with no recorded requester on a transferred ticket)
      // must not refund the money while the seat sits with someone else.
      const requestedBy = String(ticket.refund_requested_by || '')
      const holders = [String(ticket.attendee_id || ''), String(ticket.user_id || '')].filter(Boolean)
      const holderMatches = requestedBy ? holders.includes(requestedBy) : !(Number(ticket.transfer_count) > 0)
      if (!holderMatches) {
        return Response.json(
          {
            error: 'This ticket changed hands after the refund was requested, so it cannot be refunded from this request.',
            code: 'holder_changed',
          },
          { status: 409 }
        )
      }

      // A ticket already used at the door is refunded only on purpose.
      if ((ticket.checked_in === true || ticket.checked_in_at) && body?.allowCheckedIn !== true) {
        return Response.json(
          {
            error: 'This ticket was already checked in. Confirm to refund it anyway.',
            code: 'checked_in',
            requiresOverride: true,
          },
          { status: 409 }
        )
      }
    }

    if (action === 'deny') {
      // Deny refund
      const { error: updateError } = await supabase
        .from('tickets')
        .update({
          refund_status: 'denied',
          refund_processed_at: new Date().toISOString()
        })
        .eq('id', ticketId)

      if (updateError) {
        return Response.json({ error: 'Failed to deny refund' }, { status: 500 })
      }

      return Response.json({ success: true, message: 'Refund request denied' })
    }

    // Approve: move the money through the same claim -> refund/queue -> record
    // mechanics as the organizer refund action and event cancellation
    // (lib/tickets/refundExecution.ts). That reads the fields purchases actually
    // write (`payment_id`, `charged_amount` / `charged_currency`), refunds card
    // sales in the charged currency, reverses the transfer + application fee on
    // destination charges, and queues mobile money for a manual payout. A
    // failure puts the request back to 'requested' so the organizer can retry.
    const res = await refundTicket(String(ticketId), {
      reason: 'organizer_refund',
      actorId: user.id,
      event: { id: event.id, title: event.title || null, organizer_id: event.organizer_id || null },
      onFailure: 'release',
      keepRefundReason: true,
      // Re-judged inside the claim: a check-in landing after the read above is still refused.
      allowCheckedIn: body?.allowCheckedIn === true,
    })

    if (res.outcome === 'admin_review') {
      // The organizer's remaining balance doesn't cover it: nothing was sent,
      // a Tikèm admin decides. The buyer is told once that decision is made.
      return Response.json(
        {
          success: true,
          code: 'admin_review',
          message: ADMIN_REVIEW_MESSAGE,
          refundAmount: res.amount,
          refundCurrency: res.currency,
        },
        { status: 202 }
      )
    }

    let refundAmount = 0
    let refundCurrency: string | null = null
    let manual = false
    if (res.outcome === 'refunded' || res.outcome === 'queued') {
      refundAmount = res.amount
      refundCurrency = res.currency
      manual = res.outcome === 'queued'
    } else if (res.outcome === 'skipped' && res.reason === 'free') {
      // Nothing was charged: approving just retires the ticket.
      const nowIso = new Date().toISOString()
      await adminDb.collection('tickets').doc(String(ticketId)).set(
        {
          status: 'refunded',
          refund_status: 'approved',
          refund_amount: 0,
          refund_face_amount: 0,
          refund_processed_at: nowIso,
          updated_at: nowIso,
        },
        { merge: true }
      )
      // Retired without money moving; refundTicket only reverses commission on
      // refunded/queued outcomes, so this branch does it itself.
      await reversePromoterCommission(String(ticketId), 'organizer_refund_free')
    } else if (res.outcome === 'skipped' && res.reason === 'checked_in') {
      return Response.json(
        {
          error: 'This ticket was already checked in. Confirm to refund it anyway.',
          code: 'checked_in',
          requiresOverride: true,
        },
        { status: 409 }
      )
    } else if (res.outcome === 'skipped') {
      return Response.json(
        { error: 'This ticket cannot be refunded automatically', code: res.reason },
        { status: 409 }
      )
    } else {
      return Response.json({ error: res.error || 'Refund failed', code: 'refund_failed' }, { status: 502 })
    }

    // Send confirmation email to attendee
    try {
      const { sendEmail, getRefundProcessedEmail } = await import('@/lib/email')
      const { data: attendee } = await supabase
        .from('users')
        .select('email, full_name, phone')
        .eq('id', ticket.attendee_id)
        .single()

      if (attendee?.email) {
        await sendEmail({
          to: attendee.email,
          subject: `Refund ${action === 'approve' ? 'Approved' : 'Denied'} - ${event.title}`,
          html: getRefundProcessedEmail({
            attendeeName: attendee.full_name || 'Attendee',
            eventTitle: event.title,
            status: action === 'approve' ? 'approved' : 'denied',
            refundAmount: action === 'approve' ? refundAmount : 0,
            ticketId: ticketId
          })
        })
      }

      // Also send SMS notification if phone number available
      if (attendee?.phone) {
        try {
          const { sendSms, getRefundApprovedSms, getRefundDeniedSms } = await import('@/lib/sms')
          const smsMessage = action === 'approve'
            ? getRefundApprovedSms({
                eventTitle: event.title,
                amount: refundAmount
              })
            : getRefundDeniedSms({
                eventTitle: event.title
              })
          
          await sendSms({
            to: attendee.phone,
            message: smsMessage
          })
        } catch (smsError) {
          console.error('Failed to send SMS notification:', smsError)
          // Continue - email was sent successfully
        }
      }
    } catch (emailError) {
      console.error('Failed to send attendee confirmation:', emailError)
      // Don't fail the request if email fails
    }

    return Response.json({
      success: true,
      message: manual
        ? 'Refund approved; mobile-money refunds are paid out manually'
        : 'Refund processed successfully',
      refundAmount,
      refundCurrency,
      manual,
    })
  } catch (error) {
    console.error('Refund processing error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
