/**
 * Paying for a printed batch, upfront, on Tikèm's own rails:
 *   - MonCash: the existing MonCash Button flow (createMonCashButtonCheckoutToken
 *     → redirect → /api/moncash-button/return, verified with
 *     retrieveMonCashOrderPayment). funds_rail 'moncash'.
 *   - Card: a Stripe Checkout session on the PLATFORM account (no Connect
 *     destination: this is Tikèm's revenue), HTG converted to USD with the
 *     guarded FX engine (lib/fx/usd-htg.ts). funds_rail 'stripe_platform'.
 *   - Balance: the organizer's released balance (./balanceOffset.ts).
 *     funds_rail 'balance_offset'.
 *
 * The rail primitives are shared with the door team (lib/platformPay).
 * Every confirmation path ends in markBatchPaid, which is idempotent.
 */

import { adminDb } from '@/lib/firebase/admin'
import {
  CARD_SESSION_TTL_SECONDS,
  CardFxUnavailableError,
  cardAmountForHtg,
  cardSessionPaidInFull,
  createPlatformCheckout,
  expireOpenCheckoutSession,
  htgToUsdCentsAtHtgPerUsd,
  retrieveCheckoutSession,
} from '@/lib/platformPay/card'
import { checkMonCashOrder, monCashRedirectFor, newMonCashOrderId } from '@/lib/platformPay/moncash'
import { PHYSICAL_BATCH_ORDERS, cancelUnpaidBatch, markBatchPaid, type BatchDoc } from './batches'
import { PAYMENT_WINDOW_MS, PHYSICAL_BATCHES } from './rules'

// The card/MonCash primitives live in lib/platformPay (shared with the door
// team); re-exported so existing callers and tests keep their imports.
export { CARD_SESSION_TTL_SECONDS, CardFxUnavailableError, cardSessionPaidInFull, htgToUsdCentsAtHtgPerUsd }

export function batchPageUrl(origin: string, batch: { id: string; event_id: string }, extra = ''): string {
  return `${origin}/organizer/events/${encodeURIComponent(batch.event_id)}/printed?batch=${encodeURIComponent(batch.id)}${extra}`
}

/**
 * Switching AWAY from card (to MonCash or the balance): forget the batch's card
 * session FIRST (so its later checkout.session.expired cannot match and cancel
 * the batch), then expire it if it is still open.
 */
export async function retireCardSession(batch: Pick<BatchDoc, 'id' | 'payment'>): Promise<void> {
  const sessionId = String(batch.payment?.stripe_session_id || '')
  if (!sessionId) return
  await adminDb.collection(PHYSICAL_BATCHES).doc(batch.id).update({
    'payment.stripe_session_id': null,
    'payment.retired_stripe_session_id': sessionId,
    updated_at: new Date().toISOString(),
  })
  await expireOpenCheckoutSession(sessionId, { batchId: batch.id })
}

/** Start a MonCash payment; returns the gateway URL to send the organizer to. */
export async function startMonCashBatchPayment(batch: BatchDoc): Promise<{ redirectUrl: string; orderId: string }> {
  const orderId = newMonCashOrderId()
  await adminDb.collection(PHYSICAL_BATCH_ORDERS).doc(orderId).set({
    batch_id: batch.id,
    event_id: batch.event_id,
    amount_htg: batch.total_htg,
    created_at: new Date().toISOString(),
  })
  await retireCardSession(batch)
  await adminDb.collection(PHYSICAL_BATCHES).doc(batch.id).update({
    'payment.order_id': orderId,
    'payment.method': 'moncash',
    'payment.funds_rail': 'moncash',
    updated_at: new Date().toISOString(),
  })
  return { redirectUrl: await monCashRedirectFor(batch.total_htg, orderId), orderId }
}

/** Is this MonCash order id a printed-batch payment? Returns the order doc. */
export async function findBatchOrder(orderId: string): Promise<{ batch_id: string; event_id: string; amount_htg: number } | null> {
  if (!orderId || orderId.includes('/')) return null
  const snap = await adminDb.collection(PHYSICAL_BATCH_ORDERS).doc(orderId).get()
  return snap.exists ? (snap.data() as any) : null
}

