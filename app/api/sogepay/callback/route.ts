import { NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import {
  isSogepayConfigured,
  isSogepayCallbackVerificationConfigured,
  verifySogepaySignature,
  parseSogepayCallbackPayload,
  isSogepayPaidAmountAcceptable,
} from '@/lib/sogepay'
import { fulfillPaidOrder } from '@/lib/tickets/fulfillment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIGNATURE_HEADERS = ['x-sogepay-signature', 'x-signature', 'signature', 'x-sogepay-hmac']

function getSignatureHeader(request: Request): string | null {
  for (const name of SIGNATURE_HEADERS) {
    const value = request.headers.get(name)
    if (value) return value
  }
  return null
}

async function readPayload(rawBody: string, contentType: string): Promise<Record<string, any>> {
  if (!rawBody) return {}
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawBody)
    } catch {
      return {}
    }
  }
  // Try URL-encoded, then fall back to JSON.
  const params = new URLSearchParams(rawBody)
  const obj: Record<string, any> = {}
  let any = false
  params.forEach((value, key) => {
    any = true
    obj[key] = value
  })
  if (any) return obj
  try {
    return JSON.parse(rawBody)
  } catch {
    return {}
  }
}

/**
 * Server-to-server payment notification from Sogepay (the authoritative fulfillment trigger).
 *
 * Security: FAIL-CLOSED. We only issue tickets when the callback signature verifies against
 * SOGEPAY_WEBHOOK_SECRET. Without verification configured, we accept and log the notification
 * but never fulfill (prevents anyone from minting free tickets by POSTing here).
 */
export async function POST(request: Request) {
  try {
    if (!isSogepayConfigured()) {
      return NextResponse.json({ error: 'Sogepay is not configured' }, { status: 503 })
    }

    const rawBody = await request.text().catch(() => '')
    const contentType = request.headers.get('content-type') || ''
    const payload = await readPayload(rawBody, contentType)

    const verified = verifySogepaySignature(rawBody, getSignatureHeader(request))
    if (!verified) {
      // Do not fulfill on an unverified callback.
      console.warn('[sogepay] callback signature not verified; refusing to fulfill', {
        verificationConfigured: isSogepayCallbackVerificationConfigured(),
        hasSignature: Boolean(getSignatureHeader(request)),
      })
      // 401 so a correctly-configured Sogepay retries; if verification simply isn't set up yet,
      // this is the safe default (no tickets issued).
      return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 })
    }

    const { orderId, transactionId, amount, paid } = parseSogepayCallbackPayload(payload)

    if (!orderId) {
      // Nothing we can correlate. Return 200 so Sogepay doesn't retry forever on a bad record.
      console.warn('[sogepay] callback missing orderId; ignoring')
      return NextResponse.json({ ok: false, error: 'missing_order' })
    }

    const supabase = await createClient()
    const { data: pendingTx } = await supabase
      .from('pending_transactions')
      .select('*')
      .eq('order_id', orderId)
      .single()

    if (!pendingTx) {
      return NextResponse.json({ ok: false, error: 'transaction_not_found' })
    }

    // Idempotency: already fulfilled.
    if (pendingTx.status === 'completed' && pendingTx.ticket_id) {
      return NextResponse.json({ ok: true, alreadyCompleted: true, ticketId: pendingTx.ticket_id })
    }

    if (!paid) {
      await supabase.from('pending_transactions').update({ status: 'failed' }).eq('order_id', orderId)
      return NextResponse.json({ ok: true, paid: false })
    }

    // Defense-in-depth: verify the reported amount matches what we expected to charge.
    const amountCheck = isSogepayPaidAmountAcceptable(Number(pendingTx.amount), amount)
    if (amountCheck.verified && !amountCheck.ok) {
      console.error('[sogepay] callback amount mismatch — refusing fulfillment', {
        orderId,
        expected: amountCheck.expected,
        paid: amountCheck.paid,
        tolerance: amountCheck.tolerance,
      })
      await supabase
        .from('pending_transactions')
        .update({ status: 'failed', failure_reason: 'amount_mismatch' })
        .eq('order_id', orderId)
      return NextResponse.json({ ok: false, error: 'amount_mismatch' })
    }

    const result = await fulfillPaidOrder({
      orderId,
      paymentMethod: 'sogepay',
      transactionId,
      logPrefix: '[sogepay]',
    })

    if (result.outcome === 'capacity_exceeded') {
      // Paid, but the event/tier filled up before we could issue this ticket. fulfillPaidOrder has
      // already marked the order failed + needs_refund; acknowledge so Sogepay stops retrying.
      console.error('[sogepay] capacity exceeded after payment — order flagged for refund', {
        orderId,
        capacity: result.capacity,
      })
      return NextResponse.json({ ok: false, error: 'capacity_exceeded', needsRefund: true })
    }

    if (result.outcome === 'refused' || result.outcome === 'invalid_order') {
      // Flagged for refund (or malformed): never fulfilled. Acknowledge so Sogepay stops retrying.
      console.error('[sogepay] order not fulfillable — flagged for refund/review', {
        orderId,
        reason: result.reason,
      })
      return NextResponse.json({ ok: false, error: result.outcome, needsRefund: true })
    }

    if (result.outcome === 'ticket_creation_failed') {
      // Return 500 so Sogepay retries the (paid) notification and we can re-attempt fulfillment.
      return NextResponse.json({ ok: false, error: 'ticket_creation_failed' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, outcome: result.outcome, ticketId: result.ticketId })
  } catch (error: any) {
    console.error('[sogepay] callback error', error)
    // 500 invites a retry for transient failures.
    return NextResponse.json({ ok: false, error: 'processing_error' }, { status: 500 })
  }
}

/**
 * Browser return from the Sogepay hosted checkout.
 *
 * We cannot verify a payment from an unauthenticated browser GET, so this NEVER issues tickets.
 * It only reflects state: if the (verified) POST callback already fulfilled the order, send the
 * user to the success page; otherwise send them to a short polling page that waits for the
 * callback to land and then redirects to success/failed.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const orderId =
      searchParams.get('orderId') ||
      searchParams.get('order_id') ||
      searchParams.get('reference') ||
      searchParams.get('ref') ||
      null

    if (!orderId) {
      return NextResponse.redirect(new URL('/purchase/failed?reason=missing_order', request.url))
    }

    const supabase = await createClient()
    const { data: pendingTx } = await supabase
      .from('pending_transactions')
      .select('*')
      .eq('order_id', orderId)
      .single()

    if (!pendingTx) {
      return NextResponse.redirect(new URL('/purchase/failed?reason=transaction_not_found', request.url))
    }

    if (pendingTx.status === 'completed' && pendingTx.ticket_id) {
      return NextResponse.redirect(
        new URL(`/purchase/success?ticketId=${pendingTx.ticket_id}`, request.url)
      )
    }

    if (pendingTx.status === 'failed') {
      return NextResponse.redirect(new URL('/purchase/failed?reason=payment_failed', request.url))
    }

    // Still pending: the server-to-server callback may not have arrived yet. Hand off to a
    // polling page that watches the order status and routes to success/failed.
    return NextResponse.redirect(
      new URL(`/purchase/processing?provider=sogepay&orderId=${encodeURIComponent(orderId)}`, request.url)
    )
  } catch (error: any) {
    console.error('[sogepay] return error', error)
    return NextResponse.redirect(new URL('/purchase/failed?reason=processing_error', request.url))
  }
}
