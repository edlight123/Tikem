import { NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { sendTicketConfirmation } from '@/lib/tickets/confirmation'
import { guestRecipientFromOrder } from '@/lib/guest/checkout'
import { attachTicketsToGuestOrder, isGuestId } from '@/lib/guest/identity'
import { promoBuyerKey, redeemPromoInTransaction } from '@/lib/promo-codes'
import { recordPromoterSale } from '@/lib/promoters'
import { attributionFromStripeMetadata, ticketAttributionFields } from '@/lib/attribution'
import { recordAttributedSale } from '@/lib/tracking-links'
import { notifyTicketPurchase, notifyOrganizerTicketSale } from '@/lib/notifications/helpers'
import { onSaleCompleted } from '@/lib/notifications/campaigns'
import { addTicketToEarnings } from '@/lib/earnings'
import { adminDb } from '@/lib/firebase/admin'
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
import { handleStripeDisputeEvent } from '@/lib/disputes'

/**
 * Chargeback events.
 *
 * Tikèm is MERCHANT OF RECORD on the Stripe rail (destination charges,
 * `on_behalf_of` never set), so a cardholder's dispute lands on the PLATFORM
 * account and arrives on THIS endpoint — not on a Connect endpoint.
 *
 *  - created / updated / closed  → the lifecycle: opened, evidence state changed,
 *    resolved. `created` is what starts the organizer's evidence clock.
 *  - funds_withdrawn / funds_reinstated → included deliberately. Status alone never
 *    says whether the money has actually left our balance; these two do, and as
 *    merchant of record that debit is ours. They are recorded as timestamps on the
 *    dispute so a later reconciliation can tell "disputed" from "already debited"
 *    without asking Stripe again. Neither notifies anyone — no human action follows.
 */
const DISPUTE_EVENT_TYPES = new Set([
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
])

// Event types this webhook actually fulfills. Only these are deduped/claimed.
const HANDLED_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'payment_intent.succeeded',
  ...DISPUTE_EVENT_TYPES,
])

// Lazy load Stripe to avoid build-time initialization
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