/** Ask MonCash whether the batch's order was paid; mark it paid when it was. */
export async function verifyMonCashBatchPayment(orderId: string): Promise<{ paid: boolean; batchId: string | null; eventId: string | null; reason?: string }> {
  const order = await findBatchOrder(orderId)
  if (!order) return { paid: false, batchId: null, eventId: null, reason: 'order_not_found' }
  const check = await checkMonCashOrder(orderId, Number(order.amount_htg), '[physical]')
  if (!check.paid) return { paid: false, batchId: order.batch_id, eventId: order.event_id, reason: check.reason }
  const res = await markBatchPaid(order.batch_id, {
    funds_rail: 'moncash',
    reference: check.reference,
    amount: check.amount,
    currency: 'HTG',
    extra: { order_id: orderId, amount_verified: check.amountVerified },
  })
  return { paid: res.ok, batchId: order.batch_id, eventId: order.event_id, reason: res.code }
}

/**
 * Start a card payment (Stripe Checkout on the platform account).
 *
 * The USD amount comes from the guarded FX engine with the 'lowest' fallback
 * (lib/platformPay/card.ts). The amount is written into the session's own
 * metadata so each session is verified against what IT asked for; a restart
 * expires the earlier open session so two can never both be paid.
 */
export async function startCardBatchPayment(
  batch: BatchDoc,
  origin: string
): Promise<{ redirectUrl: string; sessionId: string; amountUsdCents: number; rate: number; expiresAt: string }> {
  const { amountUsdCents, htgPerUsd, rateSource } = await cardAmountForHtg(batch.total_htg)
  const previous = String(batch.payment?.stripe_session_id || '')
  const metadata = {
    kind: 'physical_batch',
    batchId: batch.id,
    eventId: batch.event_id,
    organizerId: batch.organizer_id,
    expectedUsdCents: String(amountUsdCents),
    htgTotal: String(batch.total_htg),
    htgPerUsd: String(htgPerUsd),
  }
  const session = await createPlatformCheckout({
    amountUsdCents,
    name: `Printed tickets: ${batch.quantity} × ${batch.tier_name}`,
    description: batch.event_title || null,
    statementNote: `Tikèm printed tickets ${batch.id}`,
    metadata,
    successUrl: batchPageUrl(origin, batch, '&card=return&session_id={CHECKOUT_SESSION_ID}'),
    cancelUrl: batchPageUrl(origin, batch, '&card=cancelled'),
  })
  await adminDb.collection(PHYSICAL_BATCHES).doc(batch.id).update({
    'payment.method': 'card',
    'payment.funds_rail': 'stripe_platform',
    'payment.stripe_session_id': session.sessionId,
    'payment.amount_usd_cents': amountUsdCents,
    'payment.fx_htg_per_usd': htgPerUsd,
    'payment.fx_source': rateSource,
    'payment.session_expires_at': session.expiresAt,
    // Every session this batch ever opened: the expiry sweep asks them all.
    card_session_ids: Array.from(new Set([...(Array.isArray(batch.card_session_ids) ? batch.card_session_ids : []), session.sessionId])),
    updated_at: new Date().toISOString(),
  })
  // Never two live sessions for one batch. The NEW id is saved first, so the
  // old session's checkout.session.expired no longer matches the batch.
  if (previous && previous !== session.sessionId) await expireOpenCheckoutSession(previous, { batchId: batch.id })
  return { redirectUrl: session.redirectUrl, sessionId: session.sessionId, amountUsdCents, rate: htgPerUsd, expiresAt: session.expiresAt }
}

/** Confirm a card payment from its Checkout session (return page, webhook). */
export async function verifyCardBatchPayment(sessionId: string, expectBatchId?: string | null): Promise<{ paid: boolean; batchId: string | null; reason?: string }> {
  const session = await retrieveCheckoutSession(String(sessionId))
  const batchId = String(session?.metadata?.batchId || '')
  if (session?.metadata?.kind !== 'physical_batch' || !batchId) return { paid: false, batchId: null, reason: 'not_a_batch' }
  if (expectBatchId && expectBatchId !== batchId) return { paid: false, batchId, reason: 'batch_mismatch' }
  if (session.payment_status !== 'paid') return { paid: false, batchId, reason: 'not_paid' }
  if (!cardSessionPaidInFull(session)) {
    console.error('[physical] card amount below what the session asked for; NOT marked paid', { batchId, sessionId, paid: session.amount_total })
    return { paid: false, batchId, reason: 'amount_mismatch' }
  }
  const res = await markBatchPaid(batchId, {
    funds_rail: 'stripe_platform',
    reference: String(session.payment_intent || session.id),
    amount: Number(session.amount_total) / 100,
    currency: 'USD',
    extra: { stripe_session_id: session.id },
  })
  return { paid: res.ok, batchId, reason: res.code }
}

