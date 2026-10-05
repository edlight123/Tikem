import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createClient } from '@/lib/firebase-db/server'
import { retrieveMonCashOrderPayment } from '@/lib/moncash'
import { isMonCashButtonPaidAmountAcceptable } from '@/lib/moncash-button'
import { fulfillPaidOrder } from '@/lib/tickets/fulfillment'
import { monCashMethod, selectReconcileCandidates } from '@/lib/moncash-reconcile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * MonCash reconciliation.
 *
 * Ticket issuance used to live ONLY in the browser return handler, so a buyer who
 * paid and then closed the tab — or lost signal on a Haitian mobile connection —
 * left money taken and no ticket, with nothing to recover it. This asks Digicel
 * directly what happened to every stale pending order and finishes the job
 * server-side.
 *
 * It is also where a failed payment finally gets recorded AS failed, carrying
 * Digicel's own reason, instead of sitting `pending` forever.
 */

/** Bound the work per run — each order costs one round trip to Digicel. */
const MAX_ORDERS_PER_RUN = 40

const LOG = '[moncash_reconcile]'

export async function GET() {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error(`${LOG} CRON_SECRET not configured`)
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
  }
  if ((await headers()).get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()
  const { data: pending, error } = await supabase
    .from('pending_transactions')
    .select('*')
    .in('status', ['pending', 'failed', 'processing'])

  if (error) {
    console.error(`${LOG} could not read pending transactions`, error)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  const now = Date.now()
  // Deliberately filtered and sorted in memory: `created_at` is not a reliable
  // orderBy field across this collection, and an index-driven sort silently drops
  // the rows that spell it differently.
  const candidates = selectReconcileCandidates(pending || [], now).slice(0, MAX_ORDERS_PER_RUN)

  const summary = {
    examined: candidates.length,
    fulfilled: 0,
    alreadyCompleted: 0,
    markedFailed: 0,
    amountMismatch: 0,
    capacityExceeded: 0,
    unreachable: 0,
    stillNotPaid: 0,
    recoveredFromFailed: 0,
    recoveredFromProcessing: 0,
    needsReview: 0,
  }

  for (const { tx, kind } of candidates) {
    const orderId = String(tx.order_id)

    let payment
    try {
      payment = await retrieveMonCashOrderPayment(orderId)
    } catch (err: any) {
      // No answer from Digicel (401/5xx/network). Leave the order pending and
      // retry next run — an outage must never be recorded as a failed payment.
      summary.unreachable += 1
      console.warn(`${LOG} gateway unreachable; leaving pending`, {
        orderId,
        message: err?.message,
      })
      continue
    }

    if (!payment.success) {
      if (kind === 'pending') {
        summary.markedFailed += 1
        console.info(`${LOG} order did not settle`, { orderId, reason: payment.payment_status })
        await supabase
          .from('pending_transactions')
          .update({
            status: 'failed',
            // Digicel's own words, so the next person to look does not have to
            // reproduce the call by hand to find out why.
            failure_reason: payment.payment_status || 'payment_failed',
            failure_source: 'gateway_not_paid',
            reconciled_at: new Date().toISOString(),
          })
          .eq('order_id', orderId)
          .eq('status', 'pending')
      } else if (kind === 'failed') {
        // Still not paid: count the re-check so the order ages out of the sweep.
        summary.stillNotPaid += 1
        await supabase
          .from('pending_transactions')
          .update({
            reconcile_attempts: Number(tx.reconcile_attempts || 0) + 1,
            reconciled_at: new Date().toISOString(),
          })
          .eq('order_id', orderId)
          .eq('status', 'failed')
      } else {
        // A processing claim whose gateway now says "not paid" is an anomaly, not
        // something to decide automatically. Leave it for a human.
        console.error(`${LOG} stale processing order reports not paid; leaving for review`, {
          orderId,
          reason: payment.payment_status,
        })
      }
      continue
    }

    // Paid. Same defence-in-depth as the return handler: refuse to issue tickets
    // if Digicel reports collecting a materially different amount.
    const amountCheck = isMonCashButtonPaidAmountAcceptable(Number(tx.amount), payment.cost)
    if (amountCheck.verified && !amountCheck.ok) {
      summary.amountMismatch += 1
      console.error(`${LOG} amount mismatch — refusing fulfillment`, {
        orderId,
        expected: amountCheck.expected,
        paid: amountCheck.paid,
      })
      await supabase
        .from('pending_transactions')
        .update({
          status: 'failed',
          failure_reason: 'amount_mismatch',
          needs_refund: true,
          reconciled_at: new Date().toISOString(),
        })
        .eq('order_id', orderId)
      continue
    }

    // An abandoned `processing` claim may have died AFTER issuing some tickets.
    // Re-running fulfilment would issue a second full set, so if any ticket already
    // carries this payment, leave the order for a human instead.
    if (kind === 'processing') {
      const paymentIds = Array.from(new Set([orderId, payment.transactionId].filter(Boolean))) as string[]
      let alreadyIssued = false
      for (const pid of paymentIds) {
        const { data: issued } = await supabase.from('tickets').select('id').eq('payment_id', pid).limit(1)
        if (Array.isArray(issued) && issued.length > 0) alreadyIssued = true
      }
      if (alreadyIssued) {
        summary.needsReview += 1
        console.error(`${LOG} stale processing order already has tickets; needs manual review`, { orderId })
        await supabase
          .from('pending_transactions')
          .update({ needs_review: true, reconciled_at: new Date().toISOString() })
          .eq('order_id', orderId)
        continue
      }
    }

    const result = await fulfillPaidOrder({
      orderId,
      paymentMethod: monCashMethod(tx) || 'moncash',
      transactionId: payment.transactionId || null,
      payer: payment.payer || null,
      logPrefix: LOG,
    })

    if (result.outcome === 'fulfilled') {
      summary.fulfilled += 1
      if (kind === 'failed') summary.recoveredFromFailed += 1
      if (kind === 'processing') summary.recoveredFromProcessing += 1
      console.info(`${LOG} recovered a paid order the buyer never returned from`, {
        orderId,
        kind,
        ticketId: result.ticketId,
      })
    } else if (result.outcome === 'already_completed') {
      summary.alreadyCompleted += 1
    } else if (result.outcome === 'capacity_exceeded') {
      summary.capacityExceeded += 1
      console.error(`${LOG} paid but sold out — order flagged for refund`, { orderId })
    } else {
      console.warn(`${LOG} fulfillment did not complete`, { orderId, outcome: result.outcome })
    }
  }

  console.info(`${LOG} run complete`, summary)
  return NextResponse.json({ ok: true, ...summary })
}
