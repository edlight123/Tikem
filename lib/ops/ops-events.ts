/**
 * Cheap, queryable operational breadcrumbs for the daily FX / MonCash monitor
 * (/api/cron/fx-moncash-monitor).
 *
 * One small doc per event in `ops_events`: { type, at (ISO), route, detail }.
 * Written BEST-EFFORT: a failed write is logged and swallowed, and callers
 * schedule it with `after()` so a buyer's checkout never waits on it.
 */

import { after } from 'next/server'

export const OPS_EVENTS_COLLECTION = 'ops_events'

export type OpsEventType =
  /** A USD→HTG conversion used the 14-day snapshot fallback instead of the live rate. */
  | 'fx_snapshot_fallback'
  /** A checkout/quote/withdrawal was refused: no trustworthy USD→HTG rate. */
  | 'fx_rate_unavailable'
  /** MonCash initiate/checkout returned a server error to a buyer. */
  | 'moncash_buyer_error'

export type OpsEvent = {
  type: OpsEventType
  at: string
  route: string
  detail?: Record<string, unknown> | null
}

export async function recordOpsEvent(
  type: OpsEventType,
  route: string,
  detail?: Record<string, unknown> | null
): Promise<void> {
  try {
    const { adminDb } = await import('@/lib/firebase/admin')
    const row: OpsEvent = { type, at: new Date().toISOString(), route, detail: detail ?? null }
    await adminDb.collection(OPS_EVENTS_COLLECTION).add(row)
  } catch (err: any) {
    console.warn('[ops-events] could not record', { type, route, message: err?.message })
  }
}

/**
 * Record after the response is sent (`after()`), so the request never waits.
 * Outside a request scope (scripts, tests) it falls back to fire-and-forget.
 */
export function scheduleOpsEvent(
  type: OpsEventType,
  route: string,
  detail?: Record<string, unknown> | null
): void {
  try {
    after(() => recordOpsEvent(type, route, detail))
  } catch {
    void recordOpsEvent(type, route, detail)
  }
}
