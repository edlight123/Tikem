import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireAdmin } from '@/lib/auth'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { logAdminAction } from '@/lib/admin/audit-log'
import { cancelEventWithRefunds } from '@/lib/events/cancel'
import { notifyPayoutReviewOutcome } from '@/lib/payouts/review-notice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Resolve one `payout_review_queue/{eventId}` row.
 *
 * A row sitting at `status: 'pending'` is a hard block: /api/cron/release-payouts
 * refuses to release that event's money while it is there, and re-stamps the row
 * on every run. Both actions here move it OFF pending, which is what unblocks the
 * automatic path:
 *
 *   release — an admin has looked and is satisfied. The block is lifted, so the
 *     next release run pays the event as soon as its own rules allow.
 *   dismiss — an admin has looked and does NOT want this paid. The row is closed
 *     so it stops re-appearing, and no money moves.
 *
 * Deliberately NOT a delete: the cron treats a missing row as "never reviewed"
 * and would immediately write a fresh pending one, losing the decision and
 * re-queuing the same event forever. It also treats any non-pending row as an
 * admin's answer and leaves it exactly as written — so the stored status IS the
 * record of who decided what.
 *
 *   reopen — a dismissal was a mistake (or new facts arrived): dismissed →
 *     pending, so it is decided again. Only a DISMISSED row can be reopened; a
 *     released row may already have paid out.
 *   refund_buyers — the documented path for a dismissed event's money: the
 *     event is cancelled through the SAME tooling an admin cancel uses
 *     (lib/events/cancel.ts cancelEventWithRefunds: freeze first, then refund
 *     every buyer from the event's takings; Haiti refunds land in
 *     refund_reviews for an admin to execute). Only on a dismissed row, and a
 *     reason (shown to buyers) is required. The sweep is idempotent, so a
 *     retry resumes it. The row stays dismissed and records the sweep.
 *
 * The organizer is told (in-app, push, email) when a review is released or
 * dismissed, and when buyers are being refunded (lib/payouts/review-notice.ts).
 *
 * This route never talks to Stripe. Money only ever moves inside the release
 * cron, which holds the balance, idempotency and entitlement caps; an admin
 * decision here is an input to that job, not a second payout path.
 */

type Action = 'release' | 'dismiss' | 'reopen' | 'refund_buyers'

const STATUS_FOR: Record<'release' | 'dismiss' | 'reopen', string> = {
  release: 'released',
  dismiss: 'dismissed',
  reopen: 'pending',
}

/** Existing audit action codes — see lib/admin/audit-log.ts. */
const AUDIT_FOR: Record<'release' | 'dismiss' | 'reopen', 'payout.release.manual' | 'payout.release.hold'> = {
  release: 'payout.release.manual',
  dismiss: 'payout.release.hold',
  reopen: 'payout.release.hold',
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { user, error } = await requireAdmin()
    if (error || !user) return adminError('Unauthorized', 401)

    const { eventId } = await params
    if (!eventId) return adminError('Missing event id', 400)

    const body = await request.json().catch(() => ({}))
    const action = String((body as any)?.action || '') as Action
    if (!['release', 'dismiss', 'reopen', 'refund_buyers'].includes(action)) {
      return adminError('Invalid action', 400, "action must be 'release', 'dismiss', 'reopen' or 'refund_buyers'")
    }

    const note = String((body as any)?.note || '').trim().slice(0, 500)

    if (action === 'refund_buyers') {
      return refundBuyersForDismissedEvent({ eventId, note, user })
    }

    const nextStatus = STATUS_FOR[action]
    // reopen moves dismissed → pending; release/dismiss move pending → resolved.
    const requiredStatus = action === 'reopen' ? 'dismissed' : 'pending'
    const ref = adminDb.collection('payout_review_queue').doc(eventId)

    // Transactional so two admins clicking at once cannot both "win" — the loser
    // gets a 409 describing what actually happened instead of a silent overwrite.
    const result = await adminDb.runTransaction(async (transaction: any) => {
      const snap = await transaction.get(ref)
      if (!snap.exists) throw new Error('Review item not found')

      const data = (snap.data() || {}) as any
      const currentStatus = String(data.status || 'pending')

      if (currentStatus === nextStatus) {
        return { idempotent: true, before: data, item: { eventId, ...data } }
      }
      if (currentStatus !== requiredStatus) {
        return { conflict: true, item: { eventId, ...data } }
      }

      const now = new Date().toISOString()
      const patch =
        action === 'reopen'
          ? {
              status: 'pending',
              reopenedAt: now,
              reopenedBy: user.id,
              reopenedByEmail: user.email || '',
              // The previous decision, kept for the record.
              previousResolution: {
                status: currentStatus,
                resolvedAt: data.resolvedAt || null,
                resolvedBy: data.resolvedBy || null,
                note: data.note || null,
              },
              ...(note ? { reopenNote: note } : {}),
              updatedAt: now,
            }
          : {
              status: nextStatus,
              resolution: action,
              resolvedAt: now,
              resolvedBy: user.id,
              resolvedByEmail: user.email || '',
              ...(note ? { note } : {}),
              updatedAt: now,
            }
      transaction.set(ref, patch, { merge: true })

      return { idempotent: false, before: data, item: { eventId, ...data, ...patch } }
    })

    if ((result as any)?.conflict) {
      const status = String((result as any)?.item?.status || 'unknown')
      return adminError(
        'Review item already resolved',
        409,
        `This payout was already ${status}${(result as any)?.item?.resolvedByEmail ? ` by ${(result as any).item.resolvedByEmail}` : ''}.`
      )
    }

    const item = (result as any).item
    const idempotent = Boolean((result as any).idempotent)

    if (!idempotent) {
      logAdminAction({
        action: AUDIT_FOR[action],
        adminId: user.id,
        adminEmail: user.email || 'unknown',
        resourceType: 'payout_review_queue',
        resourceId: eventId,
        details: {
          eventId,
          organizerId: item?.organizerId || null,
          amountMinor: item?.amountMinor ?? null,
          currency: item?.currency || null,
          reason: item?.reason || null,
          tier: item?.tier || null,
          decision: action,
          beforeStatus: (result as any)?.before?.status || 'pending',
          afterStatus: nextStatus,
          note: note || null,
        },
      }).catch(() => {})

      if (action === 'release' || action === 'dismiss') {
        await notifyPayoutReviewOutcome(
          { eventId, organizerId: item?.organizerId || null, resolvedAt: item?.resolvedAt || null },
          action === 'release' ? 'released' : 'dismissed'
        )
      }
    }

    return adminOk({ item, idempotent })
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (message === 'Review item not found') {
      return adminError('Review item not found', 404, message)
    }
    console.error('Error resolving payout review item:', error)
    return NextResponse.json(
      { ok: false, success: false, error: 'Failed to resolve review item', details: message },
      { status: 500 }
    )
  }
}

