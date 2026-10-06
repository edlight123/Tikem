'use server'

import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'
import { parseTicketCode } from '@/lib/scan/doorRules'
import { checkInTicket as checkInTicketTransactional } from '@/lib/scan/checkInTicket'

export async function checkInTicket(
  eventId: string,
  qrCode: string,
  entryPoint: string,
  method: 'scan' | 'manual' = 'scan'
): Promise<{ success: boolean; error?: string }> {
  // ── Auth + ownership check ────────────────────────────────────────────────
  const user = await getCurrentUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  if (user.role !== 'organizer' && user.role !== 'admin' && user.role !== 'super_admin') {
    return { success: false, error: 'Organizer access required' }
  }

  // Organizers must own the event; admins may act on any event.
  if (user.role === 'organizer') {
    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    if (!eventDoc.exists) return { success: false, error: 'Event not found' }
    if (eventDoc.data()?.organizer_id !== user.id) {
      return { success: false, error: 'You do not own this event' }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  try {
    // Find ticket by QR code or ticket ID
    const ticketDocs = await loadTicketDocsForEvent(eventId)

    const parsedId = parseTicketCode(qrCode)
    const ticketDoc = ticketDocs.find((doc: any) => {
      const data = doc.data() || {}
      return (
        data.qr_code === qrCode ||
        data.qr_code_data === qrCode ||
        doc.id === qrCode ||
        (parsedId !== null && doc.id === parsedId)
      )
    })

    if (!ticketDoc) {
      return { success: false, error: 'Ticket not found' }
    }

    // The shared door path (lib/scan/checkInTicket.ts): the ticket is re-read
    // in a transaction (two doors cannot both admit it), judged by
    // ticketBlockReason (a refund in flight or a non-live status refuses), a
    // scanned code is judged against the ticket's QR version, and a buyer's
    // open refund request is denied by the check-in.
    // (A server action is a public endpoint: anything but 'manual' is a scan.)
    const isManual = method === 'manual'
    const result = await checkInTicketTransactional({
      ticketId: ticketDoc.id,
      eventId,
      entryPoint,
      checkInMethod: isManual ? 'manual' : 'scan',
      scannedBy: String(user.id),
      // A manual pick by name carries no code to judge.
      code: isManual ? null : qrCode,
    })

    if (!result.success) {
      if (result.type === 'ALREADY_CHECKED_IN') return { success: false, error: 'Already checked in' }
      switch (result.reason) {
        case 'TRANSFERRED':
          return { success: false, error: 'This ticket was transferred. The old code is no longer valid.' }
        case 'INVALID_CODE':
          return { success: false, error: 'This code is not valid.' }
        case 'REFUNDED':
          return { success: false, error: 'This ticket has been refunded or has a refund in progress.' }
        case 'PENDING_PAYMENT':
          return { success: false, error: 'This ticket is awaiting payment.' }
        case 'CANCELLED':
          return { success: false, error: 'This ticket has been cancelled.' }
        case 'WRONG_EVENT':
          return { success: false, error: 'This ticket is for a different event.' }
        default:
          return { success: false, error: 'Ticket not found' }
      }
    }

    revalidatePath(`/organizer/events/${eventId}/check-in`)
    revalidatePath(`/organizer/events/${eventId}/attendees`)

    return { success: true }
  } catch (error) {
    console.error('Check-in error:', error)
    return { success: false, error: 'Check-in failed' }
  }
}
