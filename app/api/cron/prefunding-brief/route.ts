import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { buildBriefEmail, briefRunId, isBriefHour } from '@/lib/payouts/prefunding-notify'
import { loadPrefundingPlan } from '@/lib/payouts/prefunding-plan-server'
import { claimRun, releaseRun, sendOpsEmail } from '@/lib/payouts/prefunding-alerts-server'
import { adminDb } from '@/lib/firebase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG = '[cron/prefunding-brief]'

/**
 * Monday 8:00 AM (Haiti) MonCash prefunding brief to OPS_ALERT_EMAILS.
 *
 * Schedule: vercel.json → "0 12,13 * * 1". Haiti is UTC-4 in summer (EDT) and
 * UTC-5 in winter (EST); the route sends only on the run where it is 8 AM in
 * Port-au-Prince, so exactly one of the two fires. `?force=1` (still behind
 * CRON_SECRET) sends outside that hour for a manual run.
 *
 * Read-only toward money and Digicel: it emails the three numbers, the
 * warnings and a link to /admin/money/moncash-funding. Idempotent per Haiti day.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const now = new Date()
    const force = new URL(request.url).searchParams.get('force') === '1'
    if (!force && !isBriefHour(now)) {
      return NextResponse.json({ success: true, skipped: 'not_brief_hour_in_haiti' })
    }

    const runId = briefRunId(now)
    if (!(await claimRun(runId, { at: now.toISOString(), kind: 'prefunding-brief' }))) {
      return NextResponse.json({ success: true, skipped: 'already_sent_today' })
    }

    try {
      const { plan } = await loadPrefundingPlan({ now })
      const { subject, html } = buildBriefEmail(plan)
      const { sent, recipients } = await sendOpsEmail(subject, html)
      if (sent === 0) {
        // Nothing went out: release the claim so a retry can send.
        await releaseRun(runId)
      } else {
        await adminDb.collection('ops_monitor_runs').doc(runId).set(
          {
            emailedTo: recipients,
            sent,
            minimumHtg: plan.minimum.amountHtg,
            recommendedHtg: plan.recommended.amountHtg,
            maximumHtg: plan.maximum.amountHtg,
          },
          { merge: true }
        )
      }
      return NextResponse.json({
        success: true,
        sent,
        minimumHtg: plan.minimum.amountHtg,
        recommendedHtg: plan.recommended.amountHtg,
        maximumHtg: plan.maximum.amountHtg,
        warnings: plan.warnings.map((w) => w.code),
      })
    } catch (e) {
      await releaseRun(runId)
      throw e
    }
  } catch (error: any) {
    console.error(`${LOG} failed`, error)
    return NextResponse.json({ success: false, error: error?.message || 'Brief failed' }, { status: 500 })
  }
}
