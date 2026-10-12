import { NextResponse } from 'next/server'
import { guestRecipientFromOrder } from '@/lib/guest/checkout'
import {
  claimWebhookEvent,
  markWebhookEventCompleted,
  releaseWebhookEvent,
} from '@/lib/webhooks/idempotency'
import { handleStripeDisputeEvent } from '@/lib/disputes'
import { releaseSeatHold } from '@/lib/tickets/seatHolds'
import {
  applyStripeChargeRefund,
  fulfillStripeOrder,
  stripeOrderHasTickets,
  type StripeFulfillmentResult,
} from '@/lib/tickets/stripe-fulfillment'
import { recordStripeAccountStatus } from '@/lib/stripe-connect-account'
import { handleStripePayoutUpdate } from '@/lib/stripe-payout-releases'

/**
 * Connect events — about a CONNECTED account, so `event.account` is set.
 *
 * They only arrive on a Connect webhook endpoint ("Events on Connected
 * accounts"), which Stripe signs with its OWN secret. Both endpoints may point
 * at this URL: the signature is checked against STRIPE_WEBHOOK_SECRET and
 * STRIPE_CONNECT_WEBHOOK_SECRET (either may hold a comma-separated list for
 * secret rotation).
 *
 *  - payout.*        → the release cron's payouts, by payout id
 *                      (lib/stripe-payout-releases). failed / canceled stop
 *                      counting as released and become re-releasable.
 *  - account.updated → requirements / charges / payouts / disabled_reason on
 *                      the organizer's stripe_connect profile, so the UI can
 *                      say "Stripe needs more info".
 */
const CONNECT_PAYOUT_EVENT_TYPES = new Set([
  'payout.paid',
  'payout.failed',
  'payout.canceled',
  'payout.updated',
])
const CONNECT_EVENT_TYPES = new Set([...CONNECT_PAYOUT_EVENT_TYPES, 'account.updated'])

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
  // An abandoned / canceled PaymentIntent gives its seat hold back early. The
  // endpoint must be subscribed to this event in the Stripe dashboard for it to
  // arrive; without it the hold simply expires on its own.
  'payment_intent.canceled',
  // Refunds made outside Tikèm's refund flow. The endpoint must be subscribed to
  // this event in the Stripe dashboard for it to arrive.
  'charge.refunded',
  ...DISPUTE_EVENT_TYPES,
  ...CONNECT_EVENT_TYPES,
])

function webhookSecrets(): string[] {
  return [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET]
    .flatMap((v) => String(v || '').split(','))
    .map((v) => v.trim())
    .filter(Boolean)
}

/** Verify against every configured secret; throws the last error if none match. */
function constructVerifiedEvent(stripe: any, body: string, signature: string, secrets: string[]) {
  let lastError: any = null
  for (const secret of secrets) {
    try {
      return stripe.webhooks.constructEvent(body, signature, secret)
    } catch (error: any) {
      lastError = error
    }
  }
  throw lastError || new Error('No webhook secret configured')
}

/**
 * Should this event be handled here? Connect types only when they ARE about a
 * connected account (a platform payout.paid is Tikèm's own bank payout and
 * means nothing to payout_releases); platform types only when they are NOT (a
 * connected account's own checkout/charge events are not Tikèm orders).
 */
function isHandledEvent(event: any): boolean {
  if (!event || !HANDLED_EVENT_TYPES.has(event.type)) return false
  const connected = typeof event.account === 'string' && event.account.length > 0
  return CONNECT_EVENT_TYPES.has(event.type) ? connected : !connected
}

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

    const secrets = webhookSecrets()
    if (!signature || secrets.length === 0) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
    }

    // Verify webhook signature (platform endpoint secret, then Connect endpoint secret)
    let event: any
    try {
      event = constructVerifiedEvent(stripe, body, signature, secrets)
    } catch (verifyError: any) {
      console.error('[stripe] webhook signature verification failed', { message: verifyError?.message })
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    if (!isHandledEvent(event)) {
      // Acknowledge anything we do not act on, so Stripe stops retrying it.
      return NextResponse.json({ received: true, ignored: true })
    }
    stripeEvent = event

    // Idempotency: Stripe delivers events at least once. Dedupe on the stable event id so a
    // redelivery (or a concurrent delivery) never creates a second set of tickets, double-counts
    // earnings, or double-increments inventory.
    {
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

    // Connect: a release payout moved (paid / failed / canceled / in transit).
    if (CONNECT_PAYOUT_EVENT_TYPES.has(event.type)) {
      const payout = event.data.object
      const result = await handleStripePayoutUpdate({
        payout,
        stripeAccountId: String(event.account),
        source: 'webhook',
        stripeEventId: event.id,
      })
      if (!result.matched) {
        // An organizer-initiated payout from their Express dashboard, or one
        // from before payout_releases existed. Nothing of ours to move.
        console.log('[stripe] payout event with no matching release', {
          eventId: event.id,
          type: event.type,
          account: event.account,
          payoutId: payout?.id,
        })
      }
      await markWebhookEventCompleted({
        provider: 'stripe',
        eventId: event.id,
        metadata: {
          type: event.type,
          account: event.account,
          payoutId: payout?.id || null,
          releaseDocId: result.releaseDocId,
          status: result.status,
          newlyFailed: result.newlyFailed,
        },
      })
      return NextResponse.json({ received: true, payout: { matched: result.matched, status: result.status } })
    }

    // Connect: the organizer's account requirements / capabilities changed.
    if (event.type === 'account.updated') {
      const account = event.data.object
      const recorded = await recordStripeAccountStatus(
        { ...account, id: account?.id || event.account },
        { eventCreated: Number(event.created) || null }
      )
      await markWebhookEventCompleted({
        provider: 'stripe',
        eventId: event.id,
        metadata: {
          type: event.type,
          account: event.account,
          recorded: recorded.recorded,
          reason: recorded.recorded ? null : recorded.reason,
        },
      })
      return NextResponse.json({ received: true, account: { recorded: recorded.recorded } })
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

    // A PaymentIntent that will never be paid: put its held seats back on sale.
    // releaseSeatHold only ever releases a HOLD, never seats already sold.
    if (event.type === 'payment_intent.canceled') {
      const paymentIntent = event.data.object
      const released = await releaseSeatHold(paymentIntent?.metadata?.seatHoldId, { logPrefix: '[stripe]' })
      await markWebhookEventCompleted({
        provider: 'stripe',
        eventId: event.id,
        metadata: { type: event.type, paymentIntentId: paymentIntent?.id || null, released },
      })
      return NextResponse.json({ received: true, seatHoldReleased: released })
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
