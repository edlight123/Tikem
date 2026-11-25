/**
 * Paying Tikèm from the organizer's released balance ("offset"). Shared by
 * printed tickets (lib/physical/balanceOffset.ts) and the door team
 * (lib/doorTeam/payments.ts).
 *
 * No parallel balance: the money comes off ONE event's ledger row through the
 * same debit every withdrawal uses (lib/earnings.ts withdrawFromEarnings),
 * which re-checks the ceiling inside its transaction, nets organizer debt and
 * files the withdrawal_requests row in the SAME transaction. The row is method
 * 'balance_offset', status 'completed' (nothing is transferred: Tikèm keeps the
 * money), so it shows in the payout history and the admin withdrawals list,
 * and the availability engine counts it like any other withdrawal.
 *
 * Rules:
 *   - only the org owner, or an org admin with the finance grant;
 *   - HTG only, and only money RELEASED now on a single event that covers the
 *     FULL price (no partial payment, no split: one atomic debit);
 *   - the release ladder gate runs again at pay time, like a withdrawal;
 *   - the caller passes a DETERMINISTIC row id, so a retry can never debit twice.
 */

import { adminDb } from '@/lib/firebase/admin'
import { findEventEarningsDocInTransaction, readRefundClaimVersion, withdrawFromEarnings } from '@/lib/earnings'
import { loadEventAvailability, loadOrganizerAvailability } from '@/lib/payouts/availability-server'
import { gateEventData, integrityRefusal } from '@/lib/payouts/availability'
import { gateHaitiWithdrawal } from '@/lib/payouts/withdrawal-gate'
import { syncOrganizerDebt } from '@/lib/payouts/organizer-debt'
import { teamSeatIn, type CurrentUser } from '@/lib/organizer/context'

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
 * covering the full amount, the preferred event first, else the largest.
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

/** The largest released HTG a single event holds, in whole HTG (what an offset can cover). */
export async function largestReleasedHtg(organizerId: string): Promise<number> {
  const candidates = await loadOffsetCandidates(organizerId).catch(() => [])
  const best = candidates.filter((c) => c.currency === 'HTG' && !c.blocked).reduce((m, c) => Math.max(m, c.availableNowMinor), 0)
  return Math.floor(best / 100)
}

export type DebitResult =
  | { ok: true; eventId: string }
  | { ok: false; status: number; code: string; error: string; alreadyExists?: boolean }

const INSUFFICIENT = { ok: false as const, status: 409, code: 'insufficient_balance', error: 'Your released balance does not cover this amount' }

/**
 * Debit `totalMinor` HTG of released money from one event of `orgId`, filing
 * `withdrawalRef` (a deterministic id the caller owns) in the same transaction.
 * Same sequence as a withdrawal: claim version, availability, gate, debit.
 */
export async function debitReleasedBalance(params: {
  orgId: string
  totalMinor: number
  preferEventId?: string | null
  withdrawalRef: any
  row: Record<string, any>
}): Promise<DebitResult> {
  const { orgId, totalMinor, withdrawalRef } = params
  await syncOrganizerDebt(orgId).catch(() => null)
  const candidates = await loadOffsetCandidates(orgId)
  const source = pickOffsetSource(candidates, totalMinor, params.preferEventId)
  if (!source) return INSUFFICIENT

  const eventSnap = await adminDb.collection('events').doc(source.eventId).get()
  const eventData = eventSnap.exists ? eventSnap.data() || {} : null
  if (!eventData) return INSUFFICIENT
  const expectedRefundClaimVersion = await readRefundClaimVersion(source.eventId)
  const a = await loadEventAvailability({ eventId: source.eventId, eventData })
  if (!a || a.currency !== 'HTG' || integrityRefusal(a) || a.availableNowMinor < totalMinor) return INSUFFICIENT
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
        createdAt: now,
        completedAt: now,
        updatedAt: now,
        ...params.row,
      },
    },
  })
  if (!debit.success) {
    return {
      ok: false,
      status: 409,
      code: debit.code || 'insufficient_balance',
      error: debit.error || INSUFFICIENT.error,
      alreadyExists: /already exists/i.test(String(debit.error || '')),
    }
  }
  return { ok: true, eventId: source.eventId }
}

/**
 * Inside a transaction: give an offset row's money back to its event's ledger
 * (withdrawnAmount −= amount, the reversal a failed withdrawal gets) and void
 * the row ('cancelled', so the availability engine stops counting it).
 * The caller has already read `rowSnap` in `tx` and checked it is a live
 * offset row of the thing being credited. Returns the amount credited (minor).
 */
export async function reverseOffsetRowInTransaction(
  tx: any,
  rowRef: any,
  row: Record<string, any>,
  by: string,
  reason: string
): Promise<number> {
  const amount = Math.max(0, Math.round(Number(row.reservedCents ?? row.amount) || 0))
  const found = await findEventEarningsDocInTransaction(tx, String(row.eventId))
  const now = new Date()
  const nowIso = now.toISOString()
  if (found && amount > 0) {
    const e = found.data || {}
    const available = Math.max(0, Number(e.availableToWithdraw || 0) || 0) + amount
    tx.update(found.ref, {
      availableToWithdraw: available,
      withdrawnAmount: Math.max(0, (Number(e.withdrawnAmount || 0) || 0) - amount),
      settlementStatus: available === 0 ? 'locked' : 'ready',
      updatedAt: nowIso,
    })
  }
  tx.update(rowRef, { status: 'cancelled', reversedAt: now, reversedBy: by, reversalReason: reason, updatedAt: now })
  return amount
}

/** Pure: is this withdrawal row a live (not yet reversed) offset? */
export function isLiveOffsetRow(row: Record<string, any> | null | undefined): boolean {
  return Boolean(row && row.method === 'balance_offset' && row.status === 'completed' && !row.reversedAt)
}
