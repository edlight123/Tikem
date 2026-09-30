/**
 * Automatic recheck of instant MonCash withdrawals whose outcome is unknown.
 *
 * An instant payout that timed out, 5xx'd or came back garbled is held as
 * `status: 'processing', needsReconciliation: true` with its reservation KEPT
 * (see lib/payouts/moncash-prefunded.ts for why). Before this job an admin had
 * to settle every one by hand. Now the cron asks PrefundedTransactionStatus
 * about the row's own reference (the withdrawal id) until it gets a definitive
 * answer:
 *
 *  - "successful"      → completed (row only; the money was debited at reservation).
 *  - failed/not-found  → released back to the balance, but ONLY once the attempt
 *                        is older than RECONCILE_RELEASE_GRACE_MS: Digicel may not
 *                        know a reference for a while after a slow transfer.
 *  - anything else     → left alone; attempt counter + lastCheckedAt recorded;
 *                        after RECONCILE_ESCALATE_AFTER_MS (or that many attempts)
 *                        `reconciliationEscalated` is set and admins are told once.
 *
 * It also sweeps rows stuck in `processing` WITHOUT the flag (the function was
 * killed between reservation and outcome) once they are older than
 * RECONCILE_STUCK_AFTER_MS, flags them, and treats them the same way.
 *
 * Every state change goes through lib/payouts/withdrawal-finalize.ts, whose
 * transactions make overlapping runs safe: a reservation is released at most
 * once and a row is completed at most once.
 */
import { adminDb } from '@/lib/firebase/admin'
import { moncashPrefundedTransactionStatus } from '@/lib/moncash'
import {
  finalizeWithdrawalCompleted,
  isPrefundedInFlight,
  releaseWithdrawalReservation,
} from '@/lib/payouts/withdrawal-finalize'
import { notifyAdminsWithdrawalEscalated, notifyWithdrawalOutcome } from '@/lib/notifications/withdrawal-outcome'

/** Rows handled per run (each costs one Digicel status call). */
export const RECONCILE_BATCH_SIZE = 25
/** How many candidate rows each query may scan before sorting oldest-first. */
const RECONCILE_SCAN_LIMIT = 300
/** A definitive failure / unknown reference is trusted only after this long since the attempt. */
/** `config/payouts.reconcile.autoReleaseNotFound` — off unless explicitly true. */
async function autoReleaseNotFoundEnabled(): Promise<boolean> {
  try {
    const snap = await adminDb.collection('config').doc('payouts').get()
    return (snap.exists ? snap.data() : null)?.reconcile?.autoReleaseNotFound === true
  } catch {
    return false
  }
}

export const RECONCILE_RELEASE_GRACE_MS = 30 * 60 * 1000
/** A `processing` instant row with no flag this old was abandoned mid-transfer. */
export const RECONCILE_STUCK_AFTER_MS = 10 * 60 * 1000
/** Escalate to an admin after this long unresolved... */
export const RECONCILE_ESCALATE_AFTER_MS = 24 * 60 * 60 * 1000
/** ...or after this many ambiguous checks (24h of a 10-minute cron). */
export const RECONCILE_ESCALATE_AFTER_ATTEMPTS = 144

export type StatusVerdict =
  | { verdict: 'successful'; transactionId: string; raw: any }
  | { verdict: 'failed'; detail: string; raw: any }
  | { verdict: 'not_found'; detail: string; raw: any }
  | { verdict: 'ambiguous'; detail: string; raw?: any }

const FAILED_STATUS = /^(failed|failure|rejected|declined|cancell?ed|reversed|expired)$/i
const NOT_FOUND = /not[\s_-]*found|does not exist|unknown reference|no transaction/i

/**
 * Turn a PrefundedTransactionStatus answer (or its error) into a verdict.
 * Pure, exported for tests. Only the transaction's own `transStatus` can say
 * "successful" — the envelope `message` reads "successful" whenever the API
 * call itself worked.
 */
export function classifyStatusCheck(input: { raw?: any; error?: unknown }): StatusVerdict {
  if (input.error !== undefined) {
    const message = String((input.error as any)?.message || input.error || '')
    const m = /MonCash REST request failed \((\d{3})\)/.exec(message)
    if (m && Number(m[1]) === 404) return { verdict: 'not_found', detail: message.slice(0, 500), raw: null }
    return { verdict: 'ambiguous', detail: message.slice(0, 500) }
  }

  const raw = input.raw ?? null
  const transStatus = String(raw?.transStatus ?? '').trim()
  if (/^successful$/i.test(transStatus)) {
    const transactionId = String(raw?.transaction_id || raw?.transactionId || raw?.transfer?.transaction_id || '')
    return { verdict: 'successful', transactionId, raw }
  }
  if (FAILED_STATUS.test(transStatus)) return { verdict: 'failed', detail: transStatus, raw }
  if (NOT_FOUND.test(transStatus) || (!transStatus && NOT_FOUND.test(String(raw?.message ?? '')))) {
    return { verdict: 'not_found', detail: transStatus || String(raw?.message), raw }
  }
  return { verdict: 'ambiguous', detail: transStatus || JSON.stringify(raw).slice(0, 500), raw }
}

