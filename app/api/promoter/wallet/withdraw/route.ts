// Withdraw the promoter's entire available balance to MonCash. Instant over the
// prefunded pool (promoter pays the 3%) when the platform has it on; otherwise
// a pending request for the admin queue, fee-free — mirroring organizer rails.

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { executePromoterWithdrawal } from '@/lib/promoter-wallet'

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const result = await executePromoterWithdrawal(user.id, String(body?.phone || ''))

    if (!result.ok) {
      const status =
        result.code === 'conflict' || result.code === 'destination_on_hold' || result.code === 'balance_negative'
          ? 409
          : result.code === 'transfer_failed'
            ? 502
            : result.code === 'identity_required' || result.code === 'verification_required'
              ? 403
              : 400
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
          ...(result.code === 'verification_required' ? { requiresVerification: true } : {}),
          ...(result.availableAt ? { availableAt: result.availableAt } : {}),
        },
        { status }
      )
    }

    return NextResponse.json({
      success: true,
      withdrawalId: result.withdrawalId,
      instant: result.instant,
      confirming: Boolean(result.confirming),
      grossHtgCents: result.grossHtgCents,
      feeCents: result.feeCents,
      payoutHtgCents: result.payoutHtgCents,
    })
  } catch (err: any) {
    console.error('[promoter-withdraw] failed', err)
    return NextResponse.json({ error: 'Withdrawal failed. Nothing was sent.' }, { status: 500 })
  }
}