/**
 * checkout.session.expired: the organizer never paid. Cancel the batch (seats
 * back) only when it is still waiting AND this is its CURRENT session; an older
 * session expiring after a restart must not cancel the batch.
 */
export async function handleCardSessionExpired(session: { id: string; metadata?: Record<string, any> | null }): Promise<boolean> {
  const batchId = String(session?.metadata?.batchId || '')
  if (session?.metadata?.kind !== 'physical_batch' || !batchId) return false
  const snap = await adminDb.collection(PHYSICAL_BATCHES).doc(batchId).get()
  const b = snap.exists ? snap.data() || {} : null
  if (
    !b ||
    b.status !== 'awaiting_payment' ||
    b.payment?.method !== 'card' ||
    String(b.payment?.stripe_session_id || '') !== String(session.id)
  ) {
    return false
  }
  const r = await cancelUnpaidBatch(batchId, 'system', 'card_session_expired')
  return r.ok
}

/**
 * Ask every card session and MonCash order this batch ever opened whether it
 * was paid. The first hit marks it paid; a second one is flagged needs_refund
 * by markBatchPaid.
 */
export async function batchPaidOnAnyRail(batchId: string, b: Record<string, any>): Promise<boolean> {
  let paid = false
  const sessions = new Set<string>(
    [...(Array.isArray(b.card_session_ids) ? b.card_session_ids : []), b.payment?.stripe_session_id, b.payment?.retired_stripe_session_id]
      .filter(Boolean)
      .map(String)
  )
  for (const sid of Array.from(sessions)) {
    if ((await verifyCardBatchPayment(sid, batchId)).paid) paid = true
  }
  const orders = await adminDb.collection(PHYSICAL_BATCH_ORDERS).where('batch_id', '==', batchId).get()
  const orderIds = new Set<string>([...orders.docs.map((d: any) => String(d.id)), ...(b.payment?.order_id ? [String(b.payment.order_id)] : [])])
  for (const orderId of Array.from(orderIds)) {
    if ((await verifyMonCashBatchPayment(orderId)).paid) paid = true
  }
  return paid
}

/**
 * The sweep (from /api/cron/inventory-sweep): unpaid batches past their
 * payment window are cancelled and their seats given back. Before cancelling,
 * the gateway is asked once more, so a payment that landed but was never
 * confirmed marks the batch paid instead.
 */
export async function expireUnpaidBatches(opts: { now?: number; limit?: number } = {}): Promise<{ checked: number; cancelled: number; paid: number }> {
  const now = opts.now ?? Date.now()
  const snap = await adminDb.collection(PHYSICAL_BATCHES).where('status', '==', 'awaiting_payment').limit(opts.limit ?? 100).get()
  let cancelled = 0
  let paid = 0
  let checked = 0
  for (const doc of snap.docs) {
    const b = doc.data() || {}
    const stamped = Date.parse(String(b.payment_expires_at || ''))
    const expires = Number.isFinite(stamped) ? stamped : Date.parse(String(b.created_at || '')) + PAYMENT_WINDOW_MS
    if (!(expires < now)) continue
    checked++
    try {
      // A balance debit that landed without the batch being marked paid (a
      // crash in between): finish it, never cancel over it.
      const { reconcileOffset } = await import('./balanceOffset')
      const offset = await reconcileOffset(doc.id)
      if (offset === 'finished_paid') {
        paid++
        continue
      }
      // Every rail the batch ever started, not only the current one: a card
      // session paid after switching to MonCash must not be cancelled over.
      if (await batchPaidOnAnyRail(doc.id, b)) {
        paid++
        continue
      }
    } catch (err: any) {
      // Cannot tell whether it was paid: keep the seats held and try next sweep.
      console.warn('[physical] expiry check failed; batch kept', { batchId: doc.id, message: err?.message })
      continue
    }
    const r = await cancelUnpaidBatch(doc.id, 'system', 'payment_window_expired')
    if (r.ok) cancelled++
  }
  return { checked, cancelled, paid }
}
