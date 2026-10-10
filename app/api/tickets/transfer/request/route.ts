// API Route: POST /api/tickets/transfer/request
// Initiate a ticket transfer to another user

import { adminDb } from '@/lib/firebase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'

const transferRequestSchema = z.object({
  ticketId: z.string().min(1),
  toEmail: z.string().email(),
  message: z.string().max(500).optional()
})

export async function POST(request: NextRequest) {
  try {
    // Get current user using auth helper
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Validate request body
    const body = await request.json()
    const validation = transferRequestSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.errors },
        { status: 400 }
      )
    }

    const { ticketId, toEmail, message } = validation.data

    // Prevent self-transfer
    if (toEmail.toLowerCase() === user.email?.toLowerCase()) {
      return NextResponse.json(
        { error: 'Cannot transfer ticket to yourself' },
        { status: 400 }
      )
    }

    // Verify ticket ownership and status using Firestore
    const ticketDoc = await adminDb.collection('tickets').doc(ticketId).get()
    
    if (!ticketDoc.exists) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      )
    }

    const ticket = ticketDoc.data()
    
    // Verify ownership
    if (ticket?.attendee_id !== user.id && ticket?.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Ticket not found or not owned by you' },
        { status: 404 }
      )
    }

    if (ticket.status !== 'active' && ticket.status !== 'valid' && ticket.status !== 'confirmed') {
      return NextResponse.json(
        { error: `Cannot transfer ticket with status: ${ticket.status}` },
        { status: 400 }
      )
    }

    if (ticket.checked_in || ticket.checked_in_at) {
      return NextResponse.json(
        { error: 'Cannot transfer a ticket that has been checked in' },
        { status: 400 }
      )
    }

    // A ticket with a refund requested, under review or in flight is not
    // transferable: the money may go back to the buyer while the seat moves on.
    const refundStatus = String(ticket.refund_status ?? '').toLowerCase().trim()
    if (refundStatus && refundStatus !== 'none' && refundStatus !== 'denied') {
      return NextResponse.json(
        { error: 'This ticket has a refund in progress and cannot be transferred', code: 'refund_in_progress' },
        { status: 400 }
      )
    }

    // Check for existing pending transfers using Firestore
    const existingTransfers = await adminDb.collection('ticket_transfers')
      .where('ticket_id', '==', ticketId)
      .where('status', '==', 'pending')
      .limit(1)
      .get()

    if (!existingTransfers.empty) {
      return NextResponse.json(
        { error: 'A pending transfer already exists for this ticket' },
        { status: 400 }
      )
    }

    // Get event details
    const eventDoc = await adminDb.collection('events').doc(ticket.event_id).get()
    const event = eventDoc.data()

    // Check if event allows transfers
    if (event?.start_datetime) {
      const eventDate = new Date(event.start_datetime)
      if (eventDate < new Date()) {
        return NextResponse.json(
          { error: 'Cannot transfer tickets for past events' },
          { status: 400 }
        )
      }
    }

    // Generate unique transfer token using crypto for security
    const transferToken = `transfer_${crypto.randomUUID()}`
    
    // Set 24-hour expiry
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 24)

    // Create transfer request - use Firestore directly
    const transferId = `transfer_${crypto.randomUUID()}`
    const transferData = {
      id: transferId,
      ticket_id: ticketId,
      from_user_id: user.id,
      to_email: toEmail.toLowerCase(),
      to_user_id: null,
      status: 'pending',
      message: message || null,
      transfer_token: transferToken,
      requested_at: new Date().toISOString(),
      responded_at: null,
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    console.log('Creating transfer with Firestore directly:', transferId)

    try {
      await adminDb.collection('ticket_transfers').doc(transferId).set(transferData)
      console.log('Transfer created successfully in Firestore')
    } catch (firestoreError: any) {
      console.error('Firestore error:', firestoreError)
      return NextResponse.json(
        { error: 'Failed to create transfer request', details: firestoreError.message },
        { status: 500 }
      )
    }

    // Use transferData as the transfer object for response
    const transfer = transferData

    // Send email notification to recipient
    try {
      const { sendEmail, getTicketTransferRequestEmail, emailSubjects } = await import('@/lib/email')
      const { resolveEmailLang } = await import('@/lib/email-kit/recipient')
      const { formatEventWhen } = await import('@/lib/email-kit/i18n')
      
      // Get sender info from Firestore
      const senderDoc = await adminDb.collection('users').doc(user.id).get()
      const sender = senderDoc.data()

      // Check if recipient has account with phone number using Firestore. Looked up
      // before the email so their profile language can pick the email's language.
      const recipientQuery = await adminDb.collection('users')
        .where('email', '==', toEmail.toLowerCase())
        .limit(1)
        .get()

      const lang = await resolveEmailLang({
        explicit: recipientQuery.empty ? null : (recipientQuery.docs[0].data() as any)?.language,
        event,
      })
      const friend = { en: 'A friend', fr: 'Un ami', ht: 'Yon zanmi' }[lang]
      const senderName = sender?.full_name || sender?.name || friend
      await sendEmail({
        to: toEmail,
        subject: emailSubjects.transferRequest(lang, senderName),
        html: getTicketTransferRequestEmail({
          lang,
          senderName,
          senderEmail: sender?.email || user.email || '',
          eventTitle: event?.title || 'Event',
          eventDate: formatEventWhen(event?.start_datetime, lang, event)?.line || '',
          message: message || '',
          transferToken: transfer.transfer_token,
          expiresAt: formatEventWhen(transfer.expires_at, lang, event)?.line || transfer.expires_at,
          posterUrl: String(event?.banner_image_url || '').trim() || null,
        })
      })

      if (!recipientQuery.empty) {
        const recipientDoc = recipientQuery.docs[0]
        const recipient = recipientDoc.data()

        // Create in-app notification for recipient
        try {
          await createNotification(
            recipientDoc.id,
            'ticket_transfer',
            'Ticket transfer request',
            `${sender?.full_name || sender?.name || 'Someone'} wants to transfer you a ticket for "${event?.title || 'an event'}".`,
            `/tickets/transfer/${transfer.transfer_token}`,
            { eventId: ticket.event_id, ticketId }
          )

          // Best-effort push (mobile + web)
          await sendPushNotification(
            recipientDoc.id,
            'Ticket transfer request',
            `${sender?.full_name || sender?.name || 'Someone'} wants to transfer you a ticket for "${event?.title || 'an event'}".`,
            '/notifications',
            { type: 'ticket_transfer', deepLink: 'tikem://notifications', eventId: ticket.event_id, ticketId }
          )
        } catch (notifyError) {
          console.error('Failed to create transfer notification:', notifyError)
        }

        if (recipient?.phone) {
          try {
            const { sendSms, getTicketTransferSms } = await import('@/lib/sms')
            await sendSms({
              to: recipient.phone,
              message: getTicketTransferSms({
                senderName: sender?.full_name || sender?.name || 'A friend',
                eventTitle: event?.title || 'Event',
                transferUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'}/tickets/transfer/${transfer.transfer_token}`
              })
            })
          } catch (smsError) {
            console.error('Failed to send SMS notification:', smsError)
            // Continue - email was sent
          }
        }
      }
    } catch (emailError) {
      console.error('Failed to send transfer notification:', emailError)
      // Continue - transfer was created successfully
    }

    return NextResponse.json({
      success: true,
      transfer: {
        id: transfer.id,
        status: transfer.status,
        toEmail: transfer.to_email,
        transferToken: transfer.transfer_token,
        expiresAt: transfer.expires_at
      }
    })

  } catch (error) {
    console.error('Transfer request error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
