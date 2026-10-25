import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { moncashPrefundedBalance } from '@/lib/moncash'
import { autoConfirmSentRequests, maybeSendLowBalanceAlert } from '@/lib/payouts/prefunding-alerts-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Prefunding Availability Refresh Cron
 *
 * Checks MonCash prefunded balance and updates `config/payouts.prefunding`:
 * - `available`: whether instant prefunding can be offered right now
 * - `balance`: latest known prefunded balance
 * - `lastCheckedAt`: timestamp
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

    const payoutsRef = adminDb.collection('config').doc('payouts')
    const payoutsSnap = await payoutsRef.get()
    const current = payoutsSnap.exists ? (payoutsSnap.data() as any) : null

    const prefunding = current?.prefunding || {}
    const enabled = Boolean(prefunding?.enabled)
    const now = new Date()

    // If prefunding isn't enabled, don't call the prefunded balance API at all.
    // Disbursement is a separate MonCash product this account may not be
    // provisioned for, so polling it just produces recurring 401/403 error noise.
    if (!enabled) {
      await payoutsRef.set(
        {
          prefunding: { ...prefunding, enabled, available: false, lastCheckedAt: now, lastError: null },
          updatedAt: now,
        },
        { merge: true }
      )
      return NextResponse.json({
        success: true,
        skipped: 'prefunding_disabled',
        prefunding: { enabled, available: false, lastCheckedAt: now.toISOString() },
      })
    }

    // Optional threshold (major units) to prevent offering instant payouts when balance is low.
    const minBalance = Number(prefunding?.minBalance ?? 0)
    const minBalanceSafe = Number.isFinite(minBalance) && minBalance > 0 ? minBalance : 0

    const balanceRes = await moncashPrefundedBalance()
    const balance = Number(balanceRes.balance)

    // An empty account is never available, even with no minBalance configured:
    // `0 >= 0` would otherwise offer instant payouts that cannot be funded.
    const available = enabled && Number.isFinite(balance) && balance > 0 && balance >= minBalanceSafe

    await payoutsRef.set(
      {
        prefunding: {
          ...prefunding,
          enabled,
          available,
          balance,
          lastCheckedAt: now,
          lastError: null,
        },
        updatedAt: now,
      },
      { merge: true }
    )

    // Prefunding planner side effects (lib/payouts/prefunding-alerts-server.ts):
    // confirm 'sent' Digicel requests once the pool rises, and email ops at most
    // once a day when the pool is below the 2-business-day need. Neither moves
    // money or contacts Digicel, and neither may fail the refresh itself.
    const planner: Record<string, any> = {}
    if (Number.isFinite(balance)) {
      const reading = { balanceHtg: balance, checkedAt: now.toISOString(), error: null }
      try {
        planner.requestsConfirmed = await autoConfirmSentRequests({ now, balanceHtg: balance })
      } catch (e: any) {
        console.error('prefunding-refresh: request auto-confirm failed', e?.message || e)
        planner.requestsConfirmedError = String(e?.message || e)
      }
      try {
        planner.lowBalanceAlert = await maybeSendLowBalanceAlert({ now, balance: reading })
      } catch (e: any) {
        console.error('prefunding-refresh: low-balance alert failed', e?.message || e)
        planner.lowBalanceAlertError = String(e?.message || e)
      }
    }

    return NextResponse.json({
      success: true,
      prefunding: {
        enabled,
        available,
        balance,
        minBalance: minBalanceSafe,
        lastCheckedAt: now.toISOString(),
      },
      planner,
    })
  } catch (error: any) {
    console.error('prefunding-refresh cron error:', error)

    // Best-effort: record the failure so UI can show prefunding is not available.
    try {
      const payoutsRef = adminDb.collection('config').doc('payouts')
      const now = new Date()
      await payoutsRef.set(
        {
          prefunding: {
            available: false,
            lastCheckedAt: now,
            lastError: error?.message || String(error),
          },
          updatedAt: now,
        },
        { merge: true }
      )
    } catch (e) {
      console.error('prefunding-refresh failed to record error:', e)
    }

    return NextResponse.json(
      { error: 'Failed to refresh prefunding status', message: error?.message || String(error) },
      { status: 500 }
    )
  }
}
