// API Route: POST /api/tickets/transfer/respond
// Accept or reject a ticket transfer (Firestore-backed)

import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { DocumentReference, Transaction } from 'firebase-admin/firestore'

const transferResponseSchema = z.object({
  transferToken: z.string().min(1),
  action: z.enum(['accept', 'reject'])
})

function toDate(value: any): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value?.toDate === 'function') return value.toDate()
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validation = transferResponseSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 }
      )
    }

    const { transferToken, action } = validation.data

    // Find transfer by token
    const transfersQuery = await adminDb
      .collection('ticket_transfers')
      .where('transfer_token', '==', transferToken)
      .limit(1)
      .get()

    if (transfersQuery.empty) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 })
    }

    const transferDoc = transfersQuery.docs[0]
    const transferRef = transferDoc.ref as DocumentReference

    const nowIso = new Date().toISOString()

    // Perform update atomically
    const outcome = await adminDb.runTransaction(
      async (tx: Transaction) => {
        const transferSnap = await tx.get(transferRef)
        if (!transferSnap.exists) {
          throw new Error('Transfer not found')
        }

        const transfer = transferSnap.data() as any

        const toEmail = String(transfer?.to_email || '').toLowerCase()
        if (!toEmail || toEmail !== (user.email || '').toLowerCase()) {
          const err: any = new Error('This transfer is not for you')
          err.status = 403
          throw err
        }

        if (transfer?.status !== 'pending') {
          const err: any = new Error(`Transfer is ${transfer?.status}`)
          err.status = 400
          throw err
        }

        const exp = toDate(transfer?.expires_at)
        if (exp && exp < new Date()) {
          // Return (not throw) so the 'expired' write actually commits — a
          // throw inside runTransaction rolls every write back.
          tx.update(transferRef, { status: 'expired', updated_at: nowIso })
          return { expired: true as const }
        }

        const ticketId = String(transfer?.ticket_id || '')
        const fromUserId = String(transfer?.from_user_id || '')
        if (!ticketId || !fromUserId) {
          const err: any = new Error('Transfer is missing ticket information')
          err.status = 500
          throw err
        }

        const ticketRef = adminDb.collection('tickets').doc(ticketId) as DocumentReference
        const ticketSnap = await tx.get(ticketRef)
        if (!ticketSnap.exists) {
          const err: any = new Error('Ticket not found')
          err.status = 404
          throw err
        }

        const ticket = ticketSnap.data() as any
        const ticketStatus = ticket?.status
        const checkedIn = !!ticket?.checked_in || !!ticket?.checked_in_at

        // The ticket must still belong to the person who offered it. Without
        // this, a transfer naming any ticket id (or one whose holder changed
        // after the offer) would move someone else's ticket to the recipient.
        // Same ownership predicate the request route applies when the offer is
        // made (attendee OR buyer), re-checked here inside the transaction.
        const ownsTicket = ticket?.attendee_id === fromUserId || ticket?.user_id === fromUserId
        if (!ownsTicket) {
          const err: any = new Error('Ticket is no longer available for transfer')
          err.status = 400
          throw err
        }

        // Same live set the request route accepts (valid | confirmed | active).
        // An absent status counts as live in isLiveTicketStatus; request refuses
        // those, so require a non-empty status here too.
        if (!ticketStatus || !isLiveTicketStatus(ticketStatus) || checkedIn) {
          const err: any = new Error('Ticket is no longer available for transfer')
          err.status = 400
          throw err
        }

        const baseTransferUpdate: any = {
          to_user_id: user.id,
          responded_at: nowIso,
          updated_at: nowIso
        }

        if (action === 'reject') {
          tx.update(transferRef, { ...baseTransferUpdate, status: 'rejected' })
        } else {
          const existingTransferCount = Number(ticket?.transfer_count || 0)
          tx.update(ticketRef, {
            attendee_id: user.id,
            user_id: user.id,
            transfer_count: existingTransferCount + 1,
            updated_at: nowIso
          })
          tx.update(transferRef, { ...baseTransferUpdate, status: 'accepted' })
        }

        return {
          expired: false as const,
          ticketId,
          fromUserId,
          toEmailLower: toEmail,
          status: action === 'reject' ? 'rejected' : 'accepted',
          expiresAt: exp?.toISOString() || transfer?.expires_at || null,
          ticketEventId: String(ticket?.event_id || '')
        }
      }
    )

    if (outcome.expired) {
      return NextResponse.json({ error: 'Transfer has expired' }, { status: 400 })
    }
    const { ticketId, fromUserId, toEmailLower, status, expiresAt, ticketEventId } = outcome

    // Fetch event + sender/recipient for messages (best-effort)
    let eventTitle = 'Event'
    if (ticketEventId) {
      try {
        const eventSnap = await adminDb.collection('events').doc(ticketEventId).get()
        eventTitle = (eventSnap.data() as any)?.title || eventTitle
      } catch {
        // ignore
      }
    }

    let senderEmail: string | undefined
    let senderName: string | undefined
    try {
      const senderSnap = await adminDb.collection('users').doc(fromUserId).get()
      const sender = senderSnap.data() as any
      senderEmail = sender?.email
      senderName = sender?.full_name || sender?.name
    } catch {
      // ignore
    }

    let recipientName = ''
    try {
      const recipientSnap = await adminDb.collection('users').doc(user.id).get()
      const recipient = recipientSnap.data() as any
      recipientName = recipient?.full_name || recipient?.name || ''
    } catch {
      // ignore
    }

    // Email notifications (best-effort)
    try {
      const { sendEmail, getTicketTransferResponseEmail } = await import('@/lib/email')

      if (senderEmail) {
        await sendEmail({
          to: senderEmail,
          subject: `Ticket transfer ${status} - ${eventTitle}`,
          html: getTicketTransferResponseEmail({
            recipientName: recipientName || user.email || toEmailLower,
            eventTitle,
            action: status === 'accepted' ? 'accepted' : 'rejected',
            ticketId
          })
        })
      }
    } catch (emailError) {
      console.error('Failed to send transfer response email:', emailError)
    }

    // In-app notifications (best-effort)
    try {
      const recipientLabel = recipientName || user.email || 'The recipient'
      const senderLabel = senderName || senderEmail || 'The sender'

      await createNotification(
        fromUserId,
        'ticket_transfer',
        status === 'accepted' ? 'Ticket transfer accepted' : 'Ticket transfer declined',
        `${recipientLabel} has ${status === 'accepted' ? 'accepted' : 'declined'} your ticket transfer for "${eventTitle}".`,
        `/tickets/${ticketId}`,
        { eventId: ticketEventId, ticketId, transferStatus: status }
      )

      await sendPushNotification(
        fromUserId,
        status === 'accepted' ? 'Ticket transfer accepted' : 'Ticket transfer declined',
        `${recipientLabel} has ${status === 'accepted' ? 'accepted' : 'declined'} your ticket transfer for "${eventTitle}".`,
        '/notifications',
        { type: 'ticket_transfer', deepLink: 'tikem://notifications', eventId: ticketEventId, ticketId, transferStatus: status }
      )

      if (status === 'accepted') {
        await createNotification(
          user.id,
          'ticket_transfer',
          'Ticket received',
          `You accepted a ticket transfer for "${eventTitle}" from ${senderLabel}.`,
          `/tickets/${ticketId}`,
          { eventId: ticketEventId, ticketId, transferStatus: status }
        )

        await sendPushNotification(
          user.id,
          'Ticket received',
          `You accepted a ticket transfer for "${eventTitle}" from ${senderLabel}.`,
          `/tickets/${ticketId}`,
          { type: 'ticket_transfer', deepLink: `tikem://tickets/${ticketId}`, eventId: ticketEventId, ticketId, transferStatus: status }
        )
      }
    } catch (notifyError) {
      console.error('Failed to create transfer notifications:', notifyError)
    }

    return NextResponse.json({
      success: true,
      status,
      ticketId,
      expiresAt
    })
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500
    console.error('Transfer response error:', error)
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status }
    )
  }
}
