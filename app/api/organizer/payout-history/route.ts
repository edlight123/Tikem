import { NextResponse } from 'next/server'
import { getPayoutHistory } from '@/lib/firestore/payout'
import { requireFinanceView } from '@/lib/organizer/context'

export const dynamic = 'force-dynamic'

/**
 * The acting org's recent payouts (amount, method, status, dates; never the
 * destination's details). Read-only, so the owner and any admin the owner
 * granted read-only finances may see it (requireFinanceView). Scoped by the
 * org, not the caller: a finance admin sees the org's payouts, not their own.
 */
export async function GET() {
  try {
    const gate = await requireFinanceView()
    if (!gate.ok) return gate.response

    const payouts = await getPayoutHistory(gate.value.orgId, 50)
    return NextResponse.json({ payouts })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to load payout history' }, { status: 500 })
  }
}
