import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/firebase-db/server'
import {
  decryptMonCashButtonReturnTransactionId,
  getMonCashButtonReturnDecryptConfig,
  getMonCashButtonPaymentByOrderId,
  getMonCashButtonPaymentByTransactionId,
  isMonCashButtonPaidAmountAcceptable,
} from '@/lib/moncash-button'
import {
  retrieveMonCashOrderPayment,
  retrieveMonCashTransactionPayment,
} from '@/lib/moncash'
import { guestRecipientFromOrder } from '@/lib/guest/checkout'
import { guestTicketUrl } from '@/lib/guest/identity'
import { fulfillPaidOrder, fulfillmentBlockedReason } from '@/lib/tickets/fulfillment'

export const runtime = 'nodejs'

export const dynamic = 'force-dynamic'

function tryExtractReferenceFromJwtLikeToken(token: string): string | null {
  // Digicel sometimes passes a JWT-like token as `transactionId`.
  // We don't need to verify the signature; we only want the embedded `ref`/reference
  // and we still verify payment via MonCash middleware by orderId afterwards.
  const parts = token.split('.')
  if (parts.length < 2) return null
  const payload = parts[1]
  try {
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const json = Buffer.from(padded, 'base64').toString('utf8')
    const data = JSON.parse(json)
    const ref = data?.ref ?? data?.reference ?? null
    return typeof ref === 'string' && ref.trim() ? ref.trim() : null
  } catch {
    return null
  }
}

