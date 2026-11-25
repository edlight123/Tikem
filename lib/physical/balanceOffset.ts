/**
 * Paying a printed batch from the organizer's Tikèm balance ("offset").
 *
 * No parallel balance: the money comes off ONE event's ledger row through the
 * same debit every withdrawal uses (lib/earnings.ts withdrawFromEarnings),
 * which re-checks the ceiling inside its transaction, nets organizer debt
 * (lib/payouts/organizer-debt.ts) and files the withdrawal_requests row in the
 * SAME transaction. The row is method 'balance_offset', status 'completed'
 * (nothing is transferred: Tikèm keeps the money), so it shows in the
 * organizer's payout history and the admin withdrawals list, and the
 * availability engine counts it like any other withdrawal.
 *
 * Rules:
 *   - only the org owner, or an org admin with the finance grant (spending the
 *     organization's money is a finance act; managers and sellers never);
 *   - HTG only, and only money RELEASED now (availableNowMinor: not pending,
 *     held or under review) on a single event that covers the FULL price (no
 *     partial payment, no split across events: one atomic debit);
 *   - the release ladder gate runs again at pay time, like a withdrawal;
 *   - the row id is deterministic (physoffset_{batchId}), so a retry can never
 *     debit twice;
 *   - cancelling the batch before printing credits the debit back.
 */

import { adminDb } from '@/lib/firebase/admin'
import { findEventEarningsDocInTransaction, readRefundClaimVersion, withdrawFromEarnings } from '@/lib/earnings'
import { loadEventAvailability, loadOrganizerAvailability } from '@/lib/payouts/availability-server'
import { gateEventData, integrityRefusal } from '@/lib/payouts/availability'
import { gateHaitiWithdrawal } from '@/lib/payouts/withdrawal-gate'
import { syncOrganizerDebt } from '@/lib/payouts/organizer-debt'
import { teamSeatIn, type CurrentUser } from '@/lib/organizer/context'
import { getBatch, markBatchPaid, retireBatchTickets, type BatchDoc } from './batches'
import { PHYSICAL_BATCHES } from './rules'

export const OFFSET_ROW_PREFIX = 'physoffset_'
export const offsetWithdrawalId = (batchId: string) => `${OFFSET_ROW_PREFIX}${batchId}`

/** Pure: may this seat spend the org's balance? Owner, or admin with the finance grant. */
export function mayPayFromBalance(input: { isOwner: boolean; role: string | null; financeView: boolean }): boolean {
  if (input.isOwner) return true
  return input.role === 'admin' && input.financeView === true
}

export async function canUseBalance(user: CurrentUser, orgId: string): Promise<boolean> {
  if (!orgId) return false
  if (orgId === user.id) return true
  const seat = await teamSeatIn(orgId, user.id).catch(() => null)
  return mayPayFromBalance({ isOwner: false, role: seat?.role || null, financeView: seat?.financeView === true })
}

export interface OffsetSource {
  eventId: string
  title: string
  availableNowMinor: number
}

/**
 * Pure: the event to debit for `totalMinor` HTG: released money only, one event
 * covering the full amount, the batch's own event first, else the largest.
 */
export function pickOffsetSource(
  events: Array<{ eventId: string; title: string; currency: string; availableNowMinor: number; blocked?: boolean }>,
  totalMinor: number,
  preferEventId?: string | null
): OffsetSource | null {
  const fit = events.filter((e) => e.currency === 'HTG' && !e.blocked && e.availableNowMinor >= totalMinor && totalMinor > 0)
  if (fit.length === 0) return null
  const preferred = fit.find((e) => e.eventId === preferEventId)
  const chosen = preferred || fit.sort((a, b) => b.availableNowMinor - a.availableNowMinor)[0]
  return { eventId: chosen.eventId, title: chosen.title, availableNowMinor: chosen.availableNowMinor }
}

