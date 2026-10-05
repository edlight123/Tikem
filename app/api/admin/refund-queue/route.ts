import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminError, adminOk } from '@/lib/api/admin-response'
import {
  listReconciliation,
  listRefundQueue,
  listStripeOrderFlags,
  resolveReconciliation,
  resolveStripeOrderFlag,
  resolveRefundQueueItem,
  RefundQueueError,
  type RefundQueueKind,
} from '@/lib/tickets/manualRefundQueue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Manual refunds — the queue behind /admin/money/refunds.
 *
 * GET  lists mobile-money ticket refunds (manual_refund_queue) and paid-but-
 *      unhonored MonCash/SogePay orders (pending_transactions.needs_refund).
 *      Also lists open refund_reconciliation records: card refunds Stripe
 *      accepted whose result could not be written to the ticket.
 * POST { kind: 'ticket' | 'order', id, action: 'paid' | 'failed', note? }
 *      records that an admin paid the buyer by hand (or could not).
 *      And stripe_orders flagged needs_refund / needs_reconcile /
 *      refund_unallocated_cents > 0 (lib/tickets/stripe-fulfillment.ts).
 * POST { kind: 'stripe_order', id: orderDocId, action: 'resolved', note? }
 *      records that an admin handled a flagged Stripe order.
 * POST { kind: 'reconciliation', id: ticketId, action: 'resolved', note? }
 *      closes a reconciliation record (and finishes the ticket if still claimed).
 *
 * Nothing here moves money: the payout happens outside Tikèm (MonCash
 * merchant app, bank transfer). This only records it.
 */

export async function GET() {
  try {
    const { user, error } = await requireAdmin()
    if (error || !user) return adminError('Unauthorized', 401)
    const [queue, reconciliation, stripeOrders] = await Promise.all([
      listRefundQueue(),
      listReconciliation(),
      listStripeOrderFlags(),
    ])
    return adminOk({
      ...queue,
      reconciliation,
      stripeOrders,
      counts: {
        open: queue.open.length,
        failed: queue.failed.length,
        resolved: queue.resolved.length,
        reconciliation: reconciliation.length,
        stripeOrders: stripeOrders.length,
      },
    })
  } catch (err: any) {
    console.error('[admin/refund-queue] list failed', err)
    return adminError('Failed to load the refund queue', 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAdmin()
    if (error || !user) return adminError('Unauthorized', 401)

    const body = await request.json().catch(() => ({}))
    const id = String(body?.id || '').trim()
    const action = String(body?.action || '')
    const note = typeof body?.note === 'string' ? body.note : null

    if (body?.kind === 'reconciliation') {
      if (action !== 'resolved') return adminError('Invalid action', 400)
      const res = await resolveReconciliation({ ticketId: id, actorId: String(user.id), note })
      return adminOk({ status: 'resolved', appliedToTicket: res.appliedToTicket })
    }

    if (body?.kind === 'stripe_order') {
      if (action !== 'resolved') return adminError('Invalid action', 400)
      await resolveStripeOrderFlag({ paymentId: id, actorId: String(user.id), note })
      return adminOk({ status: 'resolved' })
    }

    const kind = String(body?.kind || '') as RefundQueueKind
    if (kind !== 'ticket' && kind !== 'order') return adminError('Invalid item kind', 400)
    if (action !== 'paid' && action !== 'failed') return adminError('Invalid action', 400)

    const res = await resolveRefundQueueItem({
      kind,
      id,
      action,
      actorId: String(user.id),
      note,
    })
    return adminOk({ status: res.status })
  } catch (err: any) {
    if (err instanceof RefundQueueError) return adminError(err.message, err.status)
    console.error('[admin/refund-queue] resolve failed', err)
    return adminError('Failed to update the refund', 500)
  }
}