/**
 * refund_buyers on a DISMISSED review: cancel the event and refund its buyers
 * through the shared cancellation sweep. The money held for a payout that was
 * never approved goes back to the people who paid it.
 */
async function refundBuyersForDismissedEvent(args: {
  eventId: string
  note: string
  user: { id: string; email?: string | null }
}) {
  const { eventId, note, user } = args
  if (!note) {
    return adminError('A reason is required', 400, 'It is shown to the buyers being refunded and kept in the audit log.')
  }
  const ref = adminDb.collection('payout_review_queue').doc(eventId)
  const snap = await ref.get()
  if (!snap.exists) return adminError('Review item not found', 404)
  const data = (snap.data() || {}) as any
  if (String(data.status || 'pending') !== 'dismissed') {
    return adminError(
      'Only a dismissed review can refund buyers',
      409,
      `This payout review is ${String(data.status || 'pending')}. Dismiss it first.`
    )
  }

  const outcome = await cancelEventWithRefunds({
    eventId,
    actor: { id: user.id, email: user.email || null, isAdmin: true },
    reason: note,
  })
  const now = new Date().toISOString()
  await ref.set(
    {
      buyerRefund: {
        requestedAt: data.buyerRefund?.requestedAt || now,
        requestedBy: data.buyerRefund?.requestedBy || user.id,
        lastRunAt: now,
        lastRunBy: user.id,
        reason: note,
        ticketsAffected: outcome.ticketsAffected,
        refundsSucceeded: outcome.refundsSucceeded,
        refundsQueuedManual: outcome.refundsQueuedManual,
        refundsSentToReview: outcome.refundsSentToReview,
        refundsFailed: outcome.refundsFailed,
        ledgerStampFailed: outcome.ledgerStampFailed || null,
      },
      updatedAt: now,
    },
    { merge: true }
  )

  logAdminAction({
    action: 'event.cancel',
    adminId: user.id,
    adminEmail: user.email || 'unknown',
    resourceType: 'event',
    resourceId: eventId,
    details: {
      via: 'payout_review_refund_buyers',
      reason: note,
      organizerId: data.organizerId || null,
      ticketsAffected: outcome.ticketsAffected,
      refundsSucceeded: outcome.refundsSucceeded,
      refundsQueuedManual: outcome.refundsQueuedManual,
      refundsFailed: outcome.refundsFailed,
    },
  }).catch(() => {})

  if (!outcome.alreadyCancelled) {
    await notifyPayoutReviewOutcome(
      { eventId, organizerId: data.organizerId || null, resolvedAt: data.buyerRefund?.requestedAt || now },
      'refunding_buyers'
    )
  }

  if (outcome.ledgerStampFailed) {
    return adminError(
      'Refunds ran, but recording the cancellation on the payout ledger failed',
      500,
      'Retry refund_buyers: the sweep is resumable.'
    )
  }
  return adminOk({ outcome })
}
