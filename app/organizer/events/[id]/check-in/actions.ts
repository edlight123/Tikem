'use server'

import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'
import { parseTicketCode } from '@/lib/scan/doorRules'
import { verifyScannedTicketCode } from '@/lib/tickets/qr'

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

    const ticketData = ticketDoc.data()

    // A scanned code is judged against the ticket's QR version: a code from
    // before a transfer, or a forged signed one, never admits. A manual pick
    // by name carries no code to judge.
    // (A server action is a public endpoint: anything but 'manual' is a scan.)
    if (method !== 'manual') {
      const check = verifyScannedTicketCode(qrCode, ticketDoc.id, ticketData)
      if (check === 'TRANSFERRED') {
        return { success: false, error: 'This ticket was transferred. The old code is no longer valid.' }
      }
      if (check === 'INVALID_CODE') return { success: false, error: 'This code is not valid.' }
    }

    // Check if already checked in
    if (ticketData.checked_in) {
      return { success: false, error: 'Already checked in' }
    }

    // Check ticket status
    if (ticketData.status !== 'valid' && ticketData.status !== 'confirmed') {
      return { success: false, error: `Ticket is ${ticketData.status}` }
    }

    // Update ticket
    await adminDb.collection('tickets').doc(ticketDoc.id).update({
      checked_in: true,
      checked_in_at: new Date(),
      checked_in_by: user.id,
      entry_point: entryPoint,
      // This page admits by name/ticket-id lookup, not by reading a QR at the
      // door, so it is a manual admission and payout review must see it as one.
      check_in_method: 'manual',
      updated_at: new Date(),
    })

    revalidatePath(`/organizer/events/${eventId}/check-in`)
    revalidatePath(`/organizer/events/${eventId}/attendees`)

    return { success: true }
  } catch (error) {
    console.error('Check-in error:', error)
    return { success: false, error: 'Check-in failed' }
  }
}
