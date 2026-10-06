import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { guestRecipientFromOrder } from '@/lib/guest/checkout'
import { guestTicketUrl } from '@/lib/guest/identity'
import { callerOwnsPaymentIntent } from '@/lib/tickets/paymentIntentOwner'
import {
  claimWebhookEvent,
  markWebhookEventCompleted,
  releaseWebhookEvent,
} from '@/lib/webhooks/idempotency'
import {
  findTicketIdsForPayment,
  fulfillStripeOrder,
  getStripeOrderState,
  stripeOrderHasTickets,
} from '@/lib/tickets/stripe-fulfillment'

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

    const { paymentIntentId, clientSecret, guestToken } = await request.json()

    // One canonical string id for Stripe, the claim and the ledger alike.
    if (typeof paymentIntentId !== 'string' || !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) {
      return NextResponse.json({ error: 'Payment Intent ID is required' }, { status: 400 })
    }

    const stripe = getStripe()

    // Verify payment intent exists and succeeded
    let paymentIntent: Awaited<ReturnType<typeof stripe.paymentIntents.retrieve>>
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
    } catch (e: any) {
      // An unknown or malformed id is the caller's mistake, not a server error.
      if (e?.type === 'StripeInvalidRequestError') {
        return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
      }
      throw e
    }

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

    // Only the order's own buyer may confirm it and see its ticket ids.
    //  - ACCOUNT order: the session uid must be the uid stamped on the PaymentIntent.
    //  - GUEST order: no session exists, so the caller proves possession of the order with
    //    the PaymentIntent's client_secret (only the paying browser holds it) or the
    //    guest's signed retrieval token for this exact order. A bare PaymentIntent id is
    //    NOT proof: ids leak through receipts, logs and support threads.
    // A non-owner gets nothing: the Stripe webhook fulfills the order regardless.
    const isOwner = callerOwnsPaymentIntent({
      paymentIntent,
      user,
      isGuest: Boolean(piGuestRecipient),
      clientSecret,
      guestToken,
    })
    if (!isOwner) {
      if (!user && !piGuestRecipient) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Already fulfilled (by the webhook, an earlier confirm, or the pre-ledger
    // pipeline)? Hand back the tickets.
    const ledger = await getStripeOrderState(paymentIntentId)
    if (ledger?.status === 'fulfilled' || (!ledger && (await findTicketIdsForPayment(paymentIntentId)).length > 0)) {
      const ids = ledger?.ticket_ids?.length ? ledger.ticket_ids : await findTicketIdsForPayment(paymentIntentId)
      return NextResponse.json({ success: true, ticketIds: ids, message: 'Tickets already created' })
    }

    // Shared exclusion claim keyed on the PaymentIntent. The webhook's payment_intent.succeeded
    // handler claims the SAME key, so normally only one path works an order at a time. (The
    // order ledger in lib/tickets/stripe-fulfillment makes a second run resume, never re-issue.)
    fulfillId = `pi_fulfill_${paymentIntentId}`
    const claim = await claimWebhookEvent({
      provider: 'stripe',
      eventId: fulfillId,
      eventType: 'payment_intent.client_confirm',
    })
    if (claim.outcome !== 'claimed') {
      fulfillId = null
      const ids = await findTicketIdsForPayment(paymentIntentId)
      return NextResponse.json({
        success: true,
        ticketIds: ids,
        message: ids.length === 0 ? 'Ticket creation already in progress' : 'Tickets already created',
      })
    }

    // The same pipeline the webhook runs: oversell gate (+ refund), tickets, promo,
    // promoter commission hold, earnings, attribution and notifications — once.
    const result = await fulfillStripeOrder({
      source: 'client_confirm',
      paymentId: paymentIntentId,
      paymentIntentId,
      metadata: paymentIntent.metadata || {},
      buyerId: String(paymentIntent.metadata.userId || ''),
      guestRecipient: piGuestRecipient,
      amountTotalCents: Number(paymentIntent.amount) || 0,
      chargedCurrency: String(paymentIntent.currency || 'usd'),
      destinationCharge: Boolean(paymentIntent.transfer_data?.destination),
      logPrefix: '[create-from-payment]',
    })

    const claimId = fulfillId
    fulfillId = null // settled below; the catch must not touch it again

    if (result.outcome === 'capacity_refunded') {
      await markWebhookEventCompleted({
        provider: 'stripe',
        eventId: claimId,
        metadata: { type: 'payment_intent.client_confirm', refunded: 'capacity_exceeded' },
      })
      return NextResponse.json(
        { error: 'Event capacity exceeded; your payment has been refunded.' },
        { status: 409 }
      )
    }
    if (result.outcome === 'refund_failed') {
      // No ticket exists: release so the webhook retries the refund.
      await releaseWebhookEvent({ provider: 'stripe', eventId: claimId })
      return NextResponse.json(
        { error: 'Event capacity exceeded; your refund is being processed.' },
        { status: 409 }
      )
    }
    if (result.outcome === 'in_progress') {
      // Leave the claim: another runner is mid-way and the ledger lets the next
      // attempt resume once it goes stale.
      const ids = await findTicketIdsForPayment(paymentIntentId)
      return NextResponse.json({
        success: true,
        ticketIds: ids,
        message: ids.length === 0 ? 'Ticket creation already in progress' : 'Tickets already created',
      })
    }

    if (result.outcome === 'fulfilled') {
      await markWebhookEventCompleted({
        provider: 'stripe',
        eventId: claimId,
        metadata: { type: 'payment_intent.client_confirm', tickets: result.ticketIds.length },
      })
    }
    // 'partial': the buyer's tickets exist; the claim is left to go stale so the
    // webhook's retry resumes the unfinished bookkeeping from the ledger.

    return NextResponse.json({
      success: true,
      ticketIds: result.ticketIds,
      // A guest has no /tickets page — hand back their own signed link.
      ...(piGuestRecipient?.guestToken
        ? { guestTicketUrl: guestTicketUrl(piGuestRecipient.guestToken) }
        : {}),
      message: `${result.ticketIds.length} ticket(s) created successfully`,
    })
  } catch (error: any) {
    console.error('Ticket creation error:', error)
    // Release the shared claim so the webhook (or a client retry) can fulfil — but only while
    // no ticket exists for the payment. Once one does, the claim goes stale on its own and the
    // next attempt resumes from the order ledger instead of re-issuing.
    if (fulfillId) {
      const paymentIntentId = fulfillId.replace(/^pi_fulfill_/, '')
      if (!(await stripeOrderHasTickets(paymentIntentId))) {
        await releaseWebhookEvent({ provider: 'stripe', eventId: fulfillId })
      }
    }
    return NextResponse.json(
      { error: error.message || 'Failed to create tickets' },
      { status: 500 }
    )
  }
}
