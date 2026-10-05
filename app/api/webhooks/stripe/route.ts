import { NextResponse } from 'next/server'
import { guestRecipientFromOrder } from '@/lib/guest/checkout'
import {
  claimWebhookEvent,
  markWebhookEventCompleted,
  releaseWebhookEvent,
} from '@/lib/webhooks/idempotency'
import { handleStripeDisputeEvent } from '@/lib/disputes'
import {
  applyStripeChargeRefund,
  fulfillStripeOrder,
  stripeOrderHasTickets,
  type StripeFulfillmentResult,
} from '@/lib/tickets/stripe-fulfillment'

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
  // Refunds made outside Tikèm's refund flow. The endpoint must be subscribed to
  // this event in the Stripe dashboard for it to arrive.
  'charge.refunded',
  ...DISPUTE_EVENT_TYPES,
])

// Lazy load Stripe to avoid build-time initialization
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

/**
 * Turn a fulfilment outcome into the webhook response and settle the claims.
 *
 *  - done (fulfilled / refunded for sell-out): both claims completed, 200
 *  - tickets exist but bookkeeping is unfinished: the event claim is released so
 *    Stripe's retry comes back and RESUMES from the order ledger; the shared
 *    payment_intent claim is NOT released (it goes stale on its own) because
 *    tickets exist — a release would only invite a concurrent run
 *  - sold out and the refund failed: no ticket exists, so both claims are
 *    released and Stripe retries the refund (idempotency key: never twice)
 */
