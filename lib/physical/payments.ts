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
 * Every confirmation path ends in markBatchPaid, which is idempotent.
 */

import crypto from 'node:crypto'
import { adminDb } from '@/lib/firebase/admin'
import { createMonCashButtonCheckoutToken, getMonCashButtonRedirectUrl, isMonCashButtonPaidAmountAcceptable } from '@/lib/moncash-button'
import { retrieveMonCashOrderPayment } from '@/lib/moncash'
import { PHYSICAL_BATCH_ORDERS, cancelUnpaidBatch, markBatchPaid, type BatchDoc } from './batches'
import { PAYMENT_WINDOW_MS, PHYSICAL_BATCHES } from './rules'

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured')
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

/**
 * USD cents for an HTG amount at an HTG-per-USD rate (Stripe has no HTG).
 * Rounded UP, so the platform is never short; 50¢ is Stripe's floor.
 */
export function htgToUsdCentsAtHtgPerUsd(htg: number, htgPerUsd: number): number {
  if (!Number.isFinite(htg) || !Number.isFinite(htgPerUsd) || htgPerUsd <= 0 || htg <= 0) throw new Error('Invalid amount or rate')
  return Math.max(50, Math.ceil((htg / htgPerUsd) * 100 - 1e-9))
}

export function batchPageUrl(origin: string, batch: { id: string; event_id: string }, extra = ''): string {
  return `${origin}/organizer/events/${encodeURIComponent(batch.event_id)}/printed?batch=${encodeURIComponent(batch.id)}${extra}`
}

/** Expire a Checkout session if it is still open. Never throws. */
async function expireOpenSession(sessionId: string, batchId: string): Promise<void> {
  if (!sessionId || !process.env.STRIPE_SECRET_KEY) return
  try {
    const stripe = getStripe()
    const old = await stripe.checkout.sessions.retrieve(sessionId)
    if (old?.status === 'open') await stripe.checkout.sessions.expire(sessionId)
  } catch (err: any) {
    console.warn('[physical] could not expire a card session', { batchId, message: err?.message })
  }
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
  await expireOpenSession(sessionId, batch.id)
}

/** Start a MonCash payment; returns the gateway URL to send the organizer to. */
export async function startMonCashBatchPayment(batch: BatchDoc): Promise<{ redirectUrl: string; orderId: string }> {
  // Same numeric order id shape as the ticket checkout (Digicel expects digits).
  const orderId = `${crypto.randomInt(1_000_000, 10_000_000)}${String(crypto.randomInt(0, 100_000_000)).padStart(8, '0')}`
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
  const { token } = await createMonCashButtonCheckoutToken({ amount: batch.total_htg, orderId })
  return { redirectUrl: getMonCashButtonRedirectUrl(token), orderId }
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
  const payment = await retrieveMonCashOrderPayment(orderId)
  if (!payment?.success) return { paid: false, batchId: order.batch_id, eventId: order.event_id, reason: String(payment?.payment_status || 'not_paid') }
  const amount = isMonCashButtonPaidAmountAcceptable(Number(order.amount_htg), payment.cost)
  if (amount.verified && !amount.ok) {
    console.error('[physical] MonCash amount mismatch; batch NOT marked paid', { orderId, expected: amount.expected, paid: amount.paid })
    return { paid: false, batchId: order.batch_id, eventId: order.event_id, reason: 'amount_mismatch' }
  }
  const res = await markBatchPaid(order.batch_id, {
    funds_rail: 'moncash',
    reference: payment.transactionId || orderId,
    amount: Number(payment.cost ?? order.amount_htg),
    currency: 'HTG',
    extra: { order_id: orderId, amount_verified: amount.verified },
  })
  return { paid: res.ok, batchId: order.batch_id, eventId: order.event_id, reason: res.code }
}

/** Thrown when no trustworthy USD/HTG rate exists: card is refused, MonCash still works. */
export class CardFxUnavailableError extends Error {
  code = 'fx_unavailable'
  constructor() {
    super('No reliable USD to HTG rate right now. Pay with MonCash, or try card later.')
  }
}

/** Stripe's minimum Checkout lifetime is 30 minutes; a little more for clock skew. */
export const CARD_SESSION_TTL_SECONDS = 31 * 60

