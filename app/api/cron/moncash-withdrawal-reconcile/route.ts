import { NextResponse } from 'next/server'
import { runWithdrawalReconciliation } from '@/lib/payouts/withdrawal-reconcile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * MonCash Withdrawal Reconciliation Cron
 *
 * Re-asks PrefundedTransactionStatus about instant withdrawals whose outcome is
 * unknown (`needsReconciliation`, or stuck `processing`) and settles them:
 * completed on "successful", released back to the balance on a definitive
 * failure / unknown reference after a 30-minute grace, escalated to admins after
 * 24h of inconclusive answers. See lib/payouts/withdrawal-reconcile.ts.
 *
 * Security: requires `CRON_SECRET` (Authorization: Bearer <secret>)
 */
export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
    }

    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const summary = await runWithdrawalReconciliation()
    return NextResponse.json({ success: true, ...summary })
  } catch (err: any) {
    console.error('[cron/moncash-withdrawal-reconcile] failed', err)
    return NextResponse.json({ error: err?.message || 'Reconciliation failed' }, { status: 500 })
  }
}