/** The organizer's released HTG balance, per event (largest single event = what an offset can cover). */
export async function loadOffsetCandidates(organizerId: string) {
  const { events } = await loadOrganizerAvailability(organizerId)
  return events.map((e: any) => ({
    eventId: String(e.eventId || e.event?.id || e.id || ''),
    title: String(e.title || ''),
    currency: String(e.currency || '').toUpperCase(),
    availableNowMinor: Math.max(0, Math.round(Number(e.availableNowMinor) || 0)),
    blocked: Boolean(integrityRefusal(e)) || Boolean(e.reason && String(e.reason).includes('currency_review')),
  }))
}

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

  await syncOrganizerDebt(orgId).catch(() => null)
  const candidates = await loadOffsetCandidates(orgId)
  const source = pickOffsetSource(candidates, totalMinor, batch.event_id)
  if (!source) {
    return { ok: false, status: 409, code: 'insufficient_balance', error: 'Your released balance does not cover this batch' }
  }

  // Same sequence as a withdrawal: claim version, availability, gate, debit.
  const eventSnap = await adminDb.collection('events').doc(source.eventId).get()
  const eventData = eventSnap.exists ? eventSnap.data() || {} : null
  if (!eventData) return { ok: false, status: 409, code: 'insufficient_balance', error: 'Your released balance does not cover this batch' }
  const expectedRefundClaimVersion = await readRefundClaimVersion(source.eventId)
  const a = await loadEventAvailability({ eventId: source.eventId, eventData })
  if (!a || a.currency !== 'HTG' || integrityRefusal(a) || a.availableNowMinor < totalMinor) {
    return { ok: false, status: 409, code: 'insufficient_balance', error: 'Your released balance does not cover this batch' }
  }
  const gate = await gateHaitiWithdrawal({
    eventId: source.eventId,
    organizerId: orgId,
    eventData: gateEventData(eventData, a),
    grossMinor: a.gateInputs.grossMinor,
    refundedMinor: a.gateInputs.refundedMinor,
    currency: 'HTG',
    availableMinor: a.balanceMinor,
    requestedAmountMinor: totalMinor,
    method: 'moncash',
  })
  if (!gate.allowed) {
    return { ok: false, status: 409, code: 'balance_not_released', error: String(gate.body?.error || 'This balance is not released yet') }
  }

  const now = new Date()
  const debit = await withdrawFromEarnings(source.eventId, totalMinor, withdrawalRef.id, {
    ceilingMinor: a.ceilingMinor,
    expectedRefundClaimVersion,
    debt: { organizerId: orgId, currency: 'HTG' },
    fileRequest: {
      ref: withdrawalRef,
      data: {
        organizerId: orgId,
        eventId: source.eventId,
        amount: totalMinor,
        currency: 'HTG',
        method: 'balance_offset',
        status: 'completed',
        purpose: 'physical_batch',
        physicalBatchId: batch.id,
        physicalEventId: batch.event_id,
        note: `Printed tickets: ${batch.quantity} × ${batch.tier_name}`,
        requestedBy: user.id,
        createdAt: now,
        completedAt: now,
        updatedAt: now,
      },
    },
  })
  if (!debit.success) {
    // A concurrent call filed the same deterministic row first: finish through it.
    if (/already exists/i.test(String(debit.error || '')) && !params.retried) {
      return payBatchFromBalance({ ...params, retried: true })
    }
    return { ok: false, status: 409, code: debit.code || 'insufficient_balance', error: debit.error || 'Your released balance does not cover this batch' }
  }

  const paid = await markBatchPaid(batch.id, {
    funds_rail: 'balance_offset',
    reference: withdrawalRef.id,
    amount: Number(batch.total_htg),
    currency: 'HTG',
    extra: { offset_event_id: source.eventId, withdrawal_id: withdrawalRef.id },
  })
  if (!paid.ok) {
    // The batch was cancelled meanwhile: give the money straight back.
    await creditBackOffset(batch.id, 'system')
    return { ok: false, status: 409, code: 'batch_not_payable', error: 'This batch can no longer be paid' }
  }
  return { ok: true, withdrawalId: withdrawalRef.id, eventId: source.eventId }
}

/**
 * Credit a balance-offset payment back, once: the event's ledger row gets the
 * amount back (withdrawnAmount −= amount, the same reversal a failed withdrawal
 * gets) and the withdrawal row becomes 'cancelled' (void, so the availability
 * engine stops counting it). Used when a paid-from-balance batch is cancelled
 * before printing, and when the debit landed on a batch that was cancelled.
 */
export async function creditBackOffset(batchId: string, by: string): Promise<{ ok: boolean; code?: string; amountMinor?: number }> {
  const rowRef = adminDb.collection('withdrawal_requests').doc(offsetWithdrawalId(batchId))
  const batchRef = adminDb.collection(PHYSICAL_BATCHES).doc(batchId)
  return adminDb.runTransaction(async (tx: any) => {
    const rowSnap = await tx.get(rowRef)
    if (!rowSnap.exists) return { ok: false, code: 'no_offset' }
    const row = rowSnap.data() || {}
    if (row.method !== 'balance_offset' || row.physicalBatchId !== batchId) return { ok: false, code: 'not_offset' }
    if (row.status !== 'completed' || row.reversedAt) return { ok: false, code: 'already_credited' }
    const amount = Math.max(0, Math.round(Number(row.reservedCents ?? row.amount) || 0))
    const found = await findEventEarningsDocInTransaction(tx, String(row.eventId))
    const batchSnap = await tx.get(batchRef)
    const now = new Date()
    if (found && amount > 0) {
      const e = found.data || {}
      const available = Math.max(0, Number(e.availableToWithdraw || 0) || 0) + amount
      tx.update(found.ref, {
        availableToWithdraw: available,
        withdrawnAmount: Math.max(0, (Number(e.withdrawnAmount || 0) || 0) - amount),
        settlementStatus: available === 0 ? 'locked' : 'ready',
        updatedAt: now.toISOString(),
      })
    }
    tx.update(rowRef, { status: 'cancelled', reversedAt: now, reversedBy: by, reversalReason: 'physical_batch_cancelled', updatedAt: now })
    if (batchSnap.exists) {
      tx.update(batchRef, { 'payment.refunded_to_balance_at': now.toISOString(), 'payment.refunded_to_balance_by': by, updated_at: now.toISOString() })
    }
    return { ok: true, amountMinor: amount }
  })
}

/**
 * Cancel a batch PAID FROM BALANCE before it goes to the printer: the batch is
 * cancelled, the money is credited back, the tickets are retired and the seats
 * return to online sales.
 */
export async function cancelPaidFromBalance(batchId: string, by: string): Promise<{ ok: boolean; code?: string; creditedMinor?: number }> {
  const ref = adminDb.collection(PHYSICAL_BATCHES).doc(batchId)
  const claimed: string = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return 'not_found'
    const b = snap.data() || {}
    if (b.payment?.funds_rail !== 'balance_offset') return 'not_balance'
    if (b.status !== 'paid') return 'already_printing'
    const nowIso = new Date().toISOString()
    tx.update(ref, { status: 'cancelled', cancelled_by: by, cancel_reason: 'cancelled_before_printing', cancelled_at: nowIso, updated_at: nowIso })
    return 'ok'
  })
  if (claimed !== 'ok') return { ok: false, code: claimed }
  const credit = await creditBackOffset(batchId, by)
  const batch = await getBatch(batchId)
  if (batch) await retireBatchTickets(batch, by)
  return { ok: true, creditedMinor: credit.amountMinor || 0 }
}
