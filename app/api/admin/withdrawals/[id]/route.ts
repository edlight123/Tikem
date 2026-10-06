import { NextRequest, NextResponse } from 'next/server'
import { isPayeeReasonCode, resolvePayeeReason } from '@/lib/payouts/payee-reasons'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { findEventEarningsDocInTransaction } from '@/lib/earnings'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { logAdminAction } from '@/lib/admin/audit-log'
import { notifyWithdrawalOutcome, type WithdrawalOutcome } from '@/lib/notifications/withdrawal-outcome'
import { moncashPrefundedTransactionStatus } from '@/lib/moncash'
import {
  finalizeWithdrawalCompleted,
  isPrefundedInFlight,
  releaseWithdrawalReservation,
} from '@/lib/payouts/withdrawal-finalize'
import { classifyStatusCheck, RECONCILE_RELEASE_GRACE_MS, toMillis } from '@/lib/payouts/withdrawal-reconcile'
import { reviewWithdrawalDestination } from '@/lib/firestore/payout'

export async function POST(req: NextRequest) {
  try {
    const { user, error } = await requireAdmin()
    if (error || !user) {
      return adminError('Unauthorized', 401)
    }

    const body = await req.json()
    const { withdrawalId, action } = body
    // Two separate things, never mixed:
    //  - internalNote: admins only (legacy `note` lands here, so an old client
    //    can never leak an internal comment to the payee);
    //  - payeeReasonCode/payeeReasonText: what the payee is told on reject/fail.
    const internalNote: string | null =
      typeof body.internalNote === 'string' && body.internalNote.trim()
        ? body.internalNote.trim()
        : typeof body.note === 'string' && body.note.trim()
          ? body.note.trim()
          : null
    const payeeReasonCode = isPayeeReasonCode(body.payeeReasonCode) ? body.payeeReasonCode : null
    const payeeReasonText =
      typeof body.payeeReasonText === 'string' && body.payeeReasonText.trim() ? body.payeeReasonText.trim().slice(0, 500) : null
    if (payeeReasonCode === 'other' && !payeeReasonText) {
      return adminError('Write the message the payee will see, or pick a preset reason', 400)
    }
    // Stored in English for the payout history; notifications localize from the code.
    const payeeReasonEn = resolvePayeeReason(payeeReasonCode, payeeReasonText, 'en')

    if (!withdrawalId || !action) {
      return adminError('Missing withdrawalId or action', 400)
    }

    if (!['approve', 'reject', 'complete', 'fail'].includes(action)) {
      return adminError('Invalid action. Must be: approve, reject, complete, or fail', 400)
    }

    const withdrawalRef = adminDb.collection('withdrawal_requests').doc(String(withdrawalId))

    // Pre-read for the checks that need the network (MonCash, the payee's
    // profile); the transaction below re-reads and re-checks the status.
    const preSnap = await withdrawalRef.get()
    if (!preSnap.exists) {
      return adminError('Withdrawal not found', 404)
    }
    const pre = preSnap.data() as any

    // Nobody releases, approves or fails money paid to their own account.
    if (String(pre?.organizerId || '') === user.id || String(pre?.promoter_uid || '') === user.id) {
      return adminError('You cannot act on a withdrawal paid to your own account. Ask another admin.', 403)
    }

    // A MonCash number that is not the payee's saved destination is not paid
    // without an explicit, logged override.
    if (action === 'approve' || action === 'complete') {
      const destinationReview = await reviewWithdrawalDestination(pre)
      if (destinationReview === 'mismatch' && body.overrideDestinationMismatch !== true) {
        return adminError(
          "This MonCash number is not the payee's saved payout number",
          409,
          'Check with the payee, then retry with overrideDestinationMismatch: true if it is correct.'
        )
      }
    }

    // An instant (prefunded) withdrawal still 'processing' may already have been
    // paid by MonCash: failing it would hand the reservation back on top of the
    // transfer. It is failed only once MonCash says it was not paid.
    if (action === 'fail' && isPrefundedInFlight(pre)) {
      if (body.confirmNotPaid !== true) {
        return adminError(
          'This instant MonCash withdrawal may already have been paid',
          409,
          'Check the transfer in MonCash, then retry with confirmNotPaid: true. Tikèm also asks MonCash before releasing.'
        )
      }
      let verdict: ReturnType<typeof classifyStatusCheck>
      try {
        const status = await moncashPrefundedTransactionStatus(String(withdrawalId))
        verdict = classifyStatusCheck({ raw: status.raw })
      } catch (err) {
        verdict = classifyStatusCheck({ error: err })
      }
      if (verdict.verdict === 'successful') {
        await finalizeWithdrawalCompleted(String(withdrawalId), {
          transactionId: verdict.transactionId,
          confirmedVia: 'admin_status_check',
          statusRaw: verdict.raw,
        })
        return adminError('MonCash reports this transfer as paid', 409, 'It was marked completed instead of failed.')
      }
      if (verdict.verdict === 'ambiguous') {
        return adminError('MonCash could not confirm this transfer either way', 409, verdict.detail)
      }
      const attemptedAt = toMillis(pre?.reservedAt) ?? toMillis(pre?.createdAt) ?? Date.now()
      if (verdict.verdict === 'not_found' && Date.now() - attemptedAt < RECONCILE_RELEASE_GRACE_MS) {
        return adminError(
          'MonCash does not know this transfer yet',
          409,
          'A slow transfer can take a while to appear. Try again in 30 minutes.'
        )
      }
      const now = new Date()
      const released = await releaseWithdrawalReservation(String(withdrawalId), {
        reason: payeeReasonEn || 'The payout could not be completed.',
        releasedBy: `admin:${user.id}`,
        now,
        extra: {
          payeeReasonCode,
          payeeReasonText,
          ...(internalNote ? { adminNote: internalNote } : {}),
          processedBy: user.id,
          processedAt: now,
          reconciledAt: now,
          adminStatusCheck: verdict.verdict,
        },
      })
      if (released.changed) {
        logAdminAction({
          action: 'withdrawal.fail',
          adminId: user.id,
          adminEmail: user.email || 'unknown',
          resourceType: 'withdrawal',
          resourceId: String(withdrawalId),
          details: { withdrawalId, internalNote, payeeReasonCode, payeeReasonText, statusCheck: verdict.verdict },
        }).catch(() => {})
        await notifyWithdrawalOutcome(String(withdrawalId), 'failed', {
          row: released.row,
          reasonCode: payeeReasonCode,
          reasonText: payeeReasonText,
        })
      }
      return adminOk({ message: 'Withdrawal marked failed; reservation released', idempotent: !released.changed })
    }

    const normalizeAmountToCents = (raw: any): number => {
      const n = Number(raw)
      if (!Number.isFinite(n)) return 0
      if (!Number.isInteger(n)) return Math.round(n * 100)
      if (n > 0 && n < 5000) return n * 100
      return n
    }

    const txResult = await adminDb.runTransaction(async (tx: any) => {
      const withdrawalSnap = await tx.get(withdrawalRef)
      if (!withdrawalSnap.exists) {
        return { notFound: true }
      }

      const withdrawal = withdrawalSnap.data() as any
      const beforeStatus = String(withdrawal.status || '')
      const now = new Date()

      const updates: any = { updatedAt: now }

      const setFailedWithRefund = async (reason: string) => {
        updates.status = 'failed'
        updates.failureReason = reason
        updates.payeeReasonCode = payeeReasonCode
        updates.payeeReasonText = payeeReasonText
        if (internalNote) updates.adminNote = internalNote
        updates.processedBy = user.id
        updates.processedAt = now
        // Same guard fields the reconcile cron writes (lib/payouts/withdrawal-finalize.ts).
        updates.reservationReleasedAt = now
        updates.reservationReleasedBy = `admin:${user.id}`
        if (withdrawal.needsReconciliation) {
          updates.needsReconciliation = false
          updates.reconciledAt = now
        }

        // Promoter withdrawals debit a promoter wallet, not event_earnings —
        // credit back exactly the per-currency debits the request recorded.
        if (withdrawal.payee_type === 'promoter') {
          const debits = (withdrawal.walletDebits || {}) as Record<string, number>
          const walletRef = adminDb
            .collection('promoter_wallets')
            .doc(String(withdrawal.promoter_uid || withdrawal.organizerId))
          const walletSnap = await tx.get(walletRef)
          const stored = walletSnap.exists ? (walletSnap.data() as any)?.withdrawn_by_currency || {} : {}
          const next: Record<string, number> = { ...stored }
          for (const [currency, cents] of Object.entries(debits)) {
            next[currency] = Math.max(0, (Number(stored[currency]) || 0) - Math.max(0, Number(cents) || 0))
          }
          tx.set(
            walletRef,
            { withdrawn_by_currency: next, updated_at: now.toISOString() },
            { merge: true }
          )
          return
        }

        // Credit back ONLY a request that was actually debited: every live path
        // files the request in the debit's transaction and stamps reservedAt /
        // reservedCents. A request without them reserved nothing, and crediting
        // it would hand the organizer money twice.
        const reserved = Number(withdrawal.reservedCents)
        if (!withdrawal.reservedAt || !Number.isFinite(reserved) || reserved <= 0) {
          updates.creditBackSkipped = 'no_reservation_recorded'
          return
        }
        const amountInCents = Math.round(reserved)
        // Same three-way lookup the read path uses — legacy rows keyed by
        // event_id (or by doc id) used to miss the credit-back silently.
        const found = await findEventEarningsDocInTransaction(tx, String(withdrawal.eventId))
        if (found) {
          const earningsDoc = found
          const earnings = found.data as any

          const available = Number(earnings.availableToWithdraw || 0)
          const withdrawn = Number(earnings.withdrawnAmount || 0)

          tx.update(earningsDoc.ref, {
            availableToWithdraw: available + amountInCents,
            withdrawnAmount: Math.max(0, withdrawn - amountInCents),
            settlementStatus: 'ready',
            updatedAt: now.toISOString(),
          })
        }
      }

      // Idempotent + allowed transitions
      if (action === 'approve') {
        if (beforeStatus === 'processing') return { idempotent: true, afterStatus: beforeStatus }
        if (beforeStatus !== 'pending') return { conflict: true, beforeStatus }
        updates.status = 'processing'
        updates.processedBy = user.id
        updates.processedAt = now
        if (internalNote) updates.adminNote = internalNote
      }

      if (action === 'reject') {
        if (beforeStatus === 'failed') return { idempotent: true, afterStatus: beforeStatus }
        if (beforeStatus !== 'pending') return { conflict: true, beforeStatus }
        await setFailedWithRefund(payeeReasonEn || 'Your withdrawal request was declined.')
      }

      if (action === 'complete') {
        if (beforeStatus === 'completed') return { idempotent: true, afterStatus: beforeStatus }
        if (beforeStatus !== 'processing') return { conflict: true, beforeStatus }
        updates.status = 'completed'
        updates.completedAt = now
        if (internalNote) updates.completionNote = internalNote
        if (withdrawal.needsReconciliation) {
          updates.needsReconciliation = false
          updates.reconciledAt = now
          updates.confirmedVia = 'admin'
        }
      }

      if (action === 'fail') {
        if (beforeStatus === 'failed') return { idempotent: true, afterStatus: beforeStatus }
        if (beforeStatus === 'completed') return { conflict: true, beforeStatus }
        await setFailedWithRefund(payeeReasonEn || 'The payout could not be completed.')
      }

      tx.update(withdrawalRef, updates)
      return {
        idempotent: false,
        beforeStatus,
        afterStatus: String(updates.status || beforeStatus),
        row: { ...withdrawal, ...updates },
      }
    })

    if ((txResult as any)?.notFound) {
      return adminError('Withdrawal not found', 404)
    }

    if ((txResult as any)?.conflict) {
      return adminError('Invalid withdrawal status transition', 409, `Cannot ${action} - withdrawal is ${(txResult as any).beforeStatus}`)
    }

    const idempotent = Boolean((txResult as any)?.idempotent)

    if (!idempotent) {
      const actionMap: Record<string, any> = {
        approve: 'withdrawal.approve',
        reject: 'withdrawal.reject',
        complete: 'withdrawal.complete',
        fail: 'withdrawal.fail',
      }

      logAdminAction({
        action: actionMap[action] || 'admin.backfill',
        adminId: user.id,
        adminEmail: user.email || 'unknown',
        resourceType: 'withdrawal',
        resourceId: withdrawalId,
        details: {
          withdrawalId,
          internalNote,
          payeeReasonCode,
          payeeReasonText,
          beforeStatus: (txResult as any)?.beforeStatus,
          afterStatus: (txResult as any)?.afterStatus,
        },
      }).catch(() => {})

      // Tell the payee. Deduped per (withdrawal, outcome), never throws.
      const outcomeByAction: Record<string, WithdrawalOutcome> = {
        approve: 'approved',
        complete: 'admin_completed',
        reject: 'admin_rejected',
        fail: 'failed',
      }
      await notifyWithdrawalOutcome(withdrawalId, outcomeByAction[action], {
        row: (txResult as any)?.row,
        reasonCode: action === 'reject' || action === 'fail' ? payeeReasonCode : null,
        reasonText: action === 'reject' || action === 'fail' ? payeeReasonText : null,
      })
    }

    return adminOk({
      message: `Withdrawal ${action}d successfully`,
      idempotent,
    })
  } catch (err: any) {
    console.error('Error updating withdrawal:', err)
    return adminError('Failed to update withdrawal', 500, err?.message)
  }
}
