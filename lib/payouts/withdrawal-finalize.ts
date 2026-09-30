/**
 * The one seam that settles a MonCash withdrawal row for good.
 *
 * Three writers can decide the fate of the same `withdrawal_requests` row: the
 * synchronous withdraw routes (organizer + promoter), the reconciliation cron,
 * and an admin. Each used to hand-roll its own "mark completed" / "put the money
 * back" code, and the put-the-money-back half is where a bug costs real money:
 * two releases of one reservation credit the payee twice.
 *
 * Both functions here run in a Firestore transaction that re-reads the row and
 * refuses to act unless it is still `processing` — so two overlapping cron runs,
 * or the cron racing an admin, can release a reservation at most once.
 *
 * Ledger semantics mirror the synchronous paths exactly:
 *  - COMPLETED: the reservation (earnings debit / wallet debit) was taken before
 *    Transfert was called, so completing touches ONLY the row. No second debit.
 *  - RELEASED (failed): the reservation is credited back — `event_earnings` for
 *    an organizer row, `promoter_wallets.withdrawn_by_currency` for a promoter row
 *    (exactly the `walletDebits` recorded when it was taken).
 */
import { adminDb } from '@/lib/firebase/admin'

export type FinalizeResult =
  | { changed: true; row: any }
  | { changed: false; reason: 'not_found' | 'already_completed' | 'already_released' | 'not_processing' | 'conflict'; row?: any }

/** A row whose Transfert may have been sent and whose outcome we hold open. */
export function isPrefundedInFlight(row: any): boolean {
  return String(row?.status || '') === 'processing' && row?.prefundingUsed === true
}

/**
 * Mark an instant withdrawal completed. Idempotent: an already-completed row is
 * left alone. A row that was already FAILED (reservation released) but that
 * MonCash now says was paid is the double-payout case — it is not resurrected
 * silently but flagged for an admin.
 */
export async function finalizeWithdrawalCompleted(
  withdrawalId: string,
  params: { transactionId?: string | null; raw?: any; confirmedVia: string; statusRaw?: any; now?: Date }
): Promise<FinalizeResult> {
  const ref = adminDb.collection('withdrawal_requests').doc(withdrawalId)
  const now = params.now || new Date()

  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { changed: false, reason: 'not_found' } as FinalizeResult
    const row = snap.data() as any
    const status = String(row?.status || '')

    if (status === 'completed') return { changed: false, reason: 'already_completed', row } as FinalizeResult

    if (status === 'failed') {
      // MonCash paid a withdrawal whose money we already gave back. Never
      // double-debit automatically — an admin has to recover it.
      tx.set(
        ref,
        {
          needsReconciliation: true,
          reconciliationEscalated: true,
          reconciliationConflict: 'paid_after_release',
          reconciliationStatusRaw: params.statusRaw ?? params.raw ?? null,
          updatedAt: now,
        },
        { merge: true }
      )
      return { changed: false, reason: 'conflict', row } as FinalizeResult
    }

    if (status !== 'processing') return { changed: false, reason: 'not_processing', row } as FinalizeResult

    const patch: Record<string, any> = {
      status: 'completed',
      completedAt: now,
      processedAt: now,
      confirmedVia: params.confirmedVia,
      // Only touch the flag on rows that carried it.
      needsReconciliation: row?.needsReconciliation ? false : undefined,
      reconciledAt: row?.needsReconciliation ? now : undefined,
      updatedAt: now,
    }
    if (params.transactionId) patch.moncashTransactionId = params.transactionId
    if (params.raw !== undefined) patch.prefundingTransferRaw = params.raw
    if (params.statusRaw !== undefined) patch.reconciliationStatusRaw = params.statusRaw
    tx.set(ref, stripUndefined(patch), { merge: true })
    return { changed: true, row: { ...row, ...patch } } as FinalizeResult
  })
}

/**
 * Fail a withdrawal and give its reservation back — exactly once.
 *
 * The guard is two-fold, both read inside the transaction: the row must still be
 * `processing` (or `pending`, for the admin reject of a manual request, when
 * `allowPending` is set), and must not carry `reservationReleasedAt`. Whoever
 * commits first flips the status to `failed`; every later caller sees that and
 * does nothing.
 */
export async function releaseWithdrawalReservation(
  withdrawalId: string,
  params: { reason: string; releasedBy: string; allowPending?: boolean; extra?: Record<string, any>; now?: Date }
): Promise<FinalizeResult> {
  const ref = adminDb.collection('withdrawal_requests').doc(withdrawalId)
  const now = params.now || new Date()

  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { changed: false, reason: 'not_found' } as FinalizeResult
    const row = snap.data() as any
    const status = String(row?.status || '')

    if (row?.reservationReleasedAt || status === 'failed') {
      return { changed: false, reason: 'already_released', row } as FinalizeResult
    }
    if (status === 'completed') return { changed: false, reason: 'already_completed', row } as FinalizeResult
    if (!(status === 'processing' || (params.allowPending && status === 'pending'))) {
      return { changed: false, reason: 'not_processing', row } as FinalizeResult
    }

    // All reads before any write (Firestore transaction rule).
    let creditWrite: (() => void) | null = null
    if (row?.payee_type === 'promoter') {
      const debits = (row?.walletDebits || {}) as Record<string, number>
      const walletRef = adminDb.collection('promoter_wallets').doc(String(row?.promoter_uid || row?.organizerId))
      const walletSnap = await tx.get(walletRef)
      const stored = walletSnap.exists ? (walletSnap.data() as any)?.withdrawn_by_currency || {} : {}
      const next: Record<string, number> = { ...stored }
      for (const [currency, cents] of Object.entries(debits)) {
        next[currency] = Math.max(0, (Number(stored[currency]) || 0) - Math.max(0, Number(cents) || 0))
      }
      creditWrite = () =>
        tx.set(walletRef, { withdrawn_by_currency: next, updated_at: now.toISOString() }, { merge: true })
    } else if (row?.eventId) {
      const amount = Math.max(0, Math.round(Number(row?.reservedCents ?? row?.amount) || 0))
      const earningsSnap = await tx.get(
        adminDb.collection('event_earnings').where('eventId', '==', String(row.eventId)).limit(1)
      )
      if (!earningsSnap.empty && amount > 0) {
        const earningsDoc = earningsSnap.docs[0]
        const e = earningsDoc.data() as any
        const restoredAvailable = Math.max(0, Number(e?.availableToWithdraw || 0) || 0) + amount
        const restoredWithdrawn = Math.max(0, (Number(e?.withdrawnAmount || 0) || 0) - amount)
        creditWrite = () =>
          tx.update(earningsDoc.ref, {
            availableToWithdraw: restoredAvailable,
            withdrawnAmount: restoredWithdrawn,
            settlementStatus: restoredAvailable === 0 ? 'locked' : 'ready',
            updatedAt: now.toISOString(),
          })
      }
    }

    if (creditWrite) creditWrite()

    const patch: Record<string, any> = {
      ...(params.extra || {}),
      status: 'failed',
      failureReason: params.reason,
      needsReconciliation: false,
      reservationReleasedAt: now,
      reservationReleasedBy: params.releasedBy,
      // Kept for the admin UI / earlier tooling that reads this name.
      reservationRolledBackAt: now,
      // No earnings row found for an organizer row: say so instead of pretending.
      reservationCredited: Boolean(creditWrite),
      updatedAt: now,
    }
    tx.set(ref, patch, { merge: true })
    return { changed: true, row: { ...row, ...patch } } as FinalizeResult
  })
}

function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const out: any = {}
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v
  return out
}
