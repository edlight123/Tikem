import { NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { sendTicketConfirmation } from '@/lib/tickets/confirmation'
import { guestRecipientFromOrder } from '@/lib/guest/checkout'
import { attachTicketsToGuestOrder, guestTicketUrl, isGuestId } from '@/lib/guest/identity'
import { notifyTicketPurchase, notifyOrganizerTicketSale } from '@/lib/notifications/helpers'
import { FieldValue } from 'firebase-admin/firestore'
import {
  buildTierSoldIncrements,
  reserveInventoryAtomic,
  releaseInventoryReservation,
} from '@/lib/tickets/inventory'
import {
  claimWebhookEvent,
  markWebhookEventCompleted,
  releaseWebhookEvent,
} from '@/lib/webhooks/idempotency'
import { promoBuyerKey, redeemPromoInTransaction } from '@/lib/promo-codes'
import { recordPromoterSale } from '@/lib/promoters'
import { attributionFromStripeMetadata, ticketAttributionFields } from '@/lib/attribution'
import { recordAttributedSale } from '@/lib/tracking-links'

// Lazy load Stripe
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

export async function POST(request: Request) {
  // Scoped so the outer catch can release the shared fulfillment claim on failure.
  let fulfillId: string | null = null
  try {
    const user = await getCurrentUser()

    const { paymentIntentId } = await request.json()

    if (!paymentIntentId) {
      return NextResponse.json({ error: 'Payment Intent ID is required' }, { status: 400 })
    }

    const stripe = getStripe()

    // Verify payment intent exists and succeeded
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

    if (paymentIntent.status !== 'succeeded') {
      return NextResponse.json({ error: 'Payment not completed' }, { status: 400 })
    }

    // WHO this order belongs to — read off the PaymentIntent, which was stamped before
    // payment by create-payment-intent. Nothing in the request body is trusted for it.
    const piGuestRecipient = guestRecipientFromOrder({
      is_guest: paymentIntent.metadata.isGuest === 'true',
      user_id: paymentIntent.metadata.userId,
      guest_name: paymentIntent.metadata.guestName,
      guest_email: paymentIntent.metadata.guestEmail,
      guest_phone: paymentIntent.metadata.guestPhone,
      guest_order_key: paymentIntent.metadata.guestOrderKey,
    })

    // A session is still required for an ACCOUNT order. A guest order has no session by
    // definition; what stands in for one is the succeeded PaymentIntent itself, whose id
    // only the browser that just paid holds. (The Stripe webhook fulfills the same order
    // through the same shared claim, so this call is a fast path, not the only path.)
    if (!user && !piGuestRecipient) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if tickets already exist for this payment in Firestore
    const existingTicketsSnapshot = await adminDb
      .collection('tickets')
      .where('payment_id', '==', paymentIntentId)
      .limit(1)
      .get()

    if (!existingTicketsSnapshot.empty) {
      console.log('✅ Tickets already exist for payment:', paymentIntentId)
      return NextResponse.json({
        success: true,
        ticketIds: existingTicketsSnapshot.docs.map((doc: any) => doc.id),
        message: 'Tickets already created'
      })
    }

    // Shared idempotency claim keyed on the Stripe payment_intent id. The webhook's
    // payment_intent.succeeded handler claims the SAME key, so whichever path (this client
    // "confirm" call or the async webhook) runs first fulfills, and the other is a no-op.
    // This closes the race where both paths pass the payment_id existence check and each
    // create a duplicate set of tickets / double-increment inventory.
    fulfillId = `pi_fulfill_${paymentIntentId}`
    const claim = await claimWebhookEvent({
      provider: 'stripe',
      eventId: fulfillId,
      eventType: 'payment_intent.client_confirm',
    })
    if (claim.outcome !== 'claimed') {
      // Another path owns (or already finished) fulfillment. Return whatever tickets exist.
      const snap = await adminDb
        .collection('tickets')
        .where('payment_id', '==', paymentIntentId)
        .get()
      return NextResponse.json({
        success: true,
        ticketIds: snap.docs.map((doc: any) => doc.id),
        message: snap.empty ? 'Ticket creation already in progress' : 'Tickets already created',
      })
    }

    // Create tickets
    const quantity = parseInt(paymentIntent.metadata.quantity || '1', 10)
    const pricePerTicket = paymentIntent.amount / 100 / quantity

    // Authoritative oversell gate: atomically reserve inventory BEFORE issuing tickets — the
    // same gate the webhook uses. If the event/tier is now full, refund and stop.
    const tierIncrements = buildTierSoldIncrements(
      paymentIntent.metadata.tierId ? [{ tierId: paymentIntent.metadata.tierId, quantity }] : []
    )
    const reservation = await reserveInventoryAtomic({
      eventId: paymentIntent.metadata.eventId,
      quantity,
      tierIncrements,
      logPrefix: '[create-from-payment]',
    })
    if (!reservation.ok) {
      console.error('[create-from-payment] capacity exceeded after payment — auto-refunding', {
        paymentIntentId,
        reason: reservation.reason,
      })
      try {
        await stripe.refunds.create({ payment_intent: paymentIntentId })
      } catch (refundErr) {
        console.error('[create-from-payment] failed to auto-refund oversold payment', refundErr)
      }
      await markWebhookEventCompleted({
        provider: 'stripe',
        eventId: fulfillId,
        metadata: { type: 'payment_intent.client_confirm', refunded: 'capacity_exceeded' },
      })
      return NextResponse.json(
        { error: 'Event capacity exceeded; your payment has been refunded.' },
        { status: 409 }
      )
    }

    // Fetch event details to include in tickets
    const eventDoc = await adminDb.collection('events').doc(paymentIntent.metadata.eventId).get()
    const eventDetails = eventDoc.exists ? eventDoc.data() : null
    
    // Fetch attendee details for attendee_name. A guest has no user document — their
    // name/email/phone were captured at checkout and live on the order.
    const attendee: any = piGuestRecipient
      ? {
          email: piGuestRecipient.email,
          full_name: piGuestRecipient.name,
          phone: piGuestRecipient.phone,
        }
      : await (async () => {
          const attendeeDoc = await adminDb.collection('users').doc(paymentIntent.metadata.userId).get()
          return attendeeDoc.exists ? attendeeDoc.data() : null
        })()

    // Visit attribution stamped at create-payment-intent (tracking link + utm +
    // resolved promoter). Carried onto every ticket, counted on the link once.
    const attribution = attributionFromStripeMetadata(paymentIntent.metadata)

    const createdTickets = []
    for (let i = 0; i < quantity; i++) {
      const eventCurrency = String(paymentIntent.metadata.originalCurrency || '').toUpperCase() || 'USD'
      const priceInOriginalCurrency = Number(paymentIntent.metadata.priceInOriginalCurrency || paymentIntent.metadata.finalPrice || 0)

      const normalizedEventCurrency = (() => {
        const upper = String(eventCurrency || '').toUpperCase()
        if (upper === 'HTG') return 'HTG'
        if (upper === 'CAD') return 'CAD'
        return 'USD'
      })()

      const ticketData = {
        event_id: paymentIntent.metadata.eventId,
        attendee_id: paymentIntent.metadata.userId,
        user_id: paymentIntent.metadata.userId,
        attendee_name: attendee?.full_name || attendee?.email || 'Guest',
        // Guest tickets carry the buyer's contact details so refunds and support can
        // find the order by email or phone without a uid to join on.
        ...(piGuestRecipient
          ? {
              is_guest: true,
              guest_email: piGuestRecipient.email,
              guest_phone: piGuestRecipient.phone || null,
            }
          : {}),
        // Organizer-facing/event-currency amount.
        price_paid: Number.isFinite(priceInOriginalCurrency) && priceInOriginalCurrency > 0 ? priceInOriginalCurrency : pricePerTicket,
        currency: normalizedEventCurrency,
        original_currency: normalizedEventCurrency,
        // When conversion occurs, this is the settlement-per-event rate (e.g., USD per HTG for Stripe).
        exchange_rate_used: paymentIntent.metadata.exchangeRate ? parseFloat(paymentIntent.metadata.exchangeRate) : null,
        // WHO paid the fee on this order, stamped from the PaymentIntent that
        // actually charged the card. The organizer earnings ledger reads it: under
        // buyer incidence the organizer nets the face value, so deducting a fee
        // from their gross would under-report what they are owed. Recorded per
        // ticket rather than derived from the event's country at read time, so
        // changing a country's fee model never rewrites past sales — a ticket with
        // no value predates the buyer-pays rollout and was organizer-paid.
        fee_incidence: paymentIntent.metadata.feeIncidence === 'buyer' ? 'buyer' : 'organizer',
        // Admin/auditing fields (charged/settlement amounts)
        charged_amount: pricePerTicket,
        charged_currency: String(paymentIntent.currency || 'usd').toUpperCase(),
        // Same rule as the webhook: a destination charge is 'stripe_connect', so a
        // refund knows to pull the money back from the organizer's account.
        payment_method: paymentIntent.metadata.payoutProvider === 'stripe_connect' ? 'stripe_connect' : 'stripe',
        payment_id: paymentIntentId,
        // Promoter attribution: opaque identifiers only — the commission economics
        // live in the server-only promoter_sales ledger, never on the ticket.
        promoter_id: paymentIntent.metadata.promoterId || null,
        promoter_code: paymentIntent.metadata.promoterCode || null,
        ...ticketAttributionFields(attribution),
        status: 'valid',
        purchased_at: FieldValue.serverTimestamp(),
        // Stamp the exact tier id at issuance for reliable scan-time tier lookup by id.
        tier_id: paymentIntent.metadata.tierId || '',
        tier_name: paymentIntent.metadata.tierName || 'General Admission',
        // Include event date fields for scanner
        start_datetime: eventDetails?.start_datetime || null,
        end_datetime: eventDetails?.end_datetime || null,
        event_date: eventDetails?.start_datetime || null,
        venue_name: eventDetails?.venue_name || null,
        city: eventDetails?.city || null,
      }
      
      const ticketRef = await adminDb.collection('tickets').add(ticketData)
      
      // Now update with QR code data using the actual ticket ID
      await ticketRef.update({ qr_code_data: ticketRef.id })
      
      const createdTicketDoc = await ticketRef.get()
      const createdTicket = { id: createdTicketDoc.id, ...createdTicketDoc.data() }
      
      console.log('=== TICKET CREATION DEBUG ===')
      console.log('Created Ticket ID:', createdTicket.id)
      console.log('Event ID:', createdTicket.event_id)
      console.log('Attendee Name:', createdTicket.attendee_name)
      console.log('Has start_datetime:', !!createdTicket.start_datetime)
      console.log('Has venue_name:', !!createdTicket.venue_name)
      console.log('Full Ticket Data:', JSON.stringify(createdTicket, null, 2))
      console.log('=== END DEBUG ===')
      createdTickets.push(createdTicket)
    }

    if (createdTickets.length === 0) {
      // Return the reserved-but-unissued inventory and release the claim so a retry can re-fulfill.
      await releaseInventoryReservation({
        eventId: paymentIntent.metadata.eventId,
        quantity,
        tierIncrements,
        logPrefix: '[create-from-payment]',
      })
      await releaseWebhookEvent({ provider: 'stripe', eventId: fulfillId })
      return NextResponse.json({ error: 'Failed to create tickets' }, { status: 500 })
    }

    // Inventory was already reserved/incremented atomically by reserveInventoryAtomic above —
    // do NOT increment again here. Mark the shared claim completed so the webhook no-ops.
    await markWebhookEventCompleted({
      provider: 'stripe',
      eventId: fulfillId,
      metadata: { type: 'payment_intent.client_confirm', tickets: createdTickets.length },
    })

    // Redeem the promo code atomically (Firestore). This client-confirm path and the Stripe
    // webhook's payment_intent.succeeded handler share the pi_fulfill_<id> claim, so exactly ONE
    // of them ever fulfills a given order — whichever won reaches here and redeems once (no
    // double-count). metadata.promoCodeId is the resolved Firestore doc id, stamped by
    // create-payment-intent only when a discount was actually applied. If the cap filled between
    // pricing and confirm we keep the issued tickets and only log; redemption never throws.
    if (paymentIntent.metadata.promoCodeId) {
      try {
        const originalPrice = parseFloat(paymentIntent.metadata.originalPrice || '0')
        const finalPrice = parseFloat(paymentIntent.metadata.finalPrice || '0')
        const perTicketDiscount =
          Number.isFinite(originalPrice) && Number.isFinite(finalPrice)
            ? Math.max(0, originalPrice - finalPrice)
            : 0
        const redeem = await redeemPromoInTransaction({
          promoId: paymentIntent.metadata.promoCodeId,
          qty: quantity,
          userId: paymentIntent.metadata.userId,
          // A guest's `metadata.userId` is a per-order `guest_…` id, useless for a
          // per-buyer cap. The email they gave before paying is the identity that
          // persists, and it was fixed on the order at that moment — so it cannot be
          // swapped after the fact.
          buyerKey: promoBuyerKey({
            isGuest: paymentIntent.metadata.isGuest === 'true',
            id: paymentIntent.metadata.userId,
            email: paymentIntent.metadata.guestEmail,
            phone: paymentIntent.metadata.guestPhone,
          }),
          eventId: paymentIntent.metadata.eventId,
          discountApplied: perTicketDiscount * quantity,
        })
        if (redeem.capReached) {
          console.warn('[create-from-payment] promo cap reached at confirm; tickets kept, not over-counted', {
            promoId: paymentIntent.metadata.promoCodeId,
            eventId: paymentIntent.metadata.eventId,
          })
        }
      } catch (promoErr) {
        console.error('[create-from-payment] promo redemption failed', (promoErr as any)?.message)
      }
    }

    // Attribute the sale to its promoter — same exactly-once claim as the promo
    // redemption above, and like it, a bookkeeping failure never breaks the sale.
    if (paymentIntent.metadata.promoterId) {
      const unitFace = parseFloat(
        paymentIntent.metadata.priceInOriginalCurrency || paymentIntent.metadata.finalPrice || '0'
      )
      await recordPromoterSale({
        promoterId: paymentIntent.metadata.promoterId,
        eventId: paymentIntent.metadata.eventId,
        ticketIds: createdTickets.map((t: any) => String(t.id)),
        quantity,
        orderGrossCents: Math.round((Number.isFinite(unitFace) ? unitFace : 0) * quantity * 100),
        currency: String(paymentIntent.metadata.originalCurrency || 'USD').toUpperCase(),
        paymentMethod: 'stripe',
        paymentId: paymentIntentId,
        buyerUserId: paymentIntent.metadata.isGuest === 'true' ? null : paymentIntent.metadata.userId,
        buyerEmail: paymentIntent.metadata.guestEmail || attendee?.email || null,
      })
    }

    // Count the order on its tracking link. Keyed on the PaymentIntent id — the
    // same key the webhook uses — so whichever path fulfils, it counts once.
    {
      const unitFace = parseFloat(
        paymentIntent.metadata.priceInOriginalCurrency || paymentIntent.metadata.finalPrice || '0'
      )
      await recordAttributedSale(attribution, {
        eventId: paymentIntent.metadata.eventId,
        orderKey: paymentIntentId,
        quantity,
        revenueCents: Math.round((Number.isFinite(unitFace) ? unitFace : 0) * quantity * 100),
        currency: String(paymentIntent.metadata.originalCurrency || 'USD').toUpperCase(),
        paymentMethod: 'stripe',
      })
    }

    // Attach the issued tickets to the guest order so the buyer's retrieval link works.
    if (piGuestRecipient && paymentIntent.metadata.guestOrderKey) {
      await attachTicketsToGuestOrder(
        String(paymentIntent.metadata.guestOrderKey),
        createdTickets.map((t: any) => String(t.id))
      )
    }

    // Send notification
    if (eventDetails) {
      try {
        // In-app notifications need an account to land in; a guest has none.
        if (!isGuestId(paymentIntent.metadata.userId)) {
          await notifyTicketPurchase(
            paymentIntent.metadata.userId,
            paymentIntent.metadata.eventId,
            eventDetails.title,
            quantity
          )
        }

        // Notify organizer about the sale
        await notifyOrganizerTicketSale(
          eventDetails.organizer_id,
          paymentIntent.metadata.eventId,
          eventDetails.title,
          quantity,
          paymentIntent.amount / 100,
          attendee?.full_name
        )
      } catch (error) {
        console.error('Failed to send notification:', error)
      }

      // Send the ticket (email always; SMS for a guest, WhatsApp for an account).
      if (attendee) {
        const firstTicket = createdTickets[0]
        await sendTicketConfirmation({
          ticketId: String(firstTicket.id),
          qrPayload: (firstTicket as any).qr_code_data || firstTicket.id,
          event: eventDetails as any,
          recipient: {
            email: attendee.email,
            name: attendee.full_name,
            phone: attendee.phone,
            isGuest: Boolean(piGuestRecipient),
          },
          quantity,
          guestToken: piGuestRecipient?.guestToken || null,
          logPrefix: '[create-from-payment]',
        })
      }
    }

    return NextResponse.json({
      success: true,
      ticketIds: createdTickets.map((t: any) => t.id),
      // A guest has no /tickets page — hand back their own signed link.
      ...(piGuestRecipient?.guestToken
        ? { guestTicketUrl: guestTicketUrl(piGuestRecipient.guestToken) }
        : {}),
      message: `${createdTickets.length} ticket(s) created successfully`
    })
  } catch (error: any) {
    console.error('Ticket creation error:', error)
    // Release the shared claim so Stripe's webhook (or a client retry) can re-fulfill this order
    // instead of being permanently blocked as "in progress".
    if (fulfillId) {
      await releaseWebhookEvent({ provider: 'stripe', eventId: fulfillId })
    }
    return NextResponse.json(
      { error: error.message || 'Failed to create tickets' },
      { status: 500 }
    )
  }
}
