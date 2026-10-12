/**
 * @jest-environment node
 *
 * The daily FX / MonCash monitor's decision (lib/ops/fx-moncash-monitor.ts):
 * pure over what the cron fetched. A clean day must produce no findings.
 */
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))

import {
  DEFAULT_OPS_ALERT_EMAILS,
  evaluateFxMoncashHealth,
  opsAlertRecipients,
  type MonitorInput,
} from '@/lib/ops/fx-moncash-monitor'

const NOW = new Date('2026-10-12T05:30:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const clean = (): MonitorInput => ({
  now: NOW,
  latestSnapshot: { fetchedAt: hoursAgo(0.5), baseRates: { HTG: 131 }, rates: { HTG: 1 / 131 }, thresholdCurrency: 'USD' },
  events: [],
  pendingOrders: [],
  live: { baseRate: 131.4 },
})

const keys = (input: MonitorInput) => evaluateFxMoncashHealth(input).findings.map((f) => f.key)

describe('evaluateFxMoncashHealth', () => {
  it('a clean day has no findings (so no email)', () => {
    const r = evaluateFxMoncashHealth(clean())
    expect(r.ok).toBe(true)
    expect(r.findings).toEqual([])
    expect(r.metrics.driftRatio).toBeCloseTo(0.4 / 131, 6)
  })

  it('flags a missing or >36h-old snapshot', () => {
    expect(keys({ ...clean(), latestSnapshot: null })).toContain('snapshot_missing')
    expect(keys({ ...clean(), latestSnapshot: { ...clean().latestSnapshot, fetchedAt: hoursAgo(37) } })).toContain('snapshot_stale')
    expect(keys({ ...clean(), latestSnapshot: { ...clean().latestSnapshot, fetchedAt: hoursAgo(30) } })).toEqual([])
  })

  it('flags an HTG rate the snapshot cron rejected as implausible, or did not get', () => {
    const snap = { ...clean().latestSnapshot, rejected: { HTG: 1 }, missing: ['HTG'] }
    expect(keys({ ...clean(), latestSnapshot: snap })).toEqual(
      expect.arrayContaining(['snapshot_htg_rejected', 'snapshot_htg_missing'])
    )
  })

  it('counts fallbacks, no-rate refusals and MonCash buyer errors from the last 24h only', () => {
    const r = evaluateFxMoncashHealth({
      ...clean(),
      events: [
        { type: 'fx_snapshot_fallback', at: hoursAgo(1), route: 'moncash-button/initiate' },
        { type: 'fx_snapshot_fallback', at: hoursAgo(2), route: 'moncash-button/quote' },
        { type: 'fx_rate_unavailable', at: hoursAgo(3), route: 'organizer/withdraw-moncash' },
        { type: 'moncash_buyer_error', at: hoursAgo(4), route: 'moncash-button/checkout' },
        { type: 'moncash_buyer_error', at: hoursAgo(30), route: 'moncash-button/checkout' }, // too old
      ],
    })
    const byKey = Object.fromEntries(r.findings.map((f) => [f.key, f]))
    expect(byKey.fx_fallback_used.count).toBe(2)
    expect(byKey.fx_fallback_used.detail).toEqual({ byRoute: { 'moncash-button/initiate': 1, 'moncash-button/quote': 1 } })
    expect(byKey.fx_rate_unavailable).toMatchObject({ count: 1, severity: 'critical' })
    expect(byKey.moncash_buyer_errors.count).toBe(1)
  })

  it('reports MonCash orders that crossed 24h unpaid/unfulfilled, once', () => {
    const r = evaluateFxMoncashHealth({
      ...clean(),
      pendingOrders: [
        { order_id: '1', status: 'pending', payment_method: 'moncash', created_at: hoursAgo(25) },
        { order_id: '2', status: 'processing', payment_method: 'moncash', created_at: hoursAgo(30) },
        { order_id: '3', status: 'pending', payment_method: 'moncash', created_at: hoursAgo(5) }, // too fresh
        { order_id: '4', status: 'pending', payment_method: 'moncash', created_at: hoursAgo(80) }, // reported before
        { order_id: '5', status: 'pending', payment_method: 'moncash', mobile_money_provider: 'natcash', created_at: hoursAgo(25) },
        { order_id: '6', status: 'completed', payment_method: 'moncash', created_at: hoursAgo(25) },
      ],
    })
    const stuck = r.findings.find((f) => f.key === 'moncash_orders_stuck')!
    expect(stuck.count).toBe(2)
    expect(stuck.severity).toBe('critical')
    expect(stuck.detail?.orderIds).toEqual(['1', '2'])
  })

  it('flags an unreachable live provider and a live-vs-snapshot drift', () => {
    expect(keys({ ...clean(), live: { error: 'timeout' } })).toEqual(['live_rate_unreachable'])
    const drift = evaluateFxMoncashHealth({ ...clean(), live: { baseRate: 140 } })
    expect(drift.findings.map((f) => f.key)).toEqual(['live_snapshot_drift'])
    expect(drift.findings[0].severity).toBe('warning')
    expect(evaluateFxMoncashHealth({ ...clean(), live: { baseRate: 160 } }).findings[0].severity).toBe('critical')
  })
})

describe('opsAlertRecipients', () => {
  it('defaults to the three owners and honours OPS_ALERT_EMAILS', () => {
    expect(opsAlertRecipients('')).toEqual(DEFAULT_OPS_ALERT_EMAILS)
    expect(DEFAULT_OPS_ALERT_EMAILS).toEqual([
      'stevenson.michel@edlight.org',
      'fredler.pierre-louis@edlight.org',
      'ted.jacquet@edlight.org',
    ])
    expect(opsAlertRecipients(' a@x.co , b@y.co ')).toEqual(['a@x.co', 'b@y.co'])
  })
})
