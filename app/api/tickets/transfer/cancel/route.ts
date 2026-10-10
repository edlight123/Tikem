// API Route: POST /api/tickets/transfer/cancel
// Cancel a pending ticket transfer

import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const cancelSchema = z.object({
  transferId: z.string().min(1)
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
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Validate request body
    const body = await request.json()
    const validation = cancelSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 }
      )
    }

    const { transferId } = validation.data

    const transferRef = adminDb.collection('ticket_transfers').doc(transferId)
    const transferSnap = await transferRef.get()
    if (!transferSnap.exists) {
      return NextResponse.json(
        { error: 'Transfer not found or not owned by you' },
        { status: 404 }
      )
    }

    const transfer = transferSnap.data() as any
    if (transfer?.from_user_id !== user.id) {
      return NextResponse.json(
        { error: 'Transfer not found or not owned by you' },
        { status: 404 }
      )
    }

    // Check transfer status
    if (transfer.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot cancel transfer with status: ${transfer.status}` },
        { status: 400 }
      )
    }

    // Optional expiry handling
    const exp = toDate(transfer?.expires_at)
    if (exp && exp < new Date()) {
      await transferRef.update({ status: 'expired', updated_at: new Date().toISOString() })
      return NextResponse.json(
        { error: 'Transfer has expired' },
        { status: 400 }
      )
    }

    // Cancel transfer
    try {
      await transferRef.update({
        status: 'cancelled',
        responded_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    } catch (updateError) {
      console.error('Transfer cancellation error:', updateError)
      return NextResponse.json(
        { error: 'Failed to cancel transfer' },
        { status: 500 }
      )
    }

    // Optionally notify recipient
    try {
      const { sendEmail, getTicketTransferCancelledEmail, emailSubjects } = await import('@/lib/email')
      const { resolveEmailLang } = await import('@/lib/email-kit/recipient')

      // Resolve event title if possible
      let eventTitle = 'Event'
      let eventId: string | undefined
      let eventData: any = null
      try {
        const ticketId = String(transfer?.ticket_id || '')
        if (ticketId) {
          const ticketSnap = await adminDb.collection('tickets').doc(ticketId).get()
          eventId = (ticketSnap.data() as any)?.event_id || undefined
          if (eventId) {
            const eventSnap = await adminDb.collection('events').doc(String(eventId)).get()
            eventData = (eventSnap.data() as any) || null
            eventTitle = eventData?.title || eventTitle
          }
        }
      } catch {
        // ignore
      }

      // The recipient may not have an account yet: their profile language if they
      // do (looked up by the address the transfer was sent to), else the event's region.
      const lang = await resolveEmailLang({ email: transfer.to_email, event: eventData })
      await sendEmail({
        to: transfer.to_email,
        subject: emailSubjects.transferCancelled(lang, eventTitle),
        html: getTicketTransferCancelledEmail({
          lang,
          eventTitle,
          senderName: user.name || user.email || { en: 'The sender', fr: "L'expéditeur", ht: 'Moun ki te voye l la' }[lang],
          eventId,
        })
      })

      // If the recipient has an account, also create an in-app notification
      try {
        const recipientQuery = await adminDb
          .collection('users')
          .where('email', '==', String(transfer.to_email || '').toLowerCase())
          .limit(1)
          .get()

        if (!recipientQuery.empty) {
          const recipientDoc = recipientQuery.docs[0]
          await createNotification(
            recipientDoc.id,
            'ticket_transfer',
            'Ticket transfer cancelled',
            `${user.name || user.email || 'The sender'} cancelled the ticket transfer for "${eventTitle}".`,
            '/tickets',
            { ticketId: transfer?.ticket_id, eventTitle }
          )

          await sendPushNotification(
            recipientDoc.id,
            'Ticket transfer cancelled',
            `${user.name || user.email || 'The sender'} cancelled the ticket transfer for "${eventTitle}".`,
            '/notifications',
            { type: 'ticket_transfer', deepLink: 'tikem://notifications' }
          )
        }
      } catch (notifyError) {
        console.error('Failed to create cancellation notification:', notifyError)
      }
    } catch (emailError) {
      console.error('Failed to send cancellation notification:', emailError)
      // Continue - cancellation was successful
    }

    return NextResponse.json({
      success: true,
      status: 'cancelled'
    })

  } catch (error) {
    console.error('Transfer cancellation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
