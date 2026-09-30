import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createClient } from '@/lib/firebase-db/server'
import { retrieveMonCashOrderPayment } from '@/lib/moncash'
import { isMonCashButtonPaidAmountAcceptable } from '@/lib/moncash-button'
import { fulfillPaidOrder } from '@/lib/tickets/fulfillment'

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

/**
 * The gateway payment token lives ten minutes. Wait past that before touching an
 * order, so we can never race a buyer who is still staring at the OTP screen.
 */
const SETTLE_GRACE_MS = 12 * 60 * 1000

/** Past this the gateway no longer knows the order; stop asking. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Bound the work per run — each order costs one round trip to Digicel. */
const MAX_ORDERS_PER_RUN = 40

const LOG = '[moncash_reconcile]'

/** Only the MonCash REST rail. NatCash settles through the button middleware. */
function monCashMethod(tx: Record<string, any>): 'moncash' | 'moncash_button' | null {
  const provider = String(tx?.mobile_money_provider || '').toLowerCase()
  if (provider === 'natcash') return null

  const method = String(tx?.payment_method || provider || '').toLowerCase()
  if (method === 'moncash') return 'moncash'
  if (method === 'moncash_button') return 'moncash_button'
  return null
}

function createdAtMs(tx: Record<string, any>): number {
  const raw = tx?.created_at
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (raw && typeof raw.toDate === 'function') return raw.toDate().getTime()
  if (typeof raw === 'number') return raw
  return 0
}

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
    .eq('status', 'pending')

  if (error) {
    console.error(`${LOG} could not read pending transactions`, error)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  const now = Date.now()
  // Deliberately filtered and sorted in memory: `created_at` is not a reliable
  // orderBy field across this collection, and an index-driven sort silently drops
  // the rows that spell it differently.
  const candidates = (pending || [])
    .filter((tx: any) => {
      if (!tx?.order_id) return false
      if (!monCashMethod(tx)) return false
      const age = now - createdAtMs(tx)
      return age >= SETTLE_GRACE_MS && age <= MAX_AGE_MS
    })
    .sort((a: any, b: any) => createdAtMs(a) - createdAtMs(b))
    .slice(0, MAX_ORDERS_PER_RUN)

  const summary = {
    examined: candidates.length,
    fulfilled: 0,
    alreadyCompleted: 0,
    markedFailed: 0,
    amountMismatch: 0,
    capacityExceeded: 0,
    unreachable: 0,
  }

  for (const tx of candidates) {
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
      summary.markedFailed += 1
      console.info(`${LOG} order did not settle`, { orderId, reason: payment.payment_status })
      await supabase
        .from('pending_transactions')
        .update({
          status: 'failed',
          // Digicel's own words, so the next person to look does not have to
          // reproduce the call by hand to find out why.
          failure_reason: payment.payment_status || 'payment_failed',
          reconciled_at: new Date().toISOString(),
        })
        .eq('order_id', orderId)
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

    const result = await fulfillPaidOrder({
      orderId,
      paymentMethod: monCashMethod(tx) || 'moncash',
      transactionId: payment.transactionId || null,
      payer: payment.payer || null,
      logPrefix: LOG,
    })

    if (result.outcome === 'fulfilled') {
      summary.fulfilled += 1
      console.info(`${LOG} recovered a paid order the buyer never returned from`, {
        orderId,
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
