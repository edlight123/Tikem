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
import { notifyTicketPurchase as notifyTicketPurchaseNotification } from '@/lib/notifications/helpers'
import { sendTicketConfirmation } from '@/lib/tickets/confirmation'
import { guestRecipientFromOrder } from '@/lib/guest/checkout'
import { attachTicketsToGuestOrder, guestTicketUrl, isGuestId } from '@/lib/guest/identity'
import { adminDb } from '@/lib/firebase/admin'
import {
  buildTierSoldIncrements,
  reserveInventoryAtomic,
  releaseInventoryReservation,
} from '@/lib/tickets/inventory'
import { addTicketToEarnings } from '@/lib/earnings'
import { promoBuyerKey, redeemPromoInTransaction } from '@/lib/promo-codes'
import { recordPromoterSale } from '@/lib/promoters'

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

type FulfillmentClaim =
  | { outcome: 'claimed' }
  | { outcome: 'already_completed'; ticketId: string | null }
  | { outcome: 'in_progress' }
  | { outcome: 'not_found' }

// Window after which a stuck "processing" claim is considered stale and may be
// re-claimed (e.g. if a previous fulfillment attempt crashed mid-way).
const FULFILLMENT_CLAIM_STALE_MS = 90_000

/**
 * Atomically claim a pending transaction (looked up by order_id) for fulfillment.
 * Uses a Firestore transaction so only ONE concurrent request creates tickets for a
 * given paid order. This prevents duplicate tickets / double-counted earnings when the
 * Return URL is hit more than once (browser retries, double submits, or the Alert
 * handler's GET->Return redirect racing the real browser return).
 */
