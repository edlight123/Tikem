/**
 * Paying a printed batch from the organizer's Tikèm balance ("offset").
 *
 * The debit itself (one event's released HTG, through the withdrawal debit,
 * with the ledger row filed in the same transaction) lives in
 * lib/platformPay/balance.ts, shared with the door team. This module owns the
 * batch side:
 *   - only the org owner, or an org admin with the finance grant;
 *   - the row id is deterministic (physoffset_{batchId}), so a retry can never
 *     debit twice;
 *   - cancelling the batch before printing credits the debit back.
 */

import { adminDb } from '@/lib/firebase/admin'
import {
  canUseBalance,
  debitReleasedBalance,
  isLiveOffsetRow,
  loadOffsetCandidates,
  mayPayFromBalance,
  pickOffsetSource,
  reverseOffsetRowInTransaction,
  type OffsetSource,
} from '@/lib/platformPay/balance'
import type { CurrentUser } from '@/lib/organizer/context'
import { getBatch, markBatchPaid, retireBatchTickets, type BatchDoc } from './batches'
import { retireCardSession } from './payments'
import { PHYSICAL_BATCHES } from './rules'

// Shared with the door team; re-exported so existing callers keep their imports.
export { canUseBalance, loadOffsetCandidates, mayPayFromBalance, pickOffsetSource, type OffsetSource }

export const OFFSET_ROW_PREFIX = 'physoffset_'
export const offsetWithdrawalId = (batchId: string) => `${OFFSET_ROW_PREFIX}${batchId}`

export type OffsetResult =
  | { ok: true; withdrawalId: string; eventId: string; alreadyDone?: boolean }
  | { ok: false; status: number; code: string; error: string }

/** Debit the batch's full price from a released event balance and mark it paid. */
export async function payBatchFromBalance(params: { batch: BatchDoc; user: CurrentUser; retried?: boolean }): Promise<OffsetResult> {
  const { batch, user } = params
  const orgId = batch.organizer_id
  if (!(await canUseBalance(user, orgId))) {
    return { ok: false, status: 403, code: 'balance_not_allowed', error: 'Only the owner or a finance admin can pay from the balance' }
  }
  const totalMinor = Math.round(Number(batch.total_htg) * 100)
  const withdrawalRef = adminDb.collection('withdrawal_requests').doc(offsetWithdrawalId(batch.id))

  // A retry after the debit landed: finish (mark paid), never debit again.
  const existing = await withdrawalRef.get()
  if (existing.exists) {
    const row = existing.data() || {}
    if (row.method === 'balance_offset' && row.status === 'completed' && row.physicalBatchId === batch.id) {
      const paid = await markBatchPaid(batch.id, {
        funds_rail: 'balance_offset',
        reference: withdrawalRef.id,
        amount: Number(batch.total_htg),
        currency: 'HTG',
        extra: { offset_event_id: row.eventId, withdrawal_id: withdrawalRef.id },
      })
      if (!paid.ok) await creditBackOffset(batch.id, 'system')
      return paid.ok
        ? { ok: true, withdrawalId: withdrawalRef.id, eventId: String(row.eventId), alreadyDone: true }
        : { ok: false, status: 409, code: 'batch_not_payable', error: 'This batch can no longer be paid' }
    }
    return { ok: false, status: 409, code: 'offset_exists', error: 'This batch was already charged to the balance' }
  }
  if (batch.status !== 'awaiting_payment') {
    return { ok: false, status: 409, code: 'not_awaiting_payment', error: 'This batch is not waiting for payment' }
  }

  // Paying from the balance: an open card session must not be able to pay too.
  await retireCardSession(batch)
  const debit = await debitReleasedBalance({
    orgId,
    totalMinor,
    preferEventId: batch.event_id,
    withdrawalRef,
    row: {
      purpose: 'physical_batch',
      physicalBatchId: batch.id,
      physicalEventId: batch.event_id,
      note: `Printed tickets: ${batch.quantity} × ${batch.tier_name}`,
      requestedBy: user.id,
    },
  })
  if (!debit.ok) {
    // A concurrent call filed the same deterministic row first: finish through it.
    if (debit.alreadyExists && !params.retried) return payBatchFromBalance({ ...params, retried: true })
    const error = debit.code === 'insufficient_balance' ? 'Your released balance does not cover this batch' : debit.error
    return { ok: false, status: debit.status, code: debit.code, error }
  }

  const paid = await markBatchPaid(batch.id, {
    funds_rail: 'balance_offset',
    reference: withdrawalRef.id,
    amount: Number(batch.total_htg),
    currency: 'HTG',
    extra: { offset_event_id: debit.eventId, withdrawal_id: withdrawalRef.id },
  })
  if (!paid.ok) {
    // The batch was cancelled meanwhile: give the money straight back.
    await creditBackOffset(batch.id, 'system')
    return { ok: false, status: 409, code: 'batch_not_payable', error: 'This batch can no longer be paid' }
  }
  return { ok: true, withdrawalId: withdrawalRef.id, eventId: debit.eventId }
}

