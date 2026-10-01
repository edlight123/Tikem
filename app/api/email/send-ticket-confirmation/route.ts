// Re-send a ticket confirmation (admin support tool).
//
// TWO things changed here beyond keeping it alive:
//
//  1. The recipient is now resolved FROM THE TICKET, never from the request body. It
//     used to take a `userId` off the body and mail whatever address that user
//     document held — so the caller, not the order, chose who received someone's
//     ticket. The ticket is the order record; it is the only authority for where a
//     confirmation goes.
//  2. It delivers through the same helper every fulfillment path uses
//     (lib/tickets/confirmation.ts), so a resend is byte-identical to the original —
//     including SMS for a guest ticket and WhatsApp for an account one.
//
// The recipient resolution itself lives in lib/tickets/resend.ts, shared with the
// organizer's own resend action (/api/resend-ticket).

import { adminDb } from '@/lib/firebase/admin'
import { requireAdmin } from '@/lib/auth'
import { resendTicketToHolder } from '@/lib/tickets/resend'

export async function POST(request: Request) {
  try {
    const { user, error: authError } = await requireAdmin()
    if (authError || !user) {
      return Response.json({ error: 'Admin access required' }, { status: 401 })
    }

    const { ticketId } = await request.json()

    if (!ticketId) {
      return Response.json({ error: 'ticketId is required' }, { status: 400 })
    }

    const ticketSnap = await adminDb.collection('tickets').doc(String(ticketId)).get()
    if (!ticketSnap.exists) {
      return Response.json({ error: 'Ticket not found' }, { status: 404 })
    }
    const ticket = { id: ticketSnap.id, ...(ticketSnap.data() as any) }

    const eventSnap = ticket.event_id
      ? await adminDb.collection('events').doc(String(ticket.event_id)).get()
      : null
    if (!eventSnap?.exists) {
      return Response.json({ error: 'Event not found' }, { status: 404 })
    }
    const event = { id: eventSnap.id, ...(eventSnap.data() as any) }

    const result = await resendTicketToHolder(ticket, event)

    if (!result.ok && result.reason === 'no_email') {
      return Response.json(
        { error: 'This ticket has no email address on record to send to.' },
        { status: 422 }
      )
    }
    if (!result.ok) {
      return Response.json({ error: 'Failed to send email' }, { status: 500 })
    }

    const { ok: _ok, ...channels } = result
    return Response.json({ success: true, ...channels })
  } catch (error) {
    console.error('Error in send-ticket-confirmation:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