async function claimOrderForFulfillment(orderId: string): Promise<FulfillmentClaim> {
  const snap = await adminDb
    .collection('pending_transactions')
    .where('order_id', '==', orderId)
    .limit(1)
    .get()

  if (snap.empty) return { outcome: 'not_found' }
  const ref = snap.docs[0].ref

  return adminDb.runTransaction(async (tx: any) => {
    const doc = await tx.get(ref)
    if (!doc.exists) return { outcome: 'not_found' } as FulfillmentClaim

    const data = doc.data() || {}

    // Already fulfilled — don't create a second set of tickets.
    if (data.status === 'completed' && data.ticket_id) {
      return { outcome: 'already_completed', ticketId: String(data.ticket_id) } as FulfillmentClaim
    }

    // Another request is actively fulfilling this same order (and hasn't gone stale).
    if (data.status === 'processing' && data.fulfillment_started_at) {
      const startedAt = new Date(data.fulfillment_started_at).getTime()
      if (Number.isFinite(startedAt) && Date.now() - startedAt < FULFILLMENT_CLAIM_STALE_MS) {
        return { outcome: 'in_progress' } as FulfillmentClaim
      }
    }

    tx.update(ref, {
      status: 'processing',
      fulfillment_started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    return { outcome: 'claimed' } as FulfillmentClaim
  })
}

/**
 * Release a fulfillment claim so the order can be retried later (used when ticket
 * creation fails after the claim was taken).
 */
async function releaseOrderClaim(orderId: string): Promise<void> {
  try {
    const snap = await adminDb
      .collection('pending_transactions')
      .where('order_id', '==', orderId)
      .limit(1)
      .get()
    if (snap.empty) return
    await snap.docs[0].ref.set(
      { status: 'pending', fulfillment_started_at: null, updated_at: new Date().toISOString() },
      { merge: true }
    )
  } catch (err) {
    console.error('MonCash Button return: failed to release fulfillment claim', err)
  }
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

      await supabase
        .from('pending_transactions')
        .update({ status: 'failed', failure_reason: gatewayReason })
        .eq('order_id', orderId)

      return NextResponse.redirect(new URL('/purchase/failed?reason=payment_failed', request.url))
    }

    // Defense-in-depth: verify the amount the gateway reports as paid matches what we asked
    // it to charge (pendingTx.amount is the HTG amount we encrypted into the checkout).
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
        .update({ status: 'failed', failure_reason: 'amount_mismatch' })
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

    // Payment confirmed. Atomically claim this order so only one request fulfills it.
    // Without this, concurrent Return requests for the same order could each create a
    // full set of tickets (and double-count earnings) for a single payment.
    const claim = await claimOrderForFulfillment(orderId)
    if (claim.outcome === 'already_completed') {
      return NextResponse.redirect(
        new URL(`/purchase/success?ticketId=${claim.ticketId || ''}`, request.url)
      )
    }
    if (claim.outcome === 'in_progress') {
      // Another request is already finalizing this exact payment; avoid duplicates.
      return NextResponse.redirect(new URL('/purchase/success', request.url))
    }
    if (claim.outcome === 'not_found') {
      return NextResponse.redirect(new URL('/purchase/failed?reason=transaction_not_found', request.url))
    }
    // claim.outcome === 'claimed': we own fulfillment for this order from here on.

    // Fetch event + attendee
    const { data: eventDetails } = await supabase
      .from('events')
      .select('*')
      .eq('id', pendingTx.event_id)
      .single()

    // WHO gets this ticket. An account purchase resolves `users/{uid}` exactly as
    // before; a GUEST has no user document, so the name/email/phone captured when the
    // checkout was created — and stored on this order — are the authority. Nothing is
    // read from the gateway's redirect except the fact of payment.
    const guestRecipient = guestRecipientFromOrder(pendingTx)
    const isGuestOrder = Boolean(guestRecipient)

    const { data: accountAttendee } = isGuestOrder
      ? { data: null }
      : await supabase.from('users').select('*').eq('id', pendingTx.user_id).single()

    const attendee: any = guestRecipient
      ? {
          email: guestRecipient.email,
          full_name: guestRecipient.name,
          phone: guestRecipient.phone,
          is_guest: true,
        }
      : accountAttendee

    const tierSelections: Array<{ tierId?: string | null; tierName?: string; quantity: number; unitPrice: number; originalUnitPrice?: number }> =
      Array.isArray(pendingTx.tier_selections) && pendingTx.tier_selections.length > 0
        ? pendingTx.tier_selections
        : [
            {
              tierId: pendingTx.tier_id || null,
              tierName: pendingTx.tier_name || 'General Admission',
              quantity: pendingTx.quantity || 1,
              unitPrice: (pendingTx.amount || 0) / Math.max(1, pendingTx.quantity || 1),
            },
          ]

    const eventCurrency = String(pendingTx.original_currency || pendingTx.currency || 'HTG').toUpperCase() === 'USD' ? 'USD' : 'HTG'
    const chargedCurrency = String(pendingTx.currency || 'HTG').toUpperCase() === 'USD' ? 'USD' : 'HTG'
    const fxRate = pendingTx.exchange_rate_used != null ? Number(pendingTx.exchange_rate_used) : null
    const fxBaseRate = pendingTx.exchange_rate_base != null ? Number(pendingTx.exchange_rate_base) : null
    const fxSpreadPercent = pendingTx.exchange_rate_spread_percent != null ? Number(pendingTx.exchange_rate_spread_percent) : null
    const fxProvider = pendingTx.exchange_rate_provider != null ? String(pendingTx.exchange_rate_provider) : null
    const fxFetchedAt = pendingTx.exchange_rate_fetched_at != null ? String(pendingTx.exchange_rate_fetched_at) : null

    const pendingPaymentMethodRaw = String(
      (pendingTx as any)?.payment_method || (pendingTx as any)?.mobile_money_provider || 'moncash_button'
    ).toLowerCase()
    const normalizedPaymentMethod = pendingPaymentMethodRaw === 'natcash' ? 'natcash' : pendingPaymentMethodRaw === 'moncash' ? 'moncash' : 'moncash_button'

    // Authoritative oversell gate: atomically re-check capacity and reserve inventory BEFORE
    // issuing tickets. Prevents overselling when many buyers complete payment near sold-out.
    // If it refuses, the order is paid but can't be honored — flag for refund, issue no tickets.
    const tierIncrements = buildTierSoldIncrements(tierSelections)
    const reservation = await reserveInventoryAtomic({
      eventId: String(pendingTx.event_id),
      quantity: Number(pendingTx.quantity || 1),
      tierIncrements,
      logPrefix: '[moncash_button]',
    })
    if (!reservation.ok) {
      console.error('[moncash_button] capacity exceeded after payment — refusing to issue tickets', {
        orderId,
        reason: reservation.reason,
        tierId: reservation.tierId,
        remaining: reservation.remaining,
      })
      await supabase
        .from('pending_transactions')
        .update({ status: 'failed', failure_reason: 'capacity_exceeded', needs_refund: true })
        .eq('order_id', orderId)
      return NextResponse.redirect(new URL('/purchase/failed?reason=sold_out', request.url))
    }

    // Create tickets
    const createdTickets: any[] = []

    for (const selection of tierSelections) {
      const selectionQty = selection.quantity || 0
      for (let i = 0; i < selectionQty; i++) {
        const organizerUnitPrice = (() => {
          if (eventCurrency === 'USD') {
            const raw = selection.originalUnitPrice
            if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
            const fallback = Number(pendingTx.original_amount || 0) / Math.max(1, pendingTx.quantity || 1)
            return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
          }
          return selection.unitPrice
        })()

        const ticketData = {
          event_id: pendingTx.event_id,
          attendee_id: pendingTx.user_id,
          attendee_name: attendee?.full_name || attendee?.email || 'Guest',
          // Organizer-facing/event currency
          price_paid: organizerUnitPrice,
          currency: eventCurrency,
          original_currency: eventCurrency,
          // settlement-per-event fx rate (HTG per USD for MonCash USD events)
          exchange_rate_used: fxRate,
          // Auditing
          charged_amount: selection.unitPrice,
          charged_currency: chargedCurrency,
          payment_method: normalizedPaymentMethod,
          payment_id: transactionId || payment.transNumber || orderId,
          // Promoter attribution: opaque ids only; the commission economics live in
          // the server-only promoter_sales ledger.
          promoter_id: pendingTx.promoter_id || null,
          promoter_code: pendingTx.promoter_code || null,
          status: 'valid',
          purchased_at: new Date().toISOString(),
          tier_name: selection.tierName || 'General Admission',
          tier_id: selection.tierId || null,
          // Include event date fields for scanner
          start_datetime: eventDetails?.start_datetime || null,
          end_datetime: eventDetails?.end_datetime || null,
          event_date: eventDetails?.start_datetime || null,
          venue_name: eventDetails?.venue_name || null,
          city: eventDetails?.city || null,
          // Guest tickets carry the buyer's own contact details so refunds and support
          // can find the order by email or phone without a uid to join on.
          ...(guestRecipient
            ? {
                is_guest: true,
                guest_email: guestRecipient.email,
                guest_phone: guestRecipient.phone || null,
              }
            : {}),
        }

        const insertResult = await supabase.from('tickets').insert([ticketData]).select()

        if (insertResult.error) {
          console.error('Failed to create ticket:', insertResult.error)
          // Return the inventory we reserved and release the claim so a later Return/Alert retry
          // can re-reserve and re-attempt fulfillment for this (already paid) order.
          await releaseInventoryReservation({
            eventId: String(pendingTx.event_id),
            quantity: Number(pendingTx.quantity || 1),
            tierIncrements,
            logPrefix: '[moncash_button]',
          })
          await releaseOrderClaim(orderId)
          return NextResponse.redirect(new URL('/purchase/failed?reason=ticket_creation_failed', request.url))
        }

        const createdTicket = insertResult.data?.[0]
        if (createdTicket) {
          await supabase.from('tickets').update({ qr_code_data: createdTicket.id }).eq('id', createdTicket.id)
          createdTicket.qr_code_data = createdTicket.id
          createdTickets.push(createdTicket)

          // Mirror into Firestore for organizer earnings and admin analytics.
          try {
            await adminDb.collection('tickets').doc(String(createdTicket.id)).set(
              {
                event_id: pendingTx.event_id,
                attendee_id: pendingTx.user_id,
                user_id: pendingTx.user_id,
                status: 'confirmed',
                ticket_type: selection.tierName || 'General Admission',
                price_paid: organizerUnitPrice,
                currency: eventCurrency,
                ...(guestRecipient
                  ? {
                      is_guest: true,
                      guest_email: guestRecipient.email,
                      guest_phone: guestRecipient.phone || null,
                      attendee_name: guestRecipient.name,
                    }
                  : {}),
                exchange_rate_used: fxRate,
                exchange_rate_base: fxBaseRate,
                exchange_rate_spread_percent: fxSpreadPercent,
                exchange_rate_provider: fxProvider,
                exchange_rate_fetched_at: fxFetchedAt,
                charged_amount: selection.unitPrice,
                charged_currency: chargedCurrency,
                payment_method: normalizedPaymentMethod,
                payment_id: transactionId || payment.transNumber || orderId,
                promoter_id: pendingTx.promoter_id || null,
                promoter_code: pendingTx.promoter_code || null,
                purchased_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              { merge: true }
            )
          } catch (e) {
            console.warn('[moncash_button] failed to mirror ticket to Firestore', {
              ticketId: createdTicket.id,
              message: (e as any)?.message,
            })
          }
        }
      }
    }

    // Redeem the promo code atomically (Firestore) — the SINGLE redemption point for this order.
    // We hold the exclusive fulfillment claim (claimOrderForFulfillment) from here on, so this
    // runs exactly once per paid order; a duplicate Return/Alert hit short-circuits earlier as
    // already_completed / in_progress. pendingTx.promo_code_id is the resolved promo doc id
    // stamped at initiate only when a discount was applied. If the cap filled between initiate
    // and confirm we keep the issued tickets and only log; redemption never throws.
    if (createdTickets.length > 0 && pendingTx.promo_code_id) {
      try {
        const redeem = await redeemPromoInTransaction({
          promoId: String(pendingTx.promo_code_id),
          qty: Number(pendingTx.quantity || createdTickets.length || 1),
          userId: pendingTx.user_id ? String(pendingTx.user_id) : null,
          // For a guest the pending transaction's user_id is a per-order `guest_…` id;
          // the email captured on that order is what a per-buyer cap can count.
          buyerKey: promoBuyerKey({
            isGuest: Boolean(pendingTx.is_guest),
            id: pendingTx.user_id ? String(pendingTx.user_id) : null,
            email: pendingTx.guest_email,
            phone: pendingTx.guest_phone,
          }),
          eventId: pendingTx.event_id ? String(pendingTx.event_id) : null,
          discountApplied:
            pendingTx.promo_discount_total != null ? Number(pendingTx.promo_discount_total) : null,
        })
        if (redeem.capReached) {
          console.warn('[moncash_button] promo cap reached at confirm; tickets kept, not over-counted', {
            promoId: String(pendingTx.promo_code_id),
            eventId: pendingTx.event_id,
          })
        }
      } catch (promoErr) {
        console.error('[moncash_button] promo redemption failed', (promoErr as any)?.message)
      }
    }

    // Attribute the sale to its promoter — same exclusive fulfillment claim as the
    // promo redemption above; a bookkeeping failure never breaks the sale. The
    // recorded commission is withheld from the organizer's earnings below.
    let promoterCommissionCents = 0
    if (createdTickets.length > 0 && pendingTx.promoter_id) {
      const promoterSale = await recordPromoterSale({
        promoterId: String(pendingTx.promoter_id),
        eventId: String(pendingTx.event_id),
        ticketIds: createdTickets.map((t: any) => String(t.id)),
        quantity: Number(pendingTx.quantity || createdTickets.length || 1),
        // Organizer-facing gross in event currency — the same base the earnings
        // ledger uses below.
        orderGrossCents: Math.round(Number(pendingTx.original_amount || 0) * 100),
        currency: eventCurrency,
        paymentMethod: normalizedPaymentMethod,
        paymentId: transactionId || payment.transNumber || orderId,
        buyerUserId: pendingTx.is_guest ? null : pendingTx.user_id ? String(pendingTx.user_id) : null,
        buyerEmail: pendingTx.guest_email || attendee?.email || null,
      })
      if (promoterSale.recorded) promoterCommissionCents = promoterSale.commissionCents
    }

    // Update Firestore earnings in event currency.
    try {
      const grossEventCents = Math.round(Number(pendingTx.original_amount || 0) * 100)
      await addTicketToEarnings(pendingTx.event_id, grossEventCents, Number(pendingTx.quantity || 1), {
        currency: eventCurrency,
        paymentMethod: normalizedPaymentMethod,
        chargedAmountCents: Math.round(Number(pendingTx.amount || 0) * 100),
        fxRate,
        chargedCurrency,
        promoterCommissionCents,
      })
    } catch (e) {
      console.warn('[moncash_button] failed to update earnings', { message: (e as any)?.message })
    }

    const ticket = createdTickets[0]
      ? {
          ...createdTickets[0],
          event: eventDetails,
          attendee,
        }
      : null

    // Update transaction status
    await supabase
      .from('pending_transactions')
      .update({
        status: 'completed',
        ticket_id: ticket?.id || null,
        transaction_id: transactionId || payment.transNumber || null,
        moncash_trans_number: payment.transNumber || null,
        moncash_payer: payment.payer || null,
      })
      .eq('order_id', orderId)

    // NOTE: inventory was already incremented up front by reserveInventoryAtomic (the oversell
    // gate), so we intentionally do NOT increment again here.

    // Deliver the ticket + notify (best-effort — the payment is done and the tickets
    // exist; a mail/SMS failure must never turn this into a failed purchase).
    if (ticket?.id) {
      try {
        if (guestRecipient && pendingTx.guest_order_key) {
          await attachTicketsToGuestOrder(
            String(pendingTx.guest_order_key),
            createdTickets.map((t: any) => String(t.id))
          )
        }

        // In-app + push notification (same pipeline as Stripe purchases). A guest has
        // no account for it to land in, so it is skipped for them.
        if (
          pendingTx.user_id &&
          !isGuestId(pendingTx.user_id) &&
          pendingTx.event_id &&
          eventDetails?.title
        ) {
          try {
            await notifyTicketPurchaseNotification(
              String(pendingTx.user_id),
              String(pendingTx.event_id),
              String(eventDetails.title),
              createdTickets.length || (pendingTx.quantity || 1)
            )
          } catch (error) {
            console.error('MonCash Button: failed to send purchase notification', error)
          }
        }

        if (ticket.attendee && ticket.event) {
          await sendTicketConfirmation({
            ticketId: String(ticket.id),
            qrPayload: ticket.qr_code_data || ticket.id,
            event: ticket.event,
            recipient: {
              email: ticket.attendee.email,
              name: ticket.attendee.full_name,
              phone: ticket.attendee.phone,
              isGuest: isGuestOrder,
            },
            quantity: pendingTx.quantity || 1,
            guestToken: guestRecipient?.guestToken || null,
            logPrefix: '[moncash_button]',
          })
        }
      } catch (error) {
        console.error('[moncash_button] post-fulfillment delivery error', error)
      }
    }

    // A guest has no /tickets page to land on — send them straight to their own
    // signed ticket page, which is also where they are offered an account.
    if (guestRecipient?.guestToken) {
      return NextResponse.redirect(
        new URL(`${guestTicketUrl(guestRecipient.guestToken)}?purchased=1`, request.url)
      )
    }

    return NextResponse.redirect(new URL(`/purchase/success?ticketId=${ticket?.id || ''}`, request.url))
  } catch (error: any) {
    console.error('MonCash Button return error:', error)
    return NextResponse.redirect(new URL('/purchase/failed?reason=processing_error', request.url))
  }
}
