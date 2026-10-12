/**
 * Daily FX / MonCash health check — the pure half of /api/cron/fx-moncash-monitor.
 *
 * The route fetches; this decides. Given the latest FX snapshot, the last 24h of
 * `ops_events`, the MonCash pending orders and one raw live provider read, it
 * returns the findings worth an email. No findings → no email.
 */
import { usdHtgBaseRateFromSnapshot } from '@/lib/fx/usd-htg'
import type { OpsEvent } from '@/lib/ops/ops-events'
import { createdAtMs, monCashMethod } from '@/lib/moncash-reconcile'

const HOUR = 3_600_000

/** No snapshot for longer than this = the fx-snapshot cron is broken. */
export const SNAPSHOT_STALE_HOURS = 36
/** An order still unpaid/unfulfilled this long after creation is "stuck". */
export const STUCK_ORDER_HOURS = 24
/** Live vs snapshot gap worth a look (checkout refuses beyond 15% of the median). */
export const LIVE_DRIFT_ALERT_RATIO = 0.05

export type MonitorFinding = {
  key:
    | 'snapshot_missing'
    | 'snapshot_stale'
    | 'snapshot_htg_rejected'
    | 'snapshot_htg_missing'
    | 'fx_fallback_used'
    | 'fx_rate_unavailable'
    | 'moncash_buyer_errors'
    | 'moncash_orders_stuck'
    | 'live_rate_unreachable'
    | 'live_snapshot_drift'
  severity: 'warning' | 'critical'
  summary: string
  count?: number
  detail?: Record<string, unknown>
}

export type MonitorInput = {
  now: Date
  /** platform_settings/fx_snapshot (the latest), or null. */
  latestSnapshot: Record<string, any> | null
  /** ops_events of the last 24h. */
  events: OpsEvent[]
  /** pending_transactions rows (any status; filtered here). */
  pendingOrders: Array<Record<string, any>>
  /** One raw provider read, or the error it produced. */
  live: { baseRate: number } | { error: string }
}

export type MonitorReport = {
  ok: boolean
  findings: MonitorFinding[]
  metrics: {
    snapshotAgeHours: number | null
    snapshotBaseRate: number | null
    liveBaseRate: number | null
    driftRatio: number | null
    eventsByType: Record<string, number>
    stuckOrders: number
  }
}

function countBy<T>(items: T[], keyOf: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) out[keyOf(item)] = (out[keyOf(item)] || 0) + 1
  return out
}