export async function POST(request: Request) {
  let stripeEvent: any = null
  // Shared payment_intent-scoped claim id — set when handling payment_intent.succeeded so the
  // outer catch can release it (the client-confirm route create-from-payment claims the same key).
  let piFulfillId: string | null = null
  try {
    const stripe = getStripe()
    const body = await request.text()
    const signature = request.headers.get('stripe-signature')

    if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
    }

    // Verify webhook signature
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    )
    stripeEvent = event

    // Idempotency: Stripe delivers events at least once. Dedupe on the stable event id so a
    // redelivery (or a concurrent delivery) never creates a second set of tickets, double-counts
    // earnings, or double-increments inventory.
    if (HANDLED_EVENT_TYPES.has(event.type)) {
      const claim = await claimWebhookEvent({
        provider: 'stripe',
        eventId: event.id,
        eventType: event.type,
      })
      if (claim.outcome !== 'claimed') {
        console.log('[stripe] skipping duplicate webhook delivery', {
          eventId: event.id,
          type: event.type,
          outcome: claim.outcome,
        })
        return NextResponse.json({ received: true, idempotent: true, outcome: claim.outcome })
      }
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object

      // Create tickets in database
      const supabase = await createClient()
      const quantity = parseInt(session.metadata.quantity || '1', 10)
      const pricePerTicket = session.amount_total / 100 / quantity // Total price divided by quantity
      const originalCurrency = String(session.metadata.originalCurrency || '').toUpperCase() || 'USD'
      const normalizedOriginalCurrency = (() => {
        if (originalCurrency === 'HTG') return 'HTG'
        if (originalCurrency === 'CAD') return 'CAD'
        return 'USD'
      })()
      const priceInOriginalCurrency = Number(session.metadata.priceInOriginalCurrency || session.metadata.finalPrice || 0)
      const exchangeRateUsed = session.metadata.exchangeRate ? parseFloat(session.metadata.exchangeRate) : null
      const payoutProvider = String(session.metadata.payoutProvider || '').toLowerCase()
      const paymentMethod = payoutProvider === 'stripe_connect' ? 'stripe_connect' : 'stripe'
      // Visit attribution stamped into the session metadata at
      // create-checkout-session; carried onto every ticket below.
      const sessionAttribution = attributionFromStripeMetadata(session.metadata)

      // Authoritative oversell gate: atomically reserve inventory BEFORE creating tickets. If the
      // event/tier is now full, the customer has paid but we can't honor it — auto-refund and stop.
      const checkoutTierIncrements = buildTierSoldIncrements(
        session.metadata.tierId ? [{ tierId: session.metadata.tierId, quantity }] : []
      )
      const checkoutReservation = await reserveInventoryAtomic({
        eventId: session.metadata.eventId,
        quantity,
        tierIncrements: checkoutTierIncrements,
        logPrefix: '[stripe]',
      })
      if (!checkoutReservation.ok) {
        console.error('[stripe] capacity exceeded after payment — auto-refunding checkout session', {
          sessionId: session.id,
          paymentIntent: session.payment_intent,
          reason: checkoutReservation.reason,
        })
        try {
          if (session.payment_intent) {
            await stripe.refunds.create({ payment_intent: session.payment_intent })
          }
        } catch (refundErr) {
          console.error('[stripe] failed to auto-refund oversold checkout session', refundErr)
        }
        await markWebhookEventCompleted({
          provider: 'stripe',
          eventId: event.id,
          metadata: { type: event.type, refunded: 'capacity_exceeded' },
        })
        return NextResponse.json({ received: true, refunded: 'capacity_exceeded' })
      }

      // Create tickets one at a time to ensure each gets unique ID
      const createdTickets = []
      for (let i = 0; i < quantity; i++) {
        const qrCodeData = `ticket-${session.metadata.eventId}-${session.client_reference_id}-${Date.now()}-${i}`
        const ticketData = {
          event_id: session.metadata.eventId,
          attendee_id: session.client_reference_id,
          // Organizer-facing/event-currency amount.
          price_paid: Number.isFinite(priceInOriginalCurrency) && priceInOriginalCurrency > 0 ? priceInOriginalCurrency : pricePerTicket,
          currency: normalizedOriginalCurrency,
          original_currency: normalizedOriginalCurrency,
          // settlement-per-event rate (USD per HTG for Stripe when event is HTG)
          exchange_rate_used: exchangeRateUsed,
          payment_method: paymentMethod,
          payment_id: session.payment_intent,
          ...ticketAttributionFields(sessionAttribution),
          status: 'valid',
          qr_code_data: qrCodeData,
          purchased_at: new Date().toISOString(),
          // Stamp the exact tier id at issuance so scan-time validity can look up the tier by
          // id instead of by fragile name. '' when the checkout had no tier metadata.
          tier_id: session.metadata.tierId || '',
        }

        const insertResult = await supabase
          .from('tickets')
          .insert([ticketData])
          .select()

        if (insertResult.error) {
          console.error('Failed to create ticket:', insertResult.error)
          await releaseInventoryReservation({
            eventId: session.metadata.eventId,
            quantity,
            tierIncrements: checkoutTierIncrements,
            logPrefix: '[stripe]',
          })
          return NextResponse.json({ error: 'Failed to create tickets' }, { status: 500 })
        }
        
        const createdTicket = insertResult.data?.[0]
        if (createdTicket) {
          createdTickets.push(createdTicket)
          console.log('Created ticket:', createdTicket.id, 'with QR:', qrCodeData)

          // Mirror into Firestore for organizer earnings/admin analytics.
          try {
            await adminDb.collection('tickets').doc(String(createdTicket.id)).set(
              {
                event_id: session.metadata.eventId,
                attendee_id: session.client_reference_id,
                status: 'confirmed',
                ticket_type: createdTicket.tier_name || createdTicket.tierName || 'General Admission',
                tier_id: session.metadata.tierId || '',
                price_paid: ticketData.price_paid,
                currency: ticketData.currency,
                exchange_rate_used: ticketData.exchange_rate_used ?? null,
                charged_amount: pricePerTicket,
                charged_currency: String(session.currency || 'usd').toUpperCase(),
                payment_method: paymentMethod,
                payment_id: session.payment_intent,
                // Who paid the fee, from the session that took the money. The
                // earnings ledger reads it; a ticket without it predates the
                // buyer-pays rollout and was organizer-paid.
                fee_incidence: session.metadata.feeIncidence === 'buyer' ? 'buyer' : 'organizer',
                ...ticketAttributionFields(sessionAttribution),
                purchased_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              { merge: true }
            )
          } catch (e) {
            console.warn('[stripe] failed to mirror ticket to Firestore', {
              ticketId: createdTicket.id,
              message: (e as any)?.message,
            })
          }
        }
      }

      // Fetch event and attendee by document id (direct get — no full-collection scan).
      const eventDoc = await adminDb.collection('events').doc(String(session.metadata.eventId)).get()
      const eventDetails = eventDoc.exists ? { id: eventDoc.id, ...(eventDoc.data() as any) } : null

      const attendeeDoc = await adminDb.collection('users').doc(String(session.client_reference_id)).get()
      const attendee = attendeeDoc.exists ? { id: attendeeDoc.id, ...(attendeeDoc.data() as any) } : null
      
      // Create ticket object with joined data for email
      const ticket = createdTickets[0] ? {
        ...createdTickets[0],
        event: eventDetails,
        attendee
      } : null

      // Redeem the promo code atomically (Firestore) — the SINGLE redemption point
      // for hosted-checkout orders. create-checkout-session already resolved the promo
      // and stamped its Firestore doc id into metadata.promoCodeId ONLY when a discount
      // was actually applied. The whole checkout.session.completed handler runs at most
      // once per order (idempotency claim on event.id above), so redeeming the full
      // order quantity here in one transaction never double-counts. If the "first N
      // buyers" cap filled between pricing and confirmation, we KEEP the already-issued
      // tickets (buyer paid the discounted price) and simply log the over-cap; we never
      // throw, so promo bookkeeping can never fail ticket issuance.
      if (session.metadata.promoCodeId) {
        try {
          const originalPrice = parseFloat(session.metadata.originalPrice || '0')
          const finalPrice = parseFloat(session.metadata.finalPrice || '0')
          const perTicketDiscount =
            Number.isFinite(originalPrice) && Number.isFinite(finalPrice)
              ? Math.max(0, originalPrice - finalPrice)
              : 0
          const redeem = await redeemPromoInTransaction({
            promoId: session.metadata.promoCodeId,
            qty: quantity,
            userId: session.client_reference_id,
            // Hosted checkout requires a session, so this is an account uid. Keyed
            // the same way as every other redemption point, so a per-buyer cap
            // counts this order too rather than silently exempting it.
            buyerKey: promoBuyerKey({
              isGuest: isGuestId(String(session.client_reference_id || '')),
              id: session.client_reference_id,
              email: session.customer_details?.email,
            }),
            eventId: session.metadata.eventId,
            discountApplied: perTicketDiscount * quantity,
          })
          if (redeem.capReached) {
            console.warn('[stripe] promo cap reached at confirm (checkout.session); tickets kept, not over-counted', {
              promoId: session.metadata.promoCodeId,
              eventId: session.metadata.eventId,
            })
          }
        } catch (promoErr) {
          console.error('[stripe] promo redemption failed (checkout.session)', (promoErr as any)?.message)
        }
      }

      // Count the order on its tracking link — idempotent per (link, order).
      if (createdTickets.length > 0) {
        const unitFace =
          Number.isFinite(priceInOriginalCurrency) && priceInOriginalCurrency > 0 ? priceInOriginalCurrency : pricePerTicket
        await recordAttributedSale(sessionAttribution, {
          eventId: session.metadata.eventId,
          orderKey: String(session.payment_intent || session.id),
          quantity,
          revenueCents: Math.round(unitFace * quantity * 100),
          currency: originalCurrency,
          paymentMethod,
        })
      }

      // NOTE: inventory was already reserved/incremented up front by reserveInventoryAtomic (the
      // oversell gate), so we intentionally do NOT increment again here.

      // Update event earnings (NEW: automatic earnings tracking)
      try {
        const eventGrossCents = Math.round(
          (Number.isFinite(priceInOriginalCurrency) && priceInOriginalCurrency > 0 ? priceInOriginalCurrency : pricePerTicket) *
            quantity *
            100
        )
        await addTicketToEarnings(session.metadata.eventId, eventGrossCents, quantity, {
          currency: originalCurrency,
          paymentMethod,
          chargedAmountCents: session.amount_total,
          fxRate: exchangeRateUsed,
          chargedCurrency: String(session.currency || 'usd').toUpperCase(),
          feeIncidence: session.metadata.feeIncidence,
        })
        console.log(`✅ Updated earnings for event ${session.metadata.eventId}: ${session.amount_total} cents (${quantity} tickets)`)
      } catch (earningsError) {
        console.error('❌ Failed to update earnings:', earningsError)
        // Don't fail the webhook - log for manual reconciliation
      }

      // Deliver the ticket.
      //
      // `ticket` is null when every insert above failed — reading `ticket.id` here used
      // to throw, and a throw in this handler is reported to Stripe as a FAILED webhook,
      // which it then retries against an order it can no longer fix. Delivery is
      // best-effort by design: the tickets (if any) already exist and are already paid for.
      if (ticket?.id && ticket.attendee && ticket.event) {
        await sendTicketConfirmation({
          ticketId: String(ticket.id),
          qrPayload: ticket.qr_code_data || ticket.id,
          event: ticket.event,
          recipient: {
            email: ticket.attendee.email,
            name: ticket.attendee.full_name,
            phone: ticket.attendee.phone,
            isGuest: false,
          },
          quantity,
          logPrefix: '[stripe]',
        })

        // Send in-app notification for ticket purchase
        try {
          await notifyTicketPurchase(
            session.client_reference_id,
            session.metadata.eventId,
            ticket.event.title,
            quantity
          )
          
          // Notify organizer
          await notifyOrganizerTicketSale(
            ticket.event.organizer_id,
            session.metadata.eventId,
            ticket.event.title,
            quantity,
            session.amount_total ? session.amount_total / 100 : 0,
            ticket.user?.full_name
          )
          // Watchers of this event may now need to hear it is nearly gone, and
          // the organizer may have crossed a sales milestone.
          await onSaleCompleted({
            eventId: String(session.metadata.eventId),
            buyerId: ticket.user?.id ? String(ticket.user.id) : null,
          })
        } catch (error) {
          console.error('Failed to send notification:', error)
          // Don't fail the webhook if notification fails
        }
      }
    }
    
    // Handle payment_intent.succeeded for embedded payments
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object
      
      console.log('💳 Payment Intent Succeeded:', {
        id: paymentIntent.id,
        metadata: paymentIntent.metadata,
        amount: paymentIntent.amount,
      })

      // Hosted Checkout ALSO emits payment_intent.succeeded, but those PaymentIntents carry no
      // metadata (we set metadata on the Checkout Session, not the PI). Skip when there's no
      // eventId so we don't create broken/duplicate tickets — checkout.session.completed handles
      // those purchases. Embedded payments (create-payment-intent) always include eventId.
      if (!paymentIntent.metadata?.eventId) {
        console.log('[stripe] payment_intent.succeeded without eventId metadata; skipping (handled via checkout.session.completed)', {
          paymentIntentId: paymentIntent.id,
        })
        await markWebhookEventCompleted({
          provider: 'stripe',
          eventId: event.id,
          metadata: { type: event.type, skipped: 'no_event_metadata' },
        })
        return NextResponse.json({ received: true, skipped: 'no_event_metadata' })
      }

      // Cross-path idempotency: the client "confirm payment" route (create-from-payment) may also
      // fulfill this exact PaymentIntent. Both claim the SAME payment_intent-scoped key so only one
      // path ever issues tickets / reserves inventory. If the other path already owns it, no-op.
      piFulfillId = `pi_fulfill_${paymentIntent.id}`
      const piFulfillClaim = await claimWebhookEvent({
        provider: 'stripe',
        eventId: piFulfillId,
        eventType: 'payment_intent.fulfill',
      })
      if (piFulfillClaim.outcome !== 'claimed') {
        console.log('[stripe] payment_intent already fulfilled by client-confirm path; skipping', {
          paymentIntentId: paymentIntent.id,
          outcome: piFulfillClaim.outcome,
        })
        await markWebhookEventCompleted({
          provider: 'stripe',
          eventId: event.id,
          metadata: { type: event.type, skipped: 'already_fulfilled' },
        })
        return NextResponse.json({ received: true, skipped: 'already_fulfilled' })
      }

      // Create tickets in database
      const supabase = await createClient()
      const quantity = parseInt(paymentIntent.metadata.quantity || '1', 10)
      const pricePerTicket = paymentIntent.amount / 100 / quantity
      const originalCurrency = String(paymentIntent.metadata.originalCurrency || '').toUpperCase() || 'USD'
      const normalizedOriginalCurrency = (() => {
        if (originalCurrency === 'HTG') return 'HTG'
        if (originalCurrency === 'CAD') return 'CAD'
        return 'USD'
      })()
      const priceInOriginalCurrency = Number(paymentIntent.metadata.priceInOriginalCurrency || paymentIntent.metadata.finalPrice || 0)
      const exchangeRateUsed = paymentIntent.metadata.exchangeRate ? parseFloat(paymentIntent.metadata.exchangeRate) : null
      const payoutProvider = String(paymentIntent.metadata.payoutProvider || '').toLowerCase()
      const paymentMethod = payoutProvider === 'stripe_connect' ? 'stripe_connect' : 'stripe'
      // Visit attribution (tracking link + utm + resolved promoter) stamped at
      // create-payment-intent; carried onto every ticket below.
      const piAttribution = attributionFromStripeMetadata(paymentIntent.metadata)

      // Authoritative oversell gate: atomically reserve inventory BEFORE creating tickets. If the
      // event/tier is now full, the customer has paid but we can't honor it — auto-refund and stop.
      const piTierIncrements = buildTierSoldIncrements(
        paymentIntent.metadata.tierId ? [{ tierId: paymentIntent.metadata.tierId, quantity }] : []
      )
      const piReservation = await reserveInventoryAtomic({
        eventId: paymentIntent.metadata.eventId,
        quantity,
        tierIncrements: piTierIncrements,
        logPrefix: '[stripe]',
      })
      if (!piReservation.ok) {
        console.error('[stripe] capacity exceeded after payment — auto-refunding payment intent', {
          paymentIntentId: paymentIntent.id,
          reason: piReservation.reason,
        })
        try {
          await stripe.refunds.create({ payment_intent: paymentIntent.id })
        } catch (refundErr) {
          console.error('[stripe] failed to auto-refund oversold payment intent', refundErr)
        }
        // Mark BOTH the webhook-event claim and the shared payment_intent claim completed so the
        // client-confirm path also no-ops (the payment was refunded — no tickets should be issued).
        await markWebhookEventCompleted({
          provider: 'stripe',
          eventId: piFulfillId,
          metadata: { type: event.type, refunded: 'capacity_exceeded' },
        })
        await markWebhookEventCompleted({
          provider: 'stripe',
          eventId: event.id,
          metadata: { type: event.type, refunded: 'capacity_exceeded' },
        })
        return NextResponse.json({ received: true, refunded: 'capacity_exceeded' })
      }

      // WHO this order belongs to. `metadata.userId` is a uid for an account purchase
      // and a `guest_…` id for a guest one; the guest's contact details were stamped
      // into metadata at create-payment-intent time, BEFORE payment, so the recipient is
      // read from the order rather than from anything this request could carry.
      const piGuestRecipient = guestRecipientFromOrder({
        is_guest: paymentIntent.metadata.isGuest === 'true',
        user_id: paymentIntent.metadata.userId,
        guest_name: paymentIntent.metadata.guestName,
        guest_email: paymentIntent.metadata.guestEmail,
        guest_phone: paymentIntent.metadata.guestPhone,
        guest_order_key: paymentIntent.metadata.guestOrderKey,
      })

      // Create tickets
      const createdTickets = []
      for (let i = 0; i < quantity; i++) {
        const qrCodeData = `ticket-${paymentIntent.metadata.eventId}-${paymentIntent.metadata.userId}-${Date.now()}-${i}`
        const ticketData = {
          event_id: paymentIntent.metadata.eventId,
          attendee_id: paymentIntent.metadata.userId,
          ...(piGuestRecipient
            ? {
                attendee_name: piGuestRecipient.name,
                is_guest: true,
                guest_email: piGuestRecipient.email,
                guest_phone: piGuestRecipient.phone || null,
              }
            : {}),
          price_paid: Number.isFinite(priceInOriginalCurrency) && priceInOriginalCurrency > 0 ? priceInOriginalCurrency : pricePerTicket,
          currency: normalizedOriginalCurrency,
          original_currency: normalizedOriginalCurrency,
          exchange_rate_used: exchangeRateUsed,
          payment_method: paymentMethod,
          payment_id: paymentIntent.id,
          promoter_id: paymentIntent.metadata.promoterId || null,
          promoter_code: paymentIntent.metadata.promoterCode || null,
          ...ticketAttributionFields(piAttribution),
          status: 'valid',
          qr_code_data: qrCodeData,
          purchased_at: new Date().toISOString(),
          tier_id: paymentIntent.metadata.tierId || '',
          tier_name: paymentIntent.metadata.tierName || 'General Admission',
        }
        
        const insertResult = await supabase
          .from('tickets')
          .insert([ticketData])
          .select()
        
        if (insertResult.error) {
          console.error('Failed to create ticket:', insertResult.error)
          continue
        }
        
        const createdTicket = insertResult.data?.[0]
        if (createdTicket) {
          createdTickets.push(createdTicket)
          console.log('✅ Created ticket from PaymentIntent:', {
            ticketId: createdTicket.id,
            attendeeId: createdTicket.attendee_id,
            eventId: createdTicket.event_id,
            qrCode: createdTicket.qr_code_data
          })

          // Mirror into Firestore for organizer earnings/admin analytics.
          try {
            await adminDb.collection('tickets').doc(String(createdTicket.id)).set(
              {
                event_id: paymentIntent.metadata.eventId,
                attendee_id: paymentIntent.metadata.userId,
                status: 'confirmed',
                ticket_type: paymentIntent.metadata.tierName || 'General Admission',
                tier_id: paymentIntent.metadata.tierId || '',
                ...(piGuestRecipient
                  ? {
                      is_guest: true,
                      attendee_name: piGuestRecipient.name,
                      guest_email: piGuestRecipient.email,
                      guest_phone: piGuestRecipient.phone || null,
                    }
                  : {}),
                price_paid: ticketData.price_paid,
                currency: ticketData.currency,
                exchange_rate_used: ticketData.exchange_rate_used ?? null,
                charged_amount: pricePerTicket,
                charged_currency: String(paymentIntent.currency || 'usd').toUpperCase(),
                payment_method: paymentMethod,
                payment_id: paymentIntent.id,
                promoter_id: paymentIntent.metadata.promoterId || null,
                promoter_code: paymentIntent.metadata.promoterCode || null,
                ...ticketAttributionFields(piAttribution),
                purchased_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              { merge: true }
            )
          } catch (e) {
            console.warn('[stripe] failed to mirror ticket to Firestore', {
              ticketId: createdTicket.id,
              message: (e as any)?.message,
            })
          }
        }
      }
      
      console.log(`📊 Total tickets created: ${createdTickets.length} for user ${paymentIntent.metadata.userId}`)

      // Redeem the promo code atomically (Firestore) — the SINGLE redemption point for
      // embedded (create-payment-intent) orders. create-payment-intent resolved the promo
      // and stamped its Firestore doc id into metadata.promoCodeId ONLY when a discount was
      // actually applied. The shared payment_intent-scoped claim above guarantees exactly one
      // path (this webhook OR the client-confirm route) fulfills this PaymentIntent, so
      // redeeming the full order quantity here once never double-counts. Cap-reached at
      // confirm keeps the issued tickets and only logs; never throws.
      if (createdTickets.length > 0 && paymentIntent.metadata.promoCodeId) {
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
            eventId: paymentIntent.metadata.eventId,
            discountApplied: perTicketDiscount * quantity,
          })
          if (redeem.capReached) {
            console.warn('[stripe] promo cap reached at confirm (payment_intent); tickets kept, not over-counted', {
              promoId: paymentIntent.metadata.promoCodeId,
              eventId: paymentIntent.metadata.eventId,
            })
          }
        } catch (promoErr) {
          console.error('[stripe] promo redemption failed (payment_intent)', (promoErr as any)?.message)
        }
      }

      // Attribute the sale to its promoter — under the same exactly-once claim as
      // the promo redemption; a bookkeeping failure never breaks the sale. The
      // recorded commission is withheld from the organizer's earnings below.
      let promoterCommissionCents = 0
      if (createdTickets.length > 0 && paymentIntent.metadata.promoterId) {
        const unitFace =
          Number.isFinite(priceInOriginalCurrency) && priceInOriginalCurrency > 0
            ? priceInOriginalCurrency
            : pricePerTicket
        const promoterSale = await recordPromoterSale({
          promoterId: paymentIntent.metadata.promoterId,
          eventId: paymentIntent.metadata.eventId,
          ticketIds: createdTickets.map((t: any) => String(t.id)),
          quantity,
          orderGrossCents: Math.round(unitFace * quantity * 100),
          currency: originalCurrency,
          paymentMethod,
          paymentId: paymentIntent.id,
          buyerUserId: paymentIntent.metadata.isGuest === 'true' ? null : paymentIntent.metadata.userId,
          buyerEmail: paymentIntent.metadata.guestEmail || null,
        })
        // Withhold only what was actually ledgered: if the row failed to record,
        // the organizer keeps the money and the ledger stays reconcilable.
        if (promoterSale.recorded) promoterCommissionCents = promoterSale.commissionCents
      }

      // Count the order on its tracking link — idempotent per (link, PaymentIntent),
      // so a redelivery or the client-confirm path can never double count.
      if (createdTickets.length > 0) {
        const unitFace =
          Number.isFinite(priceInOriginalCurrency) && priceInOriginalCurrency > 0
            ? priceInOriginalCurrency
            : pricePerTicket
        await recordAttributedSale(piAttribution, {
          eventId: paymentIntent.metadata.eventId,
          orderKey: paymentIntent.id,
          quantity,
          revenueCents: Math.round(unitFace * quantity * 100),
          currency: originalCurrency,
          paymentMethod,
        })
      }

      // Update event earnings for embedded payments as well.
      try {
        const eventGrossCents = Math.round(
          (Number.isFinite(priceInOriginalCurrency) && priceInOriginalCurrency > 0 ? priceInOriginalCurrency : pricePerTicket) *
            quantity *
            100
        )
        await addTicketToEarnings(paymentIntent.metadata.eventId, eventGrossCents, quantity, {
          currency: originalCurrency,
          paymentMethod,
          chargedAmountCents: paymentIntent.amount,
          fxRate: exchangeRateUsed,
          chargedCurrency: String(paymentIntent.currency || 'usd').toUpperCase(),
          feeIncidence: paymentIntent.metadata.feeIncidence,
          promoterCommissionCents,
        })
        console.log(`✅ Updated earnings for event ${paymentIntent.metadata.eventId}: ${paymentIntent.amount} cents (${quantity} tickets)`)
      } catch (earningsError) {
        console.error('❌ Failed to update earnings:', earningsError)
        // Don't fail the webhook - log for manual reconciliation
      }

      // NOTE: inventory was already reserved/incremented up front by reserveInventoryAtomic (the
      // oversell gate), so we intentionally do NOT increment again here.
      
      // Send notifications (similar to checkout.session.completed)
      if (createdTickets.length > 0) {
        const eventDoc = await adminDb.collection('events').doc(String(paymentIntent.metadata.eventId)).get()
        const eventDetails = eventDoc.exists ? { id: eventDoc.id, ...(eventDoc.data() as any) } : null

        // A guest has no user document — their details come off the order instead.
        const attendee = piGuestRecipient
          ? {
              email: piGuestRecipient.email,
              full_name: piGuestRecipient.name,
              phone: piGuestRecipient.phone,
            }
          : await (async () => {
              const attendeeDoc = await adminDb
                .collection('users')
                .doc(String(paymentIntent.metadata.userId))
                .get()
              return attendeeDoc.exists ? { id: attendeeDoc.id, ...(attendeeDoc.data() as any) } : null
            })()

        console.log('👤 Attendee found:', attendee?.email || 'No attendee')
        console.log('🎫 Event found:', eventDetails?.title || 'No event')

        // Deliver the ticket + QR. Embedded card purchases previously fell through
        // here with no confirmation at all.
        try {
          if (piGuestRecipient && paymentIntent.metadata.guestOrderKey) {
            await attachTicketsToGuestOrder(
              String(paymentIntent.metadata.guestOrderKey),
              createdTickets.map((t: any) => String(t.id))
            )
          }

          await sendTicketConfirmation({
            ticketId: String(createdTickets[0].id),
            qrPayload: createdTickets[0].qr_code_data || createdTickets[0].id,
            event: eventDetails,
            recipient: {
              email: attendee?.email,
              name: attendee?.full_name,
              phone: attendee?.phone,
              isGuest: Boolean(piGuestRecipient),
            },
            quantity,
            guestToken: piGuestRecipient?.guestToken || null,
            logPrefix: '[stripe]',
          })
        } catch (error) {
          console.error('[stripe] failed to deliver ticket confirmation', error)
        }

        try {
          // In-app notifications need an account to land in; a guest has none.
          if (!isGuestId(paymentIntent.metadata.userId)) {
            await notifyTicketPurchase(
              paymentIntent.metadata.userId,
              paymentIntent.metadata.eventId,
              eventDetails?.title || 'Event',
              quantity
            )
          }

          // Notify organizer
          if (eventDetails) {
            await notifyOrganizerTicketSale(
              eventDetails.organizer_id,
              paymentIntent.metadata.eventId,
              eventDetails.title,
              quantity,
              paymentIntent.amount / 100,
              attendee?.full_name
            )
            await onSaleCompleted({
              eventId: String(paymentIntent.metadata.eventId),
              buyerId: attendee?.id ? String(attendee.id) : null,
            })
          }
        } catch (error) {
          console.error('Failed to send notification:', error)
        }
      }

      // Mark the shared payment_intent claim completed so the client-confirm path no-ops.
      await markWebhookEventCompleted({
        provider: 'stripe',
        eventId: piFulfillId,
        metadata: { type: event.type, tickets: createdTickets.length },
      })
    }

    // Handle chargebacks. See DISPUTE_EVENT_TYPES above for why each type is here.
    //
    // Signature verification and the event-id idempotency claim above apply
    // unchanged: a dispute event is claimed on event.id like any other handled
    // type, marked completed here so a redelivery no-ops, and released for retry
    // by the outer catch if anything throws.
    if (DISPUTE_EVENT_TYPES.has(event.type)) {
      const dispute = event.data.object

      /**
       * The dispute object carries `payment_intent` on current API versions, but
       * not on older ones — and the PaymentIntent id is the ONLY reference our
       * tickets store, so without it nothing can be attributed. Fall back to
       * reading it off the charge.
       */
      let paymentIntentId: string | null =
        typeof dispute?.payment_intent === 'string'
          ? dispute.payment_intent
          : dispute?.payment_intent?.id || null
      const chargeId = typeof dispute?.charge === 'string' ? dispute.charge : dispute?.charge?.id || null

      if (!paymentIntentId && chargeId) {
        try {
          const charge = await stripe.charges.retrieve(chargeId)
          paymentIntentId =
            typeof charge?.payment_intent === 'string'
              ? charge.payment_intent
              : charge?.payment_intent?.id || null
        } catch (chargeErr: any) {
          // Not fatal: the dispute is still recorded, just harder to attribute.
          console.warn('[stripe] could not resolve payment_intent from disputed charge', {
            chargeId,
            message: chargeErr?.message,
          })
        }
      }

      // Never throws — a chargeback must not enter a webhook retry loop.
      const disputeResult = await handleStripeDisputeEvent({
        dispute,
        eventType: event.type,
        stripeEventId: event.id,
        stripeEventCreated: Number(event.created) || Math.floor(Date.now() / 1000),
        paymentIntentId,
      })

      await markWebhookEventCompleted({
        provider: 'stripe',
        eventId: event.id,
        metadata: {
          type: event.type,
          disputeId: disputeResult.disputeId,
          status: disputeResult.status,
          attributed: disputeResult.attributed,
        },
      })

      return NextResponse.json({ received: true, dispute: disputeResult })
    }

    // Mark the event fully processed so any future redelivery is a no-op.
    if (stripeEvent && HANDLED_EVENT_TYPES.has(stripeEvent.type)) {
      await markWebhookEventCompleted({
        provider: 'stripe',
        eventId: stripeEvent.id,
        metadata: { type: stripeEvent.type },
      })
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('Webhook error:', error)

    // Release the idempotency claim so Stripe's automatic retry can reprocess this event
    // instead of being permanently blocked as "in progress".
    if (stripeEvent && HANDLED_EVENT_TYPES.has(stripeEvent.type)) {
      await releaseWebhookEvent({ provider: 'stripe', eventId: stripeEvent.id })
    }
    // Also release the shared payment_intent claim so the client-confirm path (or a retry) can
    // re-fulfill instead of being stuck as "in progress".
    if (piFulfillId) {
      await releaseWebhookEvent({ provider: 'stripe', eventId: piFulfillId })
    }

    return NextResponse.json(
      { error: error.message || 'Webhook handler failed' },
      { status: 400 }
    )
  }
}
