import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/firebase-db/server'
import { checkPaymentStatus } from '@/lib/moncash'
import { isMonCashButtonPaidAmountAcceptable } from '@/lib/moncash-button'
import { fulfillPaidOrder } from '@/lib/tickets/fulfillment'
import { guestRecipientFromOrder } from '@/lib/guest/checkout'
import { guestTicketUrl } from '@/lib/guest/identity'

export const dynamic = 'force-dynamic'

/**
 * Legacy MerchantApi return URL.
 *
 * This route used to issue tickets ITSELF: no feature flag, no idempotency claim (a
 * reload issued a second set), no amount check, no inventory reservation. Nothing in
 * the app links here any more — the MerchantApi initiate/check-status routes are off
 * unless MONCASH_MERCHANT_API_ENABLED=true — so it no longer issues anything on its
 * own:
 *
 *  - It can still be hit by a Digicel portal that was (mis)configured with this URL
 *    as the Button return. Those requests are forwarded to
 *    /api/moncash-button/return, which verifies with the gateway and fulfils through
 *    the shared, idempotent pipeline.
 *  - With MONCASH_MERCHANT_API_ENABLED=true a genuine MerchantApi order is verified,
 *    amount-checked and fulfilled through that SAME pipeline (lib/tickets/fulfillment.ts).
 *  - Otherwise: 410 Gone.
 */
function merchantApiEnabled(): boolean {
  return (process.env.MONCASH_MERCHANT_API_ENABLED || '').toLowerCase() === 'true'
}

function redirectToButtonReturn(request: Request, transactionId: string, orderId: string | null) {
  const url = new URL('/api/moncash-button/return', request.url)
  url.searchParams.set('transactionId', transactionId)
  if (orderId) url.searchParams.set('orderId', orderId)
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const transactionId = searchParams.get('transactionId')

    if (!transactionId) {
      return NextResponse.redirect(new URL('/purchase/failed?reason=missing_transaction', request.url))
    }

    const supabase = await createClient()
    const { data: pendingTx } = await supabase
      .from('pending_transactions')
      .select('*')
      .eq('transaction_id', transactionId)
      .single()

    const isMerchantApiOrder =
      Boolean(pendingTx) &&
      String(pendingTx?.payment_method || '').toLowerCase() === 'moncash' &&
      !pendingTx?.mobile_money_provider

    // Anything that is not a live MerchantApi order goes to the Button return
    // handler, which verifies with the gateway itself and never trusts this request.
    if (!isMerchantApiOrder || !merchantApiEnabled()) {
      const orderIdFromCookie = (await cookies()).get('moncash_button_order_id')?.value || null
      const orderId = pendingTx?.order_id ? String(pendingTx.order_id) : orderIdFromCookie
      if (orderId) {
        return redirectToButtonReturn(request, transactionId, orderId)
      }
      if (!merchantApiEnabled()) {
        return NextResponse.json(
          {
            error: 'The MonCash MerchantApi callback is retired.',
            recommendedEndpoint: '/api/moncash-button/return',
          },
          { status: 410 }
        )
      }
      return NextResponse.redirect(new URL('/purchase/failed?reason=transaction_not_found', request.url))
    }

    if (pendingTx.status === 'completed' && pendingTx.ticket_id) {
      return NextResponse.redirect(new URL(`/purchase/success?ticketId=${pendingTx.ticket_id}`, request.url))
    }

    // Verify with MonCash MerchantApi — the request itself is never trusted.
    const paymentStatus = await checkPaymentStatus({ transactionId })

    if (paymentStatus.message !== 'successful') {
      // Only a still-pending order is marked failed (never a completed/processing one).
      await supabase
        .from('pending_transactions')
        .update({
          status: 'failed',
          failure_reason: paymentStatus.message || 'payment_failed',
          failure_source: 'gateway_not_paid',
        })
        .eq('transaction_id', transactionId)
        .eq('status', 'pending')

      return NextResponse.redirect(new URL('/purchase/failed?reason=payment_failed', request.url))
    }

    // Same amount guard as the Button rail: refuse if MonCash collected a materially
    // different amount than this order asked for.
    const amountCheck = isMonCashButtonPaidAmountAcceptable(Number(pendingTx.amount), paymentStatus.amount)
    if (amountCheck.verified && !amountCheck.ok) {
      console.error('[moncash_merchant] amount mismatch — refusing fulfillment', {
        orderId: pendingTx.order_id,
        expected: amountCheck.expected,
        paid: amountCheck.paid,
      })
      await supabase
        .from('pending_transactions')
        .update({ status: 'failed', failure_reason: 'amount_mismatch', needs_refund: true })
        .eq('order_id', String(pendingTx.order_id))
      return NextResponse.redirect(new URL('/purchase/failed?reason=amount_mismatch', request.url))
    }

    // The shared pipeline: atomic claim (a reload cannot issue twice), quantity
    // re-validation, atomic inventory reservation, fee incidence from the order.
    const result = await fulfillPaidOrder({
      orderId: String(pendingTx.order_id),
      paymentMethod: 'moncash',
      transactionId,
      logPrefix: '[moncash_merchant]',
    })

    switch (result.outcome) {
      case 'already_completed':
        return NextResponse.redirect(new URL(`/purchase/success?ticketId=${result.ticketId || ''}`, request.url))
      case 'in_progress':
        return NextResponse.redirect(new URL('/purchase/success', request.url))
      case 'capacity_exceeded':
        return NextResponse.redirect(new URL('/purchase/failed?reason=sold_out', request.url))
      case 'fulfilled':
        break
      default:
        return NextResponse.redirect(new URL(`/purchase/failed?reason=${result.outcome}`, request.url))
    }

    const guestRecipient = guestRecipientFromOrder(pendingTx)
    if (guestRecipient?.guestToken) {
      return NextResponse.redirect(
        new URL(`${guestTicketUrl(guestRecipient.guestToken)}?purchased=1`, request.url)
      )
    }
    return NextResponse.redirect(new URL(`/purchase/success?ticketId=${result.ticketId || ''}`, request.url))
  } catch (error) {
    console.error('MonCash callback error:', error)
    return NextResponse.redirect(new URL('/purchase/failed?reason=processing_error', request.url))
  }
}
