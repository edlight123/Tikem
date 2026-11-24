/**
 * Paying for a printed batch, upfront, on Tikèm's own rails:
 *   - MonCash: the existing MonCash Button flow (createMonCashButtonCheckoutToken
 *     → redirect → /api/moncash-button/return, verified with
 *     retrieveMonCashOrderPayment). funds_rail 'moncash'.
 *   - Card: a Stripe Checkout session on the PLATFORM account (no Connect
 *     destination: this is Tikèm's revenue), HTG converted to USD at Stripe's
 *     rate like /api/create-payment-intent. funds_rail 'stripe_platform'.
 *
 * Every confirmation path ends in markBatchPaid, which is idempotent.
 */

import crypto from 'node:crypto'
import { adminDb } from '@/lib/firebase/admin'
import { createMonCashButtonCheckoutToken, getMonCashButtonRedirectUrl, isMonCashButtonPaidAmountAcceptable } from '@/lib/moncash-button'
import { retrieveMonCashOrderPayment } from '@/lib/moncash'
import { PHYSICAL_BATCH_ORDERS, markBatchPaid, type BatchDoc } from './batches'
import { PHYSICAL_BATCHES } from './rules'

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured')
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

/** USD cents for an HTG amount at a USD-per-HTG rate (Stripe has no HTG). */
export function htgToUsdCents(htg: number, usdPerHtg: number): number {
  if (!Number.isFinite(htg) || !Number.isFinite(usdPerHtg) || usdPerHtg <= 0) throw new Error('Invalid amount or rate')
  return Math.max(50, Math.round(htg * usdPerHtg * 100))
}

export function batchPageUrl(origin: string, batch: { id: string; event_id: string }, extra = ''): string {
  return `${origin}/organizer/events/${encodeURIComponent(batch.event_id)}/printed?batch=${encodeURIComponent(batch.id)}${extra}`
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

/** Start a card payment (Stripe Checkout on the platform account). */
export async function startCardBatchPayment(batch: BatchDoc, origin: string): Promise<{ redirectUrl: string; sessionId: string; amountUsdCents: number; rate: number }> {
  const { fetchStripeHTGRate } = await import('@/lib/currency')
  const rate = await fetchStripeHTGRate()
  const amountUsdCents = htgToUsdCents(batch.total_htg, rate)
  const stripe = getStripe()
  const metadata = { kind: 'physical_batch', batchId: batch.id, eventId: batch.event_id, organizerId: batch.organizer_id }
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
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
  await adminDb.collection(PHYSICAL_BATCHES).doc(batch.id).update({
    'payment.method': 'card',
    'payment.funds_rail': 'stripe_platform',
    'payment.stripe_session_id': session.id,
    'payment.amount_usd_cents': amountUsdCents,
    'payment.fx_usd_per_htg': rate,
    updated_at: new Date().toISOString(),
  })
  return { redirectUrl: String(session.url), sessionId: session.id, amountUsdCents, rate }
}

/** Confirm a card payment from its Checkout session (return page, webhook). */
export async function verifyCardBatchPayment(sessionId: string, expectBatchId?: string | null): Promise<{ paid: boolean; batchId: string | null; reason?: string }> {
  const stripe = getStripe()
  const session = await stripe.checkout.sessions.retrieve(String(sessionId))
  const batchId = String(session?.metadata?.batchId || '')
  if (session?.metadata?.kind !== 'physical_batch' || !batchId) return { paid: false, batchId: null, reason: 'not_a_batch' }
  if (expectBatchId && expectBatchId !== batchId) return { paid: false, batchId, reason: 'batch_mismatch' }
  if (session.payment_status !== 'paid') return { paid: false, batchId, reason: 'not_paid' }
  const snap = await adminDb.collection(PHYSICAL_BATCHES).doc(batchId).get()
  const expected = Number(snap.data()?.payment?.amount_usd_cents)
  if (Number.isFinite(expected) && expected > 0 && Number(session.amount_total) < expected) {
    console.error('[physical] card amount below the batch price; NOT marked paid', { batchId, expected, paid: session.amount_total })
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