export function toMillis(v: any): number | null {
  if (!v) return null
  if (v instanceof Date) return v.getTime()
  if (typeof v?.toDate === 'function') return v.toDate().getTime()
  if (typeof v?._seconds === 'number') return v._seconds * 1000
  if (typeof v?.seconds === 'number') return v.seconds * 1000
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** When the transfer was attempted: the reservation, else creation. */
function attemptedAtMs(row: any): number | null {
  return toMillis(row?.reservedAt) ?? toMillis(row?.createdAt) ?? toMillis(row?.updatedAt)
}

export type ReconcileAction =
  | 'completed'
  | 'released'
  | 'waiting_grace'
  | 'ambiguous'
  | 'escalated'
  | 'skipped'

export type ReconcileRunSummary = {
  scanned: number
  stuckFlagged: number
  processed: number
  results: Array<{ withdrawalId: string; action: ReconcileAction; detail?: string }>
}

/** Flag an abandoned `processing` row. Transactional so it never clobbers a row that just settled. */
async function flagStuckRow(withdrawalId: string, now: Date): Promise<boolean> {
  const ref = adminDb.collection('withdrawal_requests').doc(withdrawalId)
  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return false
    const row = snap.data() as any
    if (!isPrefundedInFlight(row) || row?.needsReconciliation === true) return false
    tx.set(
      ref,
      {
        needsReconciliation: true,
        reconciliationReason: 'stuck_processing: no outcome recorded (function ended mid-transfer)',
        reconciliationFlaggedAt: now,
        updatedAt: now,
      },
      { merge: true }
    )
    return true
  })
}

/** Record an inconclusive check; escalate once when the row has been open too long. */
async function recordAmbiguous(
  withdrawalId: string,
  detail: string,
  now: Date
): Promise<{ escalatedNow: boolean; row: any | null }> {
  const ref = adminDb.collection('withdrawal_requests').doc(withdrawalId)
  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { escalatedNow: false, row: null }
    const row = snap.data() as any
    if (!isPrefundedInFlight(row)) return { escalatedNow: false, row }

    const attempts = (Number(row?.reconciliationAttempts) || 0) + 1
    const attempted = attemptedAtMs(row)
    const openFor = attempted === null ? 0 : now.getTime() - attempted
    const shouldEscalate =
      attempts >= RECONCILE_ESCALATE_AFTER_ATTEMPTS || openFor >= RECONCILE_ESCALATE_AFTER_MS
    const escalatedNow = shouldEscalate && row?.reconciliationEscalated !== true

    const patch: Record<string, any> = {
      reconciliationAttempts: attempts,
      reconciliationLastCheckedAt: now,
      reconciliationLastStatus: detail.slice(0, 500),
      updatedAt: now,
    }
    if (escalatedNow) {
      patch.reconciliationEscalated = true
      patch.reconciliationEscalatedAt = now
    }
    tx.set(ref, patch, { merge: true })
    return { escalatedNow, row: { ...row, ...patch } }
  })
}

