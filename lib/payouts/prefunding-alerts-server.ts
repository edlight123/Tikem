/**
 * Server side of the prefunding ops emails and the request log's automatic
 * confirmation. Called by /api/cron/prefunding-brief and
 * /api/cron/prefunding-refresh. Emails go to OPS_ALERT_EMAILS only (the same
 * list as the daily FX / MonCash monitor) — never to Digicel.
 */

import { adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email'
import { opsAlertRecipients } from '@/lib/ops/fx-moncash-monitor'
import { poolBelowMinimumNeed } from '@/lib/payouts/prefunding-plan'
import {
  buildLowBalanceEmail,
  lowBalanceRunId,
} from '@/lib/payouts/prefunding-notify'
import {
  loadPrefundingPlan,
  loadPrefundingSettings,
  readCachedMinimumNeed,
  PREFUNDING_REQUESTS_COLLECTION,
  type PoolBalanceReading,
} from '@/lib/payouts/prefunding-plan-server'

const LOG = '[prefunding-alerts]'

/** Send one email to every ops recipient; returns how many went out. */
export async function sendOpsEmail(subject: string, html: string): Promise<{ sent: number; recipients: string[] }> {
  const recipients = opsAlertRecipients()
  const results = await Promise.all(
    recipients.map((to) =>
      sendEmail({ to, subject, html }).catch((err: any) => {
        console.error(`${LOG} email failed`, { to, message: err?.message })
        return { success: false } as { success: boolean }
      })
    )
  )
  return { sent: results.filter((r: any) => r?.success).length, recipients }
}

/** Claim an ops_monitor_runs doc; false when it already exists (already sent). */
export async function claimRun(id: string, data: Record<string, any>): Promise<boolean> {
  try {
    await adminDb.collection('ops_monitor_runs').doc(id).create(data)
    return true
  } catch (e: any) {
    if (e?.code === 6 || /already exists/i.test(String(e?.message || ''))) return false
    throw e
  }
}

export async function releaseRun(id: string): Promise<void> {
  await adminDb.collection('ops_monitor_runs').doc(id).delete().catch(() => {})
}

/**
 * At most once per Haiti day: email ops when the live pool is below what the
 * next N business days of payouts need. Cheap on the common path — it compares
 * against the cached need and only recomputes the plan when the cache is stale
 * or the pool looks short.
 */
export async function maybeSendLowBalanceAlert(args: {
  now: Date
  balance: PoolBalanceReading
}): Promise<{ sent?: number; skipped?: string }> {
  const { now, balance } = args
  if (balance.balanceHtg === null) return { skipped: 'balance_unknown' }

  const runId = lowBalanceRunId(now)
  const existing = await adminDb.collection('ops_monitor_runs').doc(runId).get()
  if (existing.exists) return { skipped: 'already_alerted_today' }

  const { config } = await loadPrefundingSettings()
  const cachedNeed = await readCachedMinimumNeed(config.alertPlanMaxAgeHours, now)
  if (cachedNeed !== null && Math.round(balance.balanceHtg * 100) >= cachedNeed) return { skipped: 'pool_covers_minimum' }

  const { plan } = await loadPrefundingPlan({ now, balance })
  if (!poolBelowMinimumNeed(plan)) return { skipped: 'pool_covers_minimum' }

  if (!(await claimRun(runId, { at: now.toISOString(), balanceHtg: balance.balanceHtg, needMinor: plan.minimum.poolNeedMinor }))) {
    return { skipped: 'already_alerted_today' }
  }
  const { subject, html } = buildLowBalanceEmail(plan)
  const { sent, recipients } = await sendOpsEmail(subject, html)
  if (sent === 0) await releaseRun(runId)
  else await adminDb.collection('ops_monitor_runs').doc(runId).set({ emailedTo: recipients, sent }, { merge: true })
  return { sent }
}

/**
 * A request marked 'sent' is confirmed 'completed' once the pool balance rises
 * above what it was when the request was sent (or generated). Payouts in the
 * meantime can mask a small top-up; an admin can still confirm by hand.
 */
export async function autoConfirmSentRequests(args: { now: Date; balanceHtg: number | null }): Promise<number> {
  if (args.balanceHtg === null) return 0
  const snap = await adminDb.collection(PREFUNDING_REQUESTS_COLLECTION).where('status', '==', 'sent').get()
  let confirmed = 0
  for (const doc of snap.docs) {
    const r = (doc.data() as any) || {}
    const baseline = Number(r.balanceAtSentHtg ?? r.balanceAtGenerationHtg)
    if (!Number.isFinite(baseline)) continue
    if (args.balanceHtg > baseline) {
      await doc.ref.set(
        {
          status: 'completed',
          completedAt: args.now.toISOString(),
          completedBy: 'cron:prefunding-refresh',
          confirmedVia: 'balance_rise',
          balanceAtCompletionHtg: args.balanceHtg,
          updatedAt: args.now.toISOString(),
        },
        { merge: true }
      )
      confirmed += 1
    }
  }
  return confirmed
}