async function finishFulfilment(event: any, result: StripeFulfillmentResult, piClaimId: string | null) {
  const complete = async (metadata: Record<string, any>) => {
    if (piClaimId) {
      await markWebhookEventCompleted({ provider: 'stripe', eventId: piClaimId, metadata: { type: event.type, ...metadata } })
    }
    await markWebhookEventCompleted({ provider: 'stripe', eventId: event.id, metadata: { type: event.type, ...metadata } })
  }

  switch (result.outcome) {
    case 'fulfilled':
      await complete({ tickets: result.ticketIds.length, alreadyFulfilled: result.alreadyFulfilled })
      return NextResponse.json({ received: true, tickets: result.ticketIds.length })
    case 'capacity_refunded':
      await complete({ refunded: 'capacity_exceeded', refundId: result.refundId })
      return NextResponse.json({ received: true, refunded: 'capacity_exceeded' })
    case 'refund_failed':
      if (piClaimId) await releaseWebhookEvent({ provider: 'stripe', eventId: piClaimId })
      await releaseWebhookEvent({ provider: 'stripe', eventId: event.id })
      return NextResponse.json({ error: 'auto_refund_failed', needsRefund: true }, { status: 500 })
    case 'partial':
      await releaseWebhookEvent({ provider: 'stripe', eventId: event.id })
      return NextResponse.json({ error: 'fulfilment_incomplete', failedSteps: result.failedSteps }, { status: 500 })
    case 'in_progress':
    default:
      await releaseWebhookEvent({ provider: 'stripe', eventId: event.id })
      return NextResponse.json({ received: true, retry: 'fulfilment_in_progress' }, { status: 503 })
  }
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
      const sessionPi: string | null =
        typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null
      const buyerId = String(session.client_reference_id || '')

      // One pipeline for every Stripe order (lib/tickets/stripe-fulfillment):
      // oversell gate + refund, all-or-nothing ticket issuance, and promo /
      // promoter / earnings bookkeeping exactly once, resumable on retry.
      const result = await fulfillStripeOrder({
        source: 'checkout_session',
        paymentId: sessionPi || String(session.id),
        paymentIntentId: sessionPi,
        metadata: session.metadata || {},
        buyerId,
        // Hosted checkout requires a session, so this is an account order.
        guestRecipient: null,
        customerEmail: session.customer_details?.email || null,
        amountTotalCents: Number(session.amount_total) || 0,
        chargedCurrency: String(session.currency || 'usd'),
        destinationCharge: null,
        logPrefix: '[stripe]',
      })
      return finishFulfilment(event, result, null)
    }

    // Handle payment_intent.succeeded for embedded payments
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object

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

      // Cross-path exclusion: the client "confirm payment" route (create-from-payment) may also
      // fulfill this exact PaymentIntent. Both claim the SAME payment_intent-scoped key.
      piFulfillId = `pi_fulfill_${paymentIntent.id}`
      const piFulfillClaim = await claimWebhookEvent({
        provider: 'stripe',
        eventId: piFulfillId,
        eventType: 'payment_intent.fulfill',
      })
      if (piFulfillClaim.outcome === 'already_processed') {
        piFulfillId = null
        await markWebhookEventCompleted({
          provider: 'stripe',
          eventId: event.id,
          metadata: { type: event.type, skipped: 'already_fulfilled' },
        })
        return NextResponse.json({ received: true, skipped: 'already_fulfilled' })
      }
      if (piFulfillClaim.outcome === 'in_progress') {
        // The other path is mid-way. Answering 200 here used to drop the order
        // for good if that path then died; ask Stripe to come back instead.
        piFulfillId = null
        await releaseWebhookEvent({ provider: 'stripe', eventId: event.id })
        return NextResponse.json({ received: true, retry: 'fulfilment_in_progress' }, { status: 503 })
      }

      const piGuestRecipient = guestRecipientFromOrder({
        is_guest: paymentIntent.metadata.isGuest === 'true',
        user_id: paymentIntent.metadata.userId,
        guest_name: paymentIntent.metadata.guestName,
        guest_email: paymentIntent.metadata.guestEmail,
        guest_phone: paymentIntent.metadata.guestPhone,
        guest_order_key: paymentIntent.metadata.guestOrderKey,
      })

      const result = await fulfillStripeOrder({
        source: 'payment_intent',
        paymentId: String(paymentIntent.id),
        paymentIntentId: String(paymentIntent.id),
        metadata: paymentIntent.metadata || {},
        buyerId: String(paymentIntent.metadata.userId || ''),
        guestRecipient: piGuestRecipient,
        amountTotalCents: Number(paymentIntent.amount) || 0,
        chargedCurrency: String(paymentIntent.currency || 'usd'),
        destinationCharge: Boolean(paymentIntent.transfer_data?.destination),
        logPrefix: '[stripe]',
      })
      const claimId = piFulfillId
      piFulfillId = null // finishFulfilment owns the claim from here
      return finishFulfilment(event, result, claimId)
    }

    // A refund made outside Tikèm's own refund flow (dashboard, support, Radar):
    // void the refunded tickets so they stop scanning and stop counting as
    // payable. Tikèm's own refunds already marked their tickets and are skipped.
    if (event.type === 'charge.refunded') {
      const refundResult = await applyStripeChargeRefund(event.data.object, { logPrefix: '[stripe]' })
      await markWebhookEventCompleted({
        provider: 'stripe',
        eventId: event.id,
        metadata: {
          type: event.type,
          paymentIntentId: refundResult.paymentIntentId,
          marked: refundResult.markedRefunded.length,
          unallocatedCents: refundResult.unallocatedCents,
        },
      })
      return NextResponse.json({ received: true, refund: { marked: refundResult.markedRefunded.length } })
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
    // Release the shared payment_intent claim only while NO ticket exists for the payment.
    // Once any does, the claim is left to go stale and the next attempt resumes from the
    // order ledger — never re-issues.
    if (piFulfillId) {
      const paymentIntentId = piFulfillId.replace(/^pi_fulfill_/, '')
      if (!(await stripeOrderHasTickets(paymentIntentId))) {
        await releaseWebhookEvent({ provider: 'stripe', eventId: piFulfillId })
      }
    }

    return NextResponse.json(
      { error: error.message || 'Webhook handler failed' },
      { status: 400 }
    )
  }
}
