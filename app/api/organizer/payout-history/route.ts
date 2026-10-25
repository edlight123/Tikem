import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getPayoutHistory } from '@/lib/firestore/payout'
import { denyIfActingForAnotherOrg } from '@/lib/organizer/ownerOnly'

export const dynamic = 'force-dynamic'

/**
 * Return the current organizer's recent payouts for the mobile Payout Settings
 * history view. Read-only.
 */
export async function GET() {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Money and identity stay with the org owner (lib/organizer/ownerOnly.ts).
    const notOwner = await denyIfActingForAnotherOrg(user.id)
    if (notOwner) return notOwner

    const payouts = await getPayoutHistory(user.id, 50)
    return NextResponse.json({ payouts })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to load payout history' }, { status: 500 })
  }
}
