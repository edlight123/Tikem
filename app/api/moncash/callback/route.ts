import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/firebase-db/server'
import { checkPaymentStatus } from '@/lib/moncash'
import { notifyTicketPurchase as notifyTicketPurchaseNotification } from '@/lib/notifications/helpers'
import { sendTicketConfirmation } from '@/lib/tickets/confirmation'
import { guestRecipientFromOrder } from '@/lib/guest/checkout'
import { attachTicketsToGuestOrder, guestTicketUrl, isGuestId } from '@/lib/guest/identity'
import { adminDb } from '@/lib/firebase/admin'
import { addTicketToEarnings } from '@/lib/earnings'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const transactionId = searchParams.get('transactionId')

    if (!transactionId) {
      return NextResponse.redirect(
        new URL('/purchase/failed?reason=missing_transaction', request.url)
      )
    }

    const supabase = await createClient()

    // Get pending transaction
    const { data: pendingTx, error: txError } = await supabase
      .from('pending_transactions')
      .select('*')
      .eq('transaction_id', transactionId)
      .single()

    if (txError || !pendingTx) {
      // If this was actually a MonCash Button return (misconfigured portal URL),
      // route it to the Button handler which correlates via cookie/orderId.
      const orderIdFromCookie = (await cookies()).get('moncash_button_order_id')?.value
      if (orderIdFromCookie) {
        const url = new URL('/api/moncash-button/return', request.url)
        url.searchParams.set('transactionId', transactionId)
        url.searchParams.set('orderId', orderIdFromCookie)
        return NextResponse.redirect(url)
      }

      return NextResponse.redirect(
        new URL('/purchase/failed?reason=transaction_not_found', request.url)
      )
    }

    // Verify payment with MonCash MerchantApi
    const paymentStatus = await checkPaymentStatus({ transactionId })

    if (paymentStatus.message !== 'successful') {
      // Update transaction status
      await supabase
        .from('pending_transactions')
        .update({ status: 'failed' })
        .eq('transaction_id', transactionId)

      return NextResponse.redirect(
        new URL('/purchase/failed?reason=payment_failed', request.url)
      )
    }

    // Fetch event and attendee by document id (direct get — no full-collection scan).
    const eventDoc = await adminDb.collection('events').doc(String(pendingTx.event_id)).get()
    const eventDetails = eventDoc.exists ? { id: eventDoc.id, ...(eventDoc.data() as any) } : null

    // Guest orders carry their buyer on the order itself (no users/{uid} to read).
    const guestRecipient = guestRecipientFromOrder(pendingTx)
    const attendeeDoc = guestRecipient
      ? null
      : await adminDb.collection('users').doc(String(pendingTx.user_id)).get()
    const attendee: any = guestRecipient
      ? { email: guestRecipient.email, full_name: guestRecipient.name, phone: guestRecipient.phone }
      : attendeeDoc?.exists
      ? { id: attendeeDoc.id, ...(attendeeDoc.data() as any) }
      : null

    // Create tickets one at a time to ensure each gets unique ID
    const quantity = pendingTx.quantity || 1
    const pricePerTicket = pendingTx.amount / quantity

    const eventCurrency = String(pendingTx.original_currency || pendingTx.currency || 'HTG').toUpperCase() === 'USD' ? 'USD' : 'HTG'
    const chargedCurrency = String(pendingTx.currency || 'HTG').toUpperCase() === 'USD' ? 'USD' : 'HTG'
    const fxRate = pendingTx.exchange_rate_used != null ? Number(pendingTx.exchange_rate_used) : null
    const organizerUnitPrice = (() => {
      if (eventCurrency === 'USD') {
        const fallback = Number(pendingTx.original_amount || 0) / Math.max(1, quantity)
        return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
      }
      return pricePerTicket
    })()

    /**
     * Who paid the platform fee on this sale — stamped on every ticket.
     *
     * The organizer. This rail charges the buyer the face value only (no fee is
     * added on top; only the Stripe paths price buyer incidence), so the fee
     * comes out of the organizer's proceeds. It used to be derived from the
     * EVENT's fee_incidence — a client-editable setting — so an organizer who
     * flipped it to 'buyer' had MonCash sales read as fee-free at payout while
     * no buyer ever paid the fee. Stamped from what the payment charged instead.
     */
    const feeIncidence = 'organizer' as const

    const createdTickets = []
    for (let i = 0; i < quantity; i++) {
      const ticketData = {
        fee_incidence: feeIncidence,
        event_id: pendingTx.event_id,
        attendee_id: pendingTx.user_id,
        attendee_name: attendee?.full_name || attendee?.email || 'Guest',
        ...(guestRecipient
          ? {
              is_guest: true,
              guest_email: guestRecipient.email,
              guest_phone: guestRecipient.phone || null,
            }
          : {}),
        // Organizer-facing/event currency
        price_paid: organizerUnitPrice,
        currency: eventCurrency,
        original_currency: eventCurrency,
        exchange_rate_used: fxRate,
        charged_amount: pricePerTicket,
        charged_currency: chargedCurrency,
        payment_method: 'moncash',
        payment_id: transactionId,
        status: 'valid',
        purchased_at: new Date().toISOString(),
        tier_name: pendingTx.tier_name || 'General Admission',
        tier_id: pendingTx.tier_id || null,
        // Include event date fields for scanner
        start_datetime: eventDetails?.start_datetime || null,
        end_datetime: eventDetails?.end_datetime || null,
        event_date: eventDetails?.start_datetime || null,
        venue_name: eventDetails?.venue_name || null,
        city: eventDetails?.city || null,
      }
      
      const insertResult = await supabase
        .from('tickets')
        .insert([ticketData])
        .select()
      
      if (insertResult.error) {
        console.error('Failed to create ticket:', insertResult.error)
        return NextResponse.redirect(
          new URL('/purchase/failed?reason=ticket_creation_failed', request.url)
        )
      }
      
      const createdTicket = insertResult.data?.[0]
      if (createdTicket) {
        // Now update with QR code data using the actual ticket ID
        await supabase
          .from('tickets')
          .update({ qr_code_data: createdTicket.id })
          .eq('id', createdTicket.id)
        
        createdTicket.qr_code_data = createdTicket.id
        createdTickets.push(createdTicket)
        console.log('Created ticket:', createdTicket.id, 'with QR:', createdTicket.id)

        // Mirror into Firestore for organizer earnings and admin analytics.
        try {
          await adminDb.collection('tickets').doc(String(createdTicket.id)).set(
            {
              event_id: pendingTx.event_id,
              attendee_id: pendingTx.user_id,
              // Status deliberately NOT set here. This is a merge onto the
              // ticket the insert already created as 'valid', and writing
              // 'confirmed' downgraded it into a value the payout engine's
              // filter did not accept — which made these sales impossible to
              // withdraw. The mirror carries data, not status.
              ticket_type: pendingTx.tier_name || 'General Admission',
              price_paid: organizerUnitPrice,
              currency: eventCurrency,
              exchange_rate_used: fxRate,
              charged_amount: pricePerTicket,
              charged_currency: chargedCurrency,
              payment_method: 'moncash',
              payment_id: transactionId,
              purchased_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { merge: true }
          )
        } catch (e) {
          console.warn('[moncash] failed to mirror ticket to Firestore', {
            ticketId: createdTicket.id,
            message: (e as any)?.message,
          })
        }
      }
    }
    
    // Create ticket object with joined data for email
    const ticket = createdTickets[0] ? {
      ...createdTickets[0],
      event: eventDetails,
      attendee
    } : null

    // Update transaction status
    await supabase
      .from('pending_transactions')
      .update({ 
        status: 'completed',
        ticket_id: ticket.id,
      })
      .eq('transaction_id', transactionId)

    // Update tickets_sold count
    const { data: eventData } = await supabase
      .from('events')
      .select('tickets_sold')
      .eq('id', pendingTx.event_id)
      .single()

    if (eventData) {
      await supabase
        .from('events')
        .update({ tickets_sold: (eventData.tickets_sold || 0) + quantity })
        .eq('id', pendingTx.event_id)
    }

    // Update Firestore earnings in event currency.
    try {
      const grossEventCents = Math.round(Number(pendingTx.original_amount || pendingTx.amount || 0) * 100)
      await addTicketToEarnings(pendingTx.event_id, grossEventCents, Number(quantity || 1), {
        currency: eventCurrency,
        paymentMethod: 'moncash',
        chargedAmountCents: Math.round(Number(pendingTx.amount || 0) * 100),
        fxRate,
        chargedCurrency,
      })
    } catch (e) {
      console.warn('[moncash] failed to update earnings', { message: (e as any)?.message })
    }

    // Record the issued tickets against a guest order so the retrieval link works.
    if (guestRecipient && pendingTx.guest_order_key) {
      await attachTicketsToGuestOrder(
        String(pendingTx.guest_order_key),
        createdTickets.map((t: any) => String(t.id))
      )
    }

    // In-app + push notification (same pipeline as Stripe purchases). A guest has no
    // account for it to land in.
    if (pendingTx.user_id && !isGuestId(pendingTx.user_id) && pendingTx.event_id) {
      try {
        await notifyTicketPurchaseNotification(
          String(pendingTx.user_id),
          String(pendingTx.event_id),
          String(eventDetails?.title || 'Event'),
          createdTickets.length || quantity
        )
      } catch (error) {
        console.error('MonCash callback: failed to send purchase notification', error)
      }
    }

    // Deliver the ticket: email with the QR always, plus SMS for a guest / WhatsApp
    // for an account holder.
    if (ticket.attendee && ticket.event) {
      await sendTicketConfirmation({
        ticketId: String(ticket.id),
        qrPayload: ticket.qr_code_data || ticket.id,
        event: ticket.event,
        recipient: {
          email: ticket.attendee.email,
          name: ticket.attendee.full_name,
          phone: ticket.attendee.phone,
          isGuest: Boolean(guestRecipient),
        },
        quantity,
        guestToken: guestRecipient?.guestToken || null,
        logPrefix: '[moncash]',
      })
    }

    // A guest has no /tickets page — send them to their own signed ticket link.
    if (guestRecipient?.guestToken) {
      return NextResponse.redirect(
        new URL(`${guestTicketUrl(guestRecipient.guestToken)}?purchased=1`, request.url)
      )
    }

    // Redirect to success page
    return NextResponse.redirect(
      new URL(`/purchase/success?ticketId=${ticket.id}`, request.url)
    )
  } catch (error: any) {
    console.error('MonCash callback error:', error)
    return NextResponse.redirect(
      new URL('/purchase/failed?reason=processing_error', request.url)
    )
  }
}