/**
 * Credit a balance-offset payment back, once, in ONE transaction: the event's
 * ledger row gets the amount back, the withdrawal row becomes 'cancelled' and
 * the batch is stamped refunded_to_balance_at (lib/platformPay/balance.ts
 * reverseOffsetRowInTransaction). With `cancelBatch` the batch is cancelled in
 * the same transaction. Refused once the batch has been printed (printed_at):
 * Tikèm has done the work.
 */
async function creditInTransaction(
  batchId: string,
  by: string,
  mode: { cancelBatch: boolean; requirePaid?: boolean }
): Promise<{ ok: boolean; code?: string; amountMinor?: number }> {
  const rowRef = adminDb.collection('withdrawal_requests').doc(offsetWithdrawalId(batchId))
  const batchRef = adminDb.collection(PHYSICAL_BATCHES).doc(batchId)
  return adminDb.runTransaction(async (tx: any) => {
    const batchSnap = await tx.get(batchRef)
    const rowSnap = await tx.get(rowRef)
    const b = batchSnap.exists ? batchSnap.data() || {} : null
    if (b?.printed_at) return { ok: false, code: 'already_printed' }
    if (mode.requirePaid) {
      if (!b) return { ok: false, code: 'not_found' }
      if (b.payment?.funds_rail !== 'balance_offset') return { ok: false, code: 'not_balance' }
      // A retry after a crash: cancelled before printing but never credited.
      const retry = b.status === 'cancelled' && b.cancel_reason === 'cancelled_before_printing' && !b.payment?.refunded_to_balance_at
      if (b.status !== 'paid' && !retry) return { ok: false, code: b.status === 'cancelled' ? 'already_credited' : 'already_printing' }
    }
    if (!rowSnap.exists) return { ok: false, code: 'no_offset' }
    const row = rowSnap.data() || {}
    if (row.method !== 'balance_offset' || row.physicalBatchId !== batchId) return { ok: false, code: 'not_offset' }
    if (!isLiveOffsetRow(row)) return { ok: false, code: 'already_credited' }
    const amount = await reverseOffsetRowInTransaction(tx, rowRef, row, by, 'physical_batch_cancelled')
    const nowIso = new Date().toISOString()
    if (b) {
      tx.update(batchRef, {
        'payment.refunded_to_balance_at': nowIso,
        'payment.refunded_to_balance_by': by,
        ...(mode.cancelBatch && b.status !== 'cancelled'
          ? { status: 'cancelled', cancelled_by: by, cancel_reason: 'cancelled_before_printing', cancelled_at: nowIso }
          : {}),
        updated_at: nowIso,
      })
    }
    return { ok: true, amountMinor: amount }
  })
}

/** Credit back a debit whose batch can no longer be paid (it was cancelled). */
export async function creditBackOffset(batchId: string, by: string): Promise<{ ok: boolean; code?: string; amountMinor?: number }> {
  return creditInTransaction(batchId, by, { cancelBatch: false })
}

/**
 * Cancel a batch PAID FROM BALANCE before it goes to the printer: cancel and
 * credit in one transaction, then retire the tickets and return the seats.
 * Safe to retry (a cancelled-but-uncredited batch is credited; tickets already
 * retired are skipped).
 */
export async function cancelPaidFromBalance(batchId: string, by: string): Promise<{ ok: boolean; code?: string; creditedMinor?: number }> {
  const credit = await creditInTransaction(batchId, by, { cancelBatch: true, requirePaid: true })
  if (!credit.ok) return { ok: false, code: credit.code }
  const batch = await getBatch(batchId)
  if (batch) await retireBatchTickets(batch, by)
  return { ok: true, creditedMinor: credit.amountMinor || 0 }
}

export type OffsetReconcile = 'none' | 'finished_paid' | 'credited' | 'kept'

/**
 * The debit and "mark the batch paid" are two steps: a crash between them
 * leaves the balance debited and the batch unpaid. Every path that would act
 * on an unpaid batch (the expiry sweep, "check payment", cancel) calls this
 * first:
 *   - still awaiting payment → finish it (mark paid with the existing debit);
 *   - cancelled (and never printed) → credit the debit back;
 *   - otherwise nothing to do.
 */
export async function reconcileOffset(batchId: string): Promise<OffsetReconcile> {
  const rowSnap = await adminDb.collection('withdrawal_requests').doc(offsetWithdrawalId(batchId)).get()
  const row = rowSnap.exists ? rowSnap.data() || {} : null
  if (!row || row.method !== 'balance_offset' || row.status !== 'completed' || row.reversedAt) return 'none'
  const batch = await getBatch(batchId)
  if (!batch) return 'none'
  if (batch.status === 'awaiting_payment') {
    const paid = await markBatchPaid(batchId, {
      funds_rail: 'balance_offset',
      reference: rowSnap.id,
      amount: Number(batch.total_htg),
      currency: 'HTG',
      extra: { offset_event_id: row.eventId, withdrawal_id: rowSnap.id, recovered: true },
    })
    if (paid.ok) return 'finished_paid'
  }
  const fresh = await getBatch(batchId)
  if (fresh?.status === 'cancelled' && !fresh.payment?.refunded_to_balance_at) {
    const c = await creditBackOffset(batchId, 'system')
    return c.ok ? 'credited' : 'kept'
  }
  return 'kept'
}