async function reconcileOne(withdrawalId: string, now: Date): Promise<{ action: ReconcileAction; detail?: string }> {
  const snap = await adminDb.collection('withdrawal_requests').doc(withdrawalId).get()
  if (!snap.exists) return { action: 'skipped', detail: 'not_found' }
  const row = snap.data() as any
  if (!isPrefundedInFlight(row)) return { action: 'skipped', detail: `status ${row?.status}` }

  let verdict: StatusVerdict
  try {
    const status = await moncashPrefundedTransactionStatus(withdrawalId)
    verdict = classifyStatusCheck({ raw: status.raw })
  } catch (err) {
    verdict = classifyStatusCheck({ error: err })
  }

  if (verdict.verdict === 'successful') {
    const res = await finalizeWithdrawalCompleted(withdrawalId, {
      transactionId: verdict.transactionId || null,
      confirmedVia: 'reconcile_cron',
      statusRaw: verdict.raw,
      now,
    })
    if (res.changed) {
      await notifyWithdrawalOutcome(withdrawalId, 'completed', { row: res.row, now })
      return { action: 'completed' }
    }
    if (res.reason === 'conflict') {
      await notifyAdminsWithdrawalEscalated(withdrawalId, res.row, now)
      return { action: 'escalated', detail: 'paid_after_release' }
    }
    return { action: 'skipped', detail: res.reason }
  }

  // "Not found" only proves money did NOT move if Digicel's status lookup
  // really indexes our reference. Until the first live transfer confirms that,
  // releasing on it risks a double payout, so it is opt-in: with the switch off
  // a not-found row is treated as inconclusive and escalates to an admin.
  if (verdict.verdict === 'not_found' && !(await autoReleaseNotFoundEnabled())) {
    const { escalatedNow, row: updated } = await recordAmbiguous(withdrawalId, `not_found (auto-release off): ${verdict.detail}`, now)
    if (escalatedNow) await notifyAdminsWithdrawalEscalated(withdrawalId, updated, now)
    return { action: escalatedNow ? 'escalated' : 'waiting_grace', detail: 'not_found_auto_release_off' }
  }

  if (verdict.verdict === 'failed' || verdict.verdict === 'not_found') {
    const attempted = attemptedAtMs(row)
    const age = attempted === null ? Infinity : now.getTime() - attempted
    if (age >= RECONCILE_RELEASE_GRACE_MS) {
      const res = await releaseWithdrawalReservation(withdrawalId, {
        reason:
          verdict.verdict === 'failed'
            ? `MonCash reported the transfer ${verdict.detail}`
            : 'MonCash has no record of this transfer',
        releasedBy: 'reconcile_cron',
        extra: { reconciliationStatusRaw: verdict.raw ?? null, reconciledAt: now },
        now,
      })
      if (res.changed) {
        await notifyWithdrawalOutcome(withdrawalId, 'failed', { row: res.row, now })
        return { action: 'released', detail: verdict.verdict }
      }
      return { action: 'skipped', detail: res.reason }
    }
    // Too early to trust "unknown": count it like any inconclusive check.
    const { escalatedNow, row: updated } = await recordAmbiguous(withdrawalId, `${verdict.verdict} (within grace)`, now)
    if (escalatedNow) await notifyAdminsWithdrawalEscalated(withdrawalId, updated, now)
    return { action: 'waiting_grace', detail: verdict.detail }
  }

  const { escalatedNow, row: updated } = await recordAmbiguous(withdrawalId, verdict.detail, now)
  if (escalatedNow) {
    await notifyAdminsWithdrawalEscalated(withdrawalId, updated, now)
    return { action: 'escalated', detail: verdict.detail }
  }
  return { action: 'ambiguous', detail: verdict.detail }
}

/**
 * One cron pass. Candidates: rows flagged `needsReconciliation`, plus instant
 * rows stuck `processing` past RECONCILE_STUCK_AFTER_MS. Oldest attempt first,
 * RECONCILE_BATCH_SIZE per run.
 *
 * Queries are single-field equality (no composite index needed) and sorted in
 * memory — withdrawal_requests has one created-at field (`createdAt`), but not
 * every writer used the same type, so ordering is done on the parsed value.
 */
export async function runWithdrawalReconciliation(opts: { now?: Date; batchSize?: number } = {}): Promise<ReconcileRunSummary> {
  const now = opts.now || new Date()
  const batchSize = opts.batchSize ?? RECONCILE_BATCH_SIZE
  const col = adminDb.collection('withdrawal_requests')

  const [flaggedSnap, processingSnap] = await Promise.all([
    col.where('needsReconciliation', '==', true).limit(RECONCILE_SCAN_LIMIT).get(),
    col.where('status', '==', 'processing').limit(RECONCILE_SCAN_LIMIT).get(),
  ])

  const candidates = new Map<string, any>()
  for (const d of flaggedSnap.docs) {
    const row = d.data()
    if (isPrefundedInFlight(row)) candidates.set(d.id, row)
  }

  let stuckFlagged = 0
  for (const d of processingSnap.docs) {
    const row = d.data()
    if (candidates.has(d.id) || !isPrefundedInFlight(row) || row?.needsReconciliation === true) continue
    const since = toMillis(row?.updatedAt) ?? attemptedAtMs(row)
    if (since === null || now.getTime() - since < RECONCILE_STUCK_AFTER_MS) continue
    if (await flagStuckRow(d.id, now)) {
      stuckFlagged++
      candidates.set(d.id, { ...row, needsReconciliation: true })
      // They never heard anything: the request died before answering them.
      await notifyWithdrawalOutcome(d.id, 'confirming', { row, now })
    }
  }

  const ordered = Array.from(candidates.entries())
    .sort(([, a], [, b]) => (attemptedAtMs(a) ?? 0) - (attemptedAtMs(b) ?? 0))
    .slice(0, batchSize)

  const results: ReconcileRunSummary['results'] = []
  for (const [withdrawalId] of ordered) {
    try {
      const r = await reconcileOne(withdrawalId, now)
      results.push({ withdrawalId, ...r })
    } catch (err: any) {
      console.error('[withdrawal-reconcile] row failed', { withdrawalId, message: err?.message })
      results.push({ withdrawalId, action: 'skipped', detail: `error: ${String(err?.message || err)}` })
    }
  }

  return { scanned: candidates.size, stuckFlagged, processed: results.length, results }
}
