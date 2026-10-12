import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email'
import { renderEmail, title, p, gap, button, appUrl } from '@/lib/email-kit/layout'
import { FX_SNAPSHOT_DOC } from '@/lib/payouts/fx-rates'
import { fetchLiveUsdHtgRate } from '@/lib/fx/usd-htg'
import { OPS_EVENTS_COLLECTION, type OpsEvent } from '@/lib/ops/ops-events'
import {
  describeFinding,
  evaluateFxMoncashHealth,
  opsAlertRecipients,
} from '@/lib/ops/fx-moncash-monitor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG = '[cron/fx-moncash-monitor]'

/**
 * Daily FX / MonCash monitor.
 *
 * Schedule: vercel.json → "30 5 * * *" (30 minutes after the fx-snapshot cron).
 * Checks the previous 24h (lib/ops/fx-moncash-monitor.ts): snapshot freshness and
 * plausibility, snapshot-fallback / no-rate refusals and MonCash buyer errors
 * (from `ops_events`), MonCash orders stuck past 24h, and live-vs-snapshot drift.
 *
 * Anything abnormal → ONE summary email to OPS_ALERT_EMAILS (default: the three
 * owners). A clean day sends nothing. Idempotent per UTC day: the run is claimed
 * with `create()` on ops_monitor_runs/fx-moncash-{day}, so a retry or a second
 * trigger does not send a second email.
 */
export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date()
    const sinceIso = new Date(now.getTime() - 24 * 3_600_000).toISOString()

    const [snapshotDoc, eventsSnap, pendingSnap, live] = await Promise.all([
      adminDb.collection('platform_settings').doc(FX_SNAPSHOT_DOC).get(),
      adminDb.collection(OPS_EVENTS_COLLECTION).where('at', '>=', sinceIso).get(),
      // Same in-memory filtering the reconcile cron uses: `created_at` is not a
      // reliable orderBy/range field across this collection.
      adminDb.collection('pending_transactions').where('status', 'in', ['pending', 'processing']).get(),
      fetchLiveUsdHtgRate().then(
        (r) => ({ baseRate: r.baseRate }),
        (e: any) => ({ error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) })
      ),
    ])

    const report = evaluateFxMoncashHealth({
      now,
      latestSnapshot: snapshotDoc.exists ? (snapshotDoc.data() as any) : null,
      events: eventsSnap.docs.map((d: any) => d.data() as OpsEvent),
      pendingOrders: pendingSnap.docs.map((d: any) => d.data()),
      live,
    })

    if (report.ok) {
      console.info(`${LOG} clean`, report.metrics)
      return NextResponse.json({ success: true, ok: true, metrics: report.metrics })
    }

    const day = now.toISOString().slice(0, 10)
    const runRef = adminDb.collection('ops_monitor_runs').doc(`fx-moncash-${day}`)
    try {
      await runRef.create({ day, at: now.toISOString(), findings: report.findings, metrics: report.metrics })
    } catch (e: any) {
      // ALREADY_EXISTS (gRPC 6): today's alert was already sent.
      if (e?.code === 6 || /already exists/i.test(String(e?.message || ''))) {
        return NextResponse.json({ success: true, ok: false, skipped: 'already_alerted_today' })
      }
      throw e
    }

    const recipients = opsAlertRecipients()
    const critical = report.findings.filter((f) => f.severity === 'critical').length
    const subject = `[Tikèm ops] FX / MonCash: ${report.findings.length} issue(s)${critical ? `, ${critical} critical` : ''} (${day})`
    const html = renderEmail({
      lang: 'en',
      title: 'FX / MonCash daily check',
      preheader: report.findings.map((f) => f.summary).join(' '),
      status: { label: critical ? 'Needs attention' : 'Heads up', tone: 'amber' },
      footer: 'account',
      blocks: [
        title('FX / MonCash daily check', 30),
        gap(14),
        p(`Last 24h, checked ${now.toISOString()}.`),
        ...report.findings.flatMap((f) => [gap(10), p(describeFinding(f))]),
        gap(14),
        p(
          `Snapshot age: ${report.metrics.snapshotAgeHours === null ? 'n/a' : `${report.metrics.snapshotAgeHours.toFixed(1)}h`} · ` +
            `snapshot rate: ${report.metrics.snapshotBaseRate ?? 'n/a'} · live rate: ${report.metrics.liveBaseRate ?? 'n/a'}`
        ),
        gap(24),
        button('Open admin', `${appUrl()}/admin`),
      ],
    })

    const results = await Promise.all(
      recipients.map((to) =>
        sendEmail({ to, subject, html }).catch((err: any) => {
          console.error(`${LOG} alert email failed`, { to, message: err?.message })
          return { success: false } as { success: boolean }
        })
      )
    )
    const sent = results.filter((r: any) => r?.success).length
    if (sent === 0) {
      // Nothing went out: release today's claim so the next trigger retries.
      await runRef.delete().catch(() => {})
    } else {
      await runRef.set({ emailedTo: recipients, sent }, { merge: true })
    }

    return NextResponse.json({ success: true, ok: false, findings: report.findings, sent })
  } catch (error: any) {
    console.error(`${LOG} failed`, error)
    return NextResponse.json({ success: false, error: error?.message || 'Monitor failed' }, { status: 500 })
  }
}