function buildTokenVariants(token: string): string[] {
  const raw = String(token || '').trim()
  if (!raw) return []

  const decoded = (() => {
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  })()

  const stripPadding = (v: string) => v.replace(/=+$/g, '')
  const toBase64 = (v: string) => v.replace(/-/g, '+').replace(/_/g, '/')
  const toBase64Url = (v: string) => v.replace(/\+/g, '-').replace(/\//g, '_')

  const candidates = [
    raw,
    decoded,
    stripPadding(raw),
    stripPadding(decoded),
    toBase64(raw),
    toBase64(decoded),
    stripPadding(toBase64(raw)),
    stripPadding(toBase64(decoded)),
    toBase64Url(raw),
    toBase64Url(decoded),
    stripPadding(toBase64Url(raw)),
    stripPadding(toBase64Url(decoded)),
  ]

  return Array.from(new Set(candidates.map((c) => c.trim()).filter(Boolean)))
}

async function tryResolveOrderIdFromAlerts(supabase: any, transactionId: string): Promise<string | null> {
  const candidates = buildTokenVariants(transactionId)
  for (const candidate of candidates) {
    const { data } = await supabase
      .from('moncash_button_alerts')
      .select('reference')
      .eq('transaction_id', candidate)
      .single()

    if (data?.reference) return String(data.reference)

    const { data: data2 } = await supabase
      .from('moncash_button_alerts')
      .select('reference')
      .contains('transaction_id_variants', candidate)
      .single()

    if (data2?.reference) return String(data2.reference)
  }
  return null
}

export async function GET(request: Request): Promise<NextResponse> {
  // Defense-in-depth: a payment return must NEVER be cached by the browser or a shared
  // CDN/proxy. If it were, the gateway redirect back to this URL could be served from cache
  // and skip fulfillment entirely (or hand one buyer another buyer's cached redirect).
  // next.config.js already marks /api/* as no-store; we also stamp it here so the guarantee
  // holds even if the app is served behind a proxy that ignores those headers.
  let response: NextResponse
  try {
    response = await handleMonCashButtonReturn(request)
  } catch (error: any) {
    console.error('MonCash Button return error:', error)
    response = NextResponse.redirect(new URL('/purchase/failed?reason=processing_error', request.url))
  }
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  return response
}

async function handleMonCashButtonReturn(request: Request): Promise<NextResponse> {
  const cookieStore = await cookies()
  try {
    const { searchParams } = new URL(request.url)

    // Digicel parameter names can vary depending on configuration.
    const transactionIdEncrypted =
      searchParams.get('transactionId') ||
      searchParams.get('transaction_id') ||
      searchParams.get('transNumber') ||
      searchParams.get('trans_number') ||
      searchParams.get('trans') ||
      null

    // Per Digicel docs, ReturnUrl transactionId is encrypted.
    // Decrypt it (best-effort) to obtain the real transaction id used for Payment/Transaction lookup.
    const transactionIdDecrypted = transactionIdEncrypted
      ? decryptMonCashButtonReturnTransactionId(transactionIdEncrypted)
      : null

    const transactionId = transactionIdDecrypted || transactionIdEncrypted

    if (transactionIdEncrypted) {
      const encLen = String(transactionIdEncrypted).length
      const decLen = transactionIdDecrypted ? String(transactionIdDecrypted).length : null
      const decryptCfg = getMonCashButtonReturnDecryptConfig()
      console.info('[moncash_button] return: transactionId decrypt', {
        hasEncrypted: true,
        encryptedLen: encLen,
        decrypted: Boolean(transactionIdDecrypted),
        decryptedLen: decLen,
        ...decryptCfg,
      })
    }

    // Prefer explicit orderId if provided.
    const orderIdFromQuery =
      searchParams.get('orderId') ||
      searchParams.get('order_id') ||
      searchParams.get('reference') ||
      searchParams.get('ref') ||
      null

    let orderId: string | null = orderIdFromQuery

    const supabase = await createClient()

    // If transactionId is a JWT-like token, it may contain the reference/orderId.
    if (!orderId && transactionIdEncrypted && transactionIdEncrypted.includes('.')) {
      const extracted = tryExtractReferenceFromJwtLikeToken(transactionIdEncrypted)
      if (extracted) {
        orderId = extracted
      }
    }

    // Attempt to map a token-like transactionId to our stored checkout token.
    // Some portal setups redirect with a token in transactionId (looks like base64/base64url).
    if (!orderId && transactionIdEncrypted) {
      for (const candidate of buildTokenVariants(transactionIdEncrypted)) {
        const { data: tokenTx } = await supabase
          .from('pending_transactions')
          .select('order_id')
          .eq('moncash_button_token', candidate)
          .single()

        if (tokenTx?.order_id) {
          orderId = String(tokenTx.order_id)
          break
        }

        // Also check optional variants array if present.
        const { data: tokenTx2 } = await supabase
          .from('pending_transactions')
          .select('order_id')
          .contains('moncash_button_token_variants', candidate)
          .single()

        if (tokenTx2?.order_id) {
          orderId = String(tokenTx2.order_id)
          break
        }
      }
    }

    // Cookie correlation fallback (set during /api/moncash-button/initiate).
    if (!orderId) {
      const jar = cookieStore
      const orderIdFromCookie =
        jar.get('moncash_button_order_id')?.value ||
        jar.get('__Host-moncash_button_order_id')?.value ||
        jar.get('moncash_button_order_id_domain')?.value ||
        null
      if (orderIdFromCookie) orderId = orderIdFromCookie
    }

    // Alert-based correlation fallback: the Alert endpoint can arrive before (or instead of) a usable cookie.
    if (!orderId && transactionIdEncrypted) {
      const fromAlerts = await tryResolveOrderIdFromAlerts(supabase, transactionIdEncrypted)
      if (fromAlerts) orderId = fromAlerts
    }

    // Cookie-less correlation: Digicel provides transactionId; the payment reference should match our orderId.
    // NOTE: Our Firebase DB adapter does NOT support `.or()`; using it can accidentally run an unfiltered query.
    // So we try a couple of explicit equality lookups instead.
    let paymentFromLookup: any = null
    if (!orderId && transactionId) {
      const { data: txMatch1 } = await supabase
        .from('pending_transactions')
        .select('order_id')
        .eq('transaction_id', transactionId)
        .single()

      if (txMatch1?.order_id) {
        orderId = String(txMatch1.order_id)
      } else {
        const { data: txMatch2 } = await supabase
          .from('pending_transactions')
          .select('order_id')
          .eq('moncash_trans_number', transactionId)
          .single()

        if (txMatch2?.order_id) {
          orderId = String(txMatch2.order_id)
        }
      }
    }

    if (!orderId && transactionId) {
      // MonCash gateway: resolve orderId from the gateway transaction (RetrieveTransactionPayment).
      try {
        paymentFromLookup = await retrieveMonCashTransactionPayment(transactionId)
        if (paymentFromLookup?.reference) {
          orderId = String(paymentFromLookup.reference)
        }
      } catch (err) {
        console.error('MonCash gateway return: transaction lookup failed', err)
      }
      // Fallback: NatCash / legacy button middleware lookup.
      if (!orderId) {
        try {
          paymentFromLookup = await getMonCashButtonPaymentByTransactionId(transactionId)
          if (paymentFromLookup?.reference) {
            orderId = String(paymentFromLookup.reference)
          }
        } catch (err) {
          console.error('MonCash Button return: transaction lookup fallback failed', err)
        }
      }
    }

    if (!orderId) {
      console.warn('[moncash_button] return: missing_order', {
        hasTransactionId: Boolean(transactionIdEncrypted),
        queryKeys: Array.from(searchParams.keys()),
        hasCookieOrder: Boolean(
          cookieStore.get('moncash_button_order_id')?.value ||
            cookieStore.get('__Host-moncash_button_order_id')?.value ||
            cookieStore.get('moncash_button_order_id_domain')?.value
        ),
      })
      return NextResponse.redirect(new URL('/purchase/failed?reason=missing_order', request.url))
    }

    const { data: pendingTx, error: txError } = await supabase
      .from('pending_transactions')
      .select('*')
      .eq('order_id', orderId)
      .single()

    if (txError || !pendingTx) {
      return NextResponse.redirect(new URL('/purchase/failed?reason=transaction_not_found', request.url))
    }

    // Idempotency: if the transaction is already completed and has a ticket id, don't create duplicates.
    if (pendingTx.status === 'completed' && pendingTx.ticket_id) {
      return NextResponse.redirect(new URL(`/purchase/success?ticketId=${pendingTx.ticket_id}`, request.url))
    }

    // An order flagged for refund (paid but sold out, amount mismatch, invalid) is
    // NEVER fulfilled afterwards — reloading this URL once a seat frees up must not
    // hand the buyer tickets while the refund is still owed. fulfillPaidOrder refuses
    // it again inside its claim transaction; this just answers early.
    if (fulfillmentBlockedReason(pendingTx)) {
      return NextResponse.redirect(new URL('/purchase/failed?reason=refund_pending', request.url))
    }

    // Verify payment. MonCash uses the REST gateway (RetrieveOrderPayment);
    // NatCash uses the legacy button middleware.
    const verifyProvider = String(
      pendingTx.mobile_money_provider || pendingTx.payment_method || 'moncash'
    ).toLowerCase()
    const payment =
      paymentFromLookup ||
      (verifyProvider === 'natcash'
        ? await getMonCashButtonPaymentByOrderId(orderId)
        : await retrieveMonCashOrderPayment(orderId))

    const isPaid = !!(payment?.success && payment?.payment_status)

    if (!isPaid) {
      // Keep Digicel's own words. Their rejections are account-level and specific
      // ("Failed to match a reason type because the Identity Type factor of the
      // credit party does not match"), and without this the only trace a failed
      // sale leaves is a bare `failed` row.
      const gatewayReason = String(payment?.payment_status || '').trim() || 'payment_failed'
      console.warn('[moncash_button] return: gateway reports not paid', { orderId, gatewayReason })

      // Only a still-PENDING order is marked failed. The buyer can land here BEFORE
      // finishing payment (back button, closed OTP screen, a slow ledger), so this is
      // "not paid yet", not a verdict: `failure_source` marks it as a gateway answer
      // the reconcile cron re-checks, and fulfillment can still claim it if Digicel
      // later reports it paid. A processing/completed order is never touched.
      await supabase
        .from('pending_transactions')
        .update({
          status: 'failed',
          failure_reason: gatewayReason,
          failure_source: 'gateway_not_paid',
          failed_at: new Date().toISOString(),
        })
        .eq('order_id', orderId)
        .eq('status', 'pending')

      return NextResponse.redirect(new URL('/purchase/failed?reason=payment_failed', request.url))
    }

    // Defense-in-depth: verify the amount the gateway reports as paid matches what we asked
    // it to charge (pendingTx.amount is the HTG amount we encrypted into the checkout,
    // face value plus any fee the organizer passes on to the buyer).
    // If Digicel reports a materially different `cost`, refuse to issue tickets. When the
    // gateway omits `cost`, we can't verify and proceed (but log for monitoring).
    const amountCheck = isMonCashButtonPaidAmountAcceptable(Number(pendingTx.amount), payment?.cost)
    if (amountCheck.verified && !amountCheck.ok) {
      console.error('[moncash_button] return: amount mismatch — refusing fulfillment', {
        orderId,
        expected: amountCheck.expected,
        paid: amountCheck.paid,
        tolerance: amountCheck.tolerance,
      })
      await supabase
        .from('pending_transactions')
        .update({ status: 'failed', failure_reason: 'amount_mismatch', needs_refund: true })
        .eq('order_id', orderId)

      return NextResponse.redirect(new URL('/purchase/failed?reason=amount_mismatch', request.url))
    }
    if (!amountCheck.verified) {
      console.warn('[moncash_button] return: payment cost missing/unverifiable; skipping amount check', {
        orderId,
        expected: amountCheck.expected,
        hasCost: payment?.cost != null,
      })
    }

    const pendingPaymentMethodRaw = String(
      (pendingTx as any)?.payment_method || (pendingTx as any)?.mobile_money_provider || 'moncash_button'
    ).toLowerCase()
    const normalizedPaymentMethod = pendingPaymentMethodRaw === 'natcash' ? 'natcash' : pendingPaymentMethodRaw === 'moncash' ? 'moncash' : 'moncash_button'

    // Payment confirmed. Issue the tickets through the ONE shared pipeline the
    // reconcile cron and Sogepay also use (lib/tickets/fulfillment.ts): its atomic
    // claim makes concurrent Return/Alert hits fulfil once, it re-validates the stored
    // quantities, reserves inventory atomically, and stamps fee incidence from the
    // ORDER (so a fee passed on to the buyer is recorded as such). This handler used
    // to carry its own copy of all of that, which had drifted.
    const gatewayTransactionId = transactionId || payment?.transNumber || payment?.transactionId || null
    const result = await fulfillPaidOrder({
      orderId,
      paymentMethod: normalizedPaymentMethod,
      transactionId: gatewayTransactionId,
      payer: payment?.payer || null,
      logPrefix: '[moncash_button]',
      completionFields: {
        moncash_trans_number: payment?.transNumber || payment?.transactionId || null,
        moncash_payer: payment?.payer || null,
      },
    })

    switch (result.outcome) {
      case 'already_completed':
        return NextResponse.redirect(
          new URL(`/purchase/success?ticketId=${result.ticketId || ''}`, request.url)
        )
      case 'in_progress':
        // Another request is already finalizing this exact payment; avoid duplicates.
        return NextResponse.redirect(new URL('/purchase/success', request.url))
      case 'not_found':
        return NextResponse.redirect(new URL('/purchase/failed?reason=transaction_not_found', request.url))
      case 'capacity_exceeded':
        // Paid, but sold out: fulfillment flagged the order for refund, issued nothing.
        return NextResponse.redirect(new URL('/purchase/failed?reason=sold_out', request.url))
      case 'ticket_creation_failed':
        // Inventory and the claim were released, so a retry can complete it.
        return NextResponse.redirect(new URL('/purchase/failed?reason=ticket_creation_failed', request.url))
      case 'refused':
      case 'invalid_order':
        return NextResponse.redirect(new URL('/purchase/failed?reason=refund_pending', request.url))
      case 'fulfilled':
      default:
        break
    }

    // A guest has no /tickets page to land on — send them straight to their own
    // signed ticket page, which is also where they are offered an account.
    const guestRecipient = guestRecipientFromOrder(pendingTx)
    if (guestRecipient?.guestToken) {
      return NextResponse.redirect(
        new URL(`${guestTicketUrl(guestRecipient.guestToken)}?purchased=1`, request.url)
      )
    }

    return NextResponse.redirect(new URL(`/purchase/success?ticketId=${result.ticketId || ''}`, request.url))
  } catch (error: any) {
    console.error('MonCash Button return error:', error)
    return NextResponse.redirect(new URL('/purchase/failed?reason=processing_error', request.url))
  }
}