export function evaluateFxMoncashHealth(input: MonitorInput): MonitorReport {
  const nowMs = input.now.getTime()
  const findings: MonitorFinding[] = []

  // ── Snapshot freshness and plausibility ─────────────────────────────────
  const snap = input.latestSnapshot
  let snapshotAgeHours: number | null = null
  let snapshotBaseRate: number | null = null
  if (!snap) {
    findings.push({ key: 'snapshot_missing', severity: 'critical', summary: 'No FX snapshot exists at all.' })
  } else {
    const fetchedMs = Date.parse(String(snap.fetchedAt || ''))
    snapshotAgeHours = Number.isNaN(fetchedMs) ? null : (nowMs - fetchedMs) / HOUR
    if (snapshotAgeHours === null || snapshotAgeHours > SNAPSHOT_STALE_HOURS) {
      findings.push({
        key: 'snapshot_stale',
        severity: 'critical',
        summary:
          snapshotAgeHours === null
            ? 'The FX snapshot has an unreadable timestamp.'
            : `The last FX snapshot is ${Math.round(snapshotAgeHours)}h old (alert above ${SNAPSHOT_STALE_HOURS}h). The fx-snapshot cron may be failing.`,
      })
    }
    if (snap.rejected && snap.rejected.HTG !== undefined) {
      findings.push({
        key: 'snapshot_htg_rejected',
        severity: 'warning',
        summary: 'The latest snapshot flagged the provider HTG rate as implausible and kept the previous one.',
        detail: { rejectedUsdPerHtg: snap.rejected.HTG },
      })
    }
    if (Array.isArray(snap.missing) && snap.missing.map((c: any) => String(c).toUpperCase()).includes('HTG')) {
      findings.push({ key: 'snapshot_htg_missing', severity: 'warning', summary: 'The provider did not return HTG in the latest snapshot.' })
    }
    snapshotBaseRate = usdHtgBaseRateFromSnapshot(snap)
  }

  // ── What buyers / organizers hit in the last 24h ────────────────────────
  const since = nowMs - 24 * HOUR
  const recent = (input.events || []).filter((e) => {
    const at = Date.parse(String(e?.at || ''))
    return !Number.isNaN(at) && at >= since && at <= nowMs
  })
  const eventsByType = countBy(recent, (e) => e.type)
  const routesOf = (type: string) => countBy(recent.filter((e) => e.type === type), (e) => e.route || 'unknown')

  if (eventsByType.fx_snapshot_fallback) {
    findings.push({
      key: 'fx_fallback_used',
      severity: 'warning',
      count: eventsByType.fx_snapshot_fallback,
      summary: `${eventsByType.fx_snapshot_fallback} conversion(s) used the 14-day snapshot fallback instead of the live rate.`,
      detail: { byRoute: routesOf('fx_snapshot_fallback') },
    })
  }
  if (eventsByType.fx_rate_unavailable) {
    findings.push({
      key: 'fx_rate_unavailable',
      severity: 'critical',
      count: eventsByType.fx_rate_unavailable,
      summary: `${eventsByType.fx_rate_unavailable} checkout/quote/withdrawal attempt(s) were refused: no trustworthy USD→HTG rate.`,
      detail: { byRoute: routesOf('fx_rate_unavailable') },
    })
  }
  if (eventsByType.moncash_buyer_error) {
    findings.push({
      key: 'moncash_buyer_errors',
      severity: 'critical',
      count: eventsByType.moncash_buyer_error,
      summary: `${eventsByType.moncash_buyer_error} MonCash initiate/checkout request(s) failed with a server error.`,
      detail: { byRoute: routesOf('moncash_buyer_error') },
    })
  }

  // ── MonCash orders stuck unpaid / unfulfilled ───────────────────────────
  // Only orders that CROSSED the 24h mark in the last day, so each one is
  // reported once rather than every morning forever.
  const stuck = (input.pendingOrders || []).filter((tx) => {
    if (!monCashMethod(tx)) return false
    const status = String(tx.status || '').toLowerCase()
    if (status !== 'pending' && status !== 'processing') return false
    const age = nowMs - createdAtMs(tx)
    return age > STUCK_ORDER_HOURS * HOUR && age <= (STUCK_ORDER_HOURS + 24) * HOUR
  })
  if (stuck.length) {
    findings.push({
      key: 'moncash_orders_stuck',
      severity: stuck.some((tx) => String(tx.status).toLowerCase() === 'processing') ? 'critical' : 'warning',
      count: stuck.length,
      summary: `${stuck.length} MonCash order(s) are still unpaid/unfulfilled more than ${STUCK_ORDER_HOURS}h after checkout started.`,
      detail: {
        byStatus: countBy(stuck, (tx) => String(tx.status || 'unknown').toLowerCase()),
        orderIds: stuck.slice(0, 20).map((tx) => String(tx.order_id)),
      },
    })
  }

  // ── Live provider vs snapshot ───────────────────────────────────────────
  let liveBaseRate: number | null = null
  let driftRatio: number | null = null
  if ('error' in input.live) {
    findings.push({
      key: 'live_rate_unreachable',
      severity: 'warning',
      summary: `The live FX provider did not answer cleanly: ${input.live.error}`,
    })
  } else {
    liveBaseRate = input.live.baseRate
    if (snapshotBaseRate && liveBaseRate > 0) {
      driftRatio = Math.abs(liveBaseRate - snapshotBaseRate) / snapshotBaseRate
      if (driftRatio > LIVE_DRIFT_ALERT_RATIO) {
        findings.push({
          key: 'live_snapshot_drift',
          severity: driftRatio > 0.15 ? 'critical' : 'warning',
          summary: `Live USD→HTG ${liveBaseRate.toFixed(2)} is ${(driftRatio * 100).toFixed(1)}% from the snapshot's ${snapshotBaseRate.toFixed(2)}.`,
        })
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    metrics: { snapshotAgeHours, snapshotBaseRate, liveBaseRate, driftRatio, eventsByType, stuckOrders: stuck.length },
  }
}

/** Plain-text-ish lines for the email body. */
export function describeFinding(f: MonitorFinding): string {
  const extra = f.detail ? ` ${JSON.stringify(f.detail)}` : ''
  return `[${f.severity.toUpperCase()}] ${f.summary}${extra}`
}

/** Default ops recipients (owner decision 2026-10-12); OPS_ALERT_EMAILS overrides. */
export const DEFAULT_OPS_ALERT_EMAILS = [
  'stevenson.michel@edlight.org',
  'fredler.pierre-louis@edlight.org',
  'ted.jacquet@edlight.org',
]

export function opsAlertRecipients(env: string | undefined = process.env.OPS_ALERT_EMAILS): string[] {
  const fromEnv = String(env || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
  return fromEnv.length ? fromEnv : DEFAULT_OPS_ALERT_EMAILS
}