/**
 * Start a card payment (Stripe Checkout on the platform account).
 *
 * The USD amount comes from the guarded FX engine (lib/fx/usd-htg.ts) with the
 * 'lowest' fallback: charging USD for an HTG price, a lower HTG-per-USD rate
 * means MORE dollars, never fewer. No rate → refused (never a hard-coded one).
 * The amount is written into the session's own metadata so each session is
 * verified against what IT asked for; a restart expires the earlier open
 * session so two can never both be paid.
 */
export async function startCardBatchPayment(
  batch: BatchDoc,
  origin: string
): Promise<{ redirectUrl: string; sessionId: string; amountUsdCents: number; rate: number; expiresAt: string }> {
  const { getUsdToHtgBaseRate, isFxRateUnavailableError } = await import('@/lib/fx/usd-htg')
  let htgPerUsd: number
  let rateSource: string
  try {
    const r = await getUsdToHtgBaseRate({ fallback: 'lowest' })
    htgPerUsd = r.baseRate
    rateSource = r.source
  } catch (e) {
    if (isFxRateUnavailableError(e)) throw new CardFxUnavailableError()
    throw e
  }
  if (!Number.isFinite(htgPerUsd) || htgPerUsd <= 0) throw new CardFxUnavailableError()
  const amountUsdCents = htgToUsdCentsAtHtgPerUsd(batch.total_htg, htgPerUsd)
  const stripe = getStripe()

  const previous = String(batch.payment?.stripe_session_id || '')

  const expiresAtSec = Math.floor(Date.now() / 1000) + CARD_SESSION_TTL_SECONDS
  const metadata = {
    kind: 'physical_batch',
    batchId: batch.id,
    eventId: batch.event_id,
    organizerId: batch.organizer_id,
    expectedUsdCents: String(amountUsdCents),
    htgTotal: String(batch.total_htg),
    htgPerUsd: String(htgPerUsd),
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    expires_at: expiresAtSec,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: amountUsdCents,
          product_data: { name: `Printed tickets: ${batch.quantity} × ${batch.tier_name}`, description: batch.event_title || undefined },
        },
      },
    ],
    metadata,
    payment_intent_data: { metadata, description: `Tikèm printed tickets ${batch.id}` },
    success_url: batchPageUrl(origin, batch, '&card=return&session_id={CHECKOUT_SESSION_ID}'),
    cancel_url: batchPageUrl(origin, batch, '&card=cancelled'),
  })
  const expiresAt = new Date(expiresAtSec * 1000).toISOString()
  await adminDb.collection(PHYSICAL_BATCHES).doc(batch.id).update({
    'payment.method': 'card',
    'payment.funds_rail': 'stripe_platform',
    'payment.stripe_session_id': session.id,
    'payment.amount_usd_cents': amountUsdCents,
    'payment.fx_htg_per_usd': htgPerUsd,
    'payment.fx_source': rateSource,
    'payment.session_expires_at': expiresAt,
    updated_at: new Date().toISOString(),
  })
  // Never two live sessions for one batch. The NEW id is saved first, so the
  // old session's checkout.session.expired no longer matches the batch.
  if (previous && previous !== session.id) await expireOpenSession(previous, batch.id)
  return { redirectUrl: String(session.url), sessionId: session.id, amountUsdCents, rate: htgPerUsd, expiresAt }
}

/** Pure: is this Checkout session paid in full for what IT asked for? */
export function cardSessionPaidInFull(session: { payment_status?: string; amount_total?: number | null; currency?: string | null; metadata?: Record<string, any> | null }): boolean {
  if (session?.payment_status !== 'paid') return false
  const expected = Number(session?.metadata?.expectedUsdCents)
  if (!Number.isFinite(expected) || expected <= 0) return false
  if (String(session?.currency || 'usd').toLowerCase() !== 'usd') return false
  return Number(session?.amount_total) >= expected
}

/** Confirm a card payment from its Checkout session (return page, webhook). */
export async function verifyCardBatchPayment(sessionId: string, expectBatchId?: string | null): Promise<{ paid: boolean; batchId: string | null; reason?: string }> {
  const stripe = getStripe()
  const session = await stripe.checkout.sessions.retrieve(String(sessionId))
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
      if (b.payment?.method === 'card' && b.payment?.stripe_session_id) {
        const r = await verifyCardBatchPayment(String(b.payment.stripe_session_id), doc.id)
        if (r.paid) {
          paid++
          continue
        }
      } else if (b.payment?.order_id) {
        const r = await verifyMonCashBatchPayment(String(b.payment.order_id))
        if (r.paid) {
          paid++
          continue
        }
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
