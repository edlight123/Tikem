import { adminDb } from '@/lib/firebase/admin'
import { sendTicketConfirmation, type ConfirmationEvent, type SendTicketConfirmationResult } from '@/lib/tickets/confirmation'
import { guestTokenFor } from '@/lib/guest/identity'

export type ResendOutcome =
  | ({ ok: true } & SendTicketConfirmationResult)
  | { ok: false; reason: 'no_email' | 'send_failed' }

/**
 * Re-deliver one ticket to its HOLDER. The recipient is resolved from the ticket
 * (the order record), never from the caller — a resend must not be a way to
 * mail someone's ticket to an address of the caller's choosing.
 *
 * Shared by the admin support tool (/api/email/send-ticket-confirmation) and the
 * organizer's resend action (/api/resend-ticket), so both deliver exactly what
 * the original fulfillment sent, including SMS for a guest ticket.
 */
export async function resendTicketToHolder(
  ticket: Record<string, any> & { id: string },
  event: Record<string, any> & { id: string },
  logPrefix = '[resend-confirmation]'
): Promise<ResendOutcome> {
  const isGuestTicket = Boolean(ticket.is_guest) || String(ticket.attendee_id || '').startsWith('guest_')

  let recipientEmail: string | null = null
  let recipientName: string | null = null
  let recipientPhone: string | null = null

  if (isGuestTicket) {
    recipientEmail = ticket.guest_email || null
    recipientName = ticket.attendee_name || null
    recipientPhone = ticket.guest_phone || null
  } else if (ticket.attendee_id || ticket.user_id) {
    const userSnap = await adminDb.collection('users').doc(String(ticket.attendee_id || ticket.user_id)).get()
    const profile = userSnap.exists ? (userSnap.data() as any) : null
    recipientEmail = profile?.email || null
    recipientName = profile?.full_name || ticket.attendee_name || null
    recipientPhone = profile?.phone || profile?.phone_number || null
  }

  // A comp issued to someone without an account carries its own address.
  if (!recipientEmail && ticket.recipient_email) {
    recipientEmail = ticket.recipient_email
    recipientName = recipientName || ticket.recipient_name || null
  }

  if (!recipientEmail) return { ok: false, reason: 'no_email' }

  // A guest's link is re-derived from the order key on their guest order, not
  // stored and not accepted from the caller.
  let guestToken: string | null = null
  if (isGuestTicket) {
    const orders = await adminDb
      .collection('guest_orders')
      .where('guest_id', '==', String(ticket.attendee_id))
      .limit(1)
      .get()
    if (!orders.empty) guestToken = guestTokenFor(orders.docs[0].id)
  }

  const result = await sendTicketConfirmation({
    ticketId: String(ticket.id),
    qrPayload: ticket.qr_code_data || ticket.id,
    event: event as ConfirmationEvent,
    recipient: {
      email: recipientEmail,
      name: recipientName,
      phone: recipientPhone,
      isGuest: isGuestTicket,
    },
    quantity: 1,
    tierName: ticket.tier_name || ticket.ticket_type || null,
    guestToken,
    logPrefix,
  })

  if (!result.emailSent) return { ok: false, reason: 'send_failed' }
  return { ok: true, ...result }
}
