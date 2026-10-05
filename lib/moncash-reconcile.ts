/**
 * Candidate selection for the MonCash reconcile cron (app/api/cron/moncash-reconcile).
 * Pure, so the rules for which orders get re-asked are unit tested directly.
 */

/**
 * The gateway payment token lives ten minutes. Wait past that before touching an
 * order, so we can never race a buyer who is still staring at the OTP screen.
 */
export const SETTLE_GRACE_MS = 12 * 60 * 1000

/** Past this the gateway no longer knows the order; stop asking. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000


/**
 * A FAILED order is re-asked for this long. The return handler records "not paid"
 * whenever the buyer comes back before Digicel has settled (back button, closed OTP
 * screen, a slow ledger), so `failed` there is "not paid yet", not a verdict.
 */
export const FAILED_RECHECK_MAX_AGE_MS = 48 * 60 * 60 * 1000

/** How many times one failed order is re-asked before we stop. */
export const FAILED_RECHECK_MAX_ATTEMPTS = 6

/**
 * A `processing` claim this old was abandoned mid-fulfilment (crash, timeout). The
 * claim itself goes stale after 90s; this leaves a wide margin before we touch it.
 */
export const PROCESSING_STALE_MS = 10 * 60 * 1000

/** Failure reasons that are OUR verdicts on a paid order, never re-fulfilled here. */
const TERMINAL_FAILURE_REASONS = new Set(['amount_mismatch', 'capacity_exceeded', 'invalid_quantity'])

export type ReconcileCandidate = { tx: Record<string, any>; kind: 'pending' | 'failed' | 'processing' }

function msFrom(raw: unknown): number {
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (raw && typeof (raw as any).toDate === 'function') return (raw as any).toDate().getTime()
  if (typeof raw === 'number') return raw
  return 0
}

/**
 * Which rows this run should ask Digicel about. 
 *
 *  - pending: past the token grace window, younger than MAX_AGE
 *  - failed:  a GATEWAY "not paid" answer (not one of our refund verdicts), recent,
 *             not yet re-asked too often
 *  - processing: a fulfilment claim abandoned long ago
 * An order flagged `needs_refund` is never a candidate.
 */
export function selectReconcileCandidates(rows: Array<Record<string, any>>, now: number): ReconcileCandidate[] {
  const out: ReconcileCandidate[] = []
  for (const tx of rows || []) {
    if (!tx?.order_id || !monCashMethod(tx)) continue
    if (tx.needs_refund === true || tx.needs_review === true) continue
    const age = now - createdAtMs(tx)
    const status = String(tx.status || '').toLowerCase()
    if (status === 'pending') {
      if (age >= SETTLE_GRACE_MS && age <= MAX_AGE_MS) out.push({ tx, kind: 'pending' })
    } else if (status === 'failed') {
      const reason = String(tx.failure_reason || '')
      if (TERMINAL_FAILURE_REASONS.has(reason)) continue
      // Rows written before `failure_source` existed only ever got a gateway reason.
      if (tx.failure_source && tx.failure_source !== 'gateway_not_paid') continue
      if (Number(tx.reconcile_attempts || 0) >= FAILED_RECHECK_MAX_ATTEMPTS) continue
      if (age >= SETTLE_GRACE_MS && age <= FAILED_RECHECK_MAX_AGE_MS) out.push({ tx, kind: 'failed' })
    } else if (status === 'processing') {
      const startedAt = msFrom(tx.fulfillment_started_at)
      if (startedAt > 0 && now - startedAt >= PROCESSING_STALE_MS && age <= MAX_AGE_MS) {
        out.push({ tx, kind: 'processing' })
      }
    }
  }
  const order = { processing: 0, pending: 1, failed: 2 } as const
  return out.sort(
    (a, b) => order[a.kind] - order[b.kind] || createdAtMs(a.tx) - createdAtMs(b.tx)
  )
}

/** Only the MonCash REST rail. NatCash settles through the button middleware. */
export function monCashMethod(tx: Record<string, any>): 'moncash' | 'moncash_button' | null {
  const provider = String(tx?.mobile_money_provider || '').toLowerCase()
  if (provider === 'natcash') return null

  const method = String(tx?.payment_method || provider || '').toLowerCase()
  if (method === 'moncash') return 'moncash'
  if (method === 'moncash_button') return 'moncash_button'
  return null
}

export function createdAtMs(tx: Record<string, any>): number {
  const raw = tx?.created_at
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (raw && typeof raw.toDate === 'function') return raw.toDate().getTime()
  if (typeof raw === 'number') return raw
  return 0
}
