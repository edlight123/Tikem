import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { denyIfActingForAnotherOrg } from '@/lib/organizer/ownerOnly'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  try {
    const { user, error } = await requireAuth('organizer')
    if (error || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Money and identity stay with the org owner (lib/organizer/ownerOnly.ts).
    const notOwner = await denyIfActingForAnotherOrg(user.id)
    if (notOwner) return notOwner

    const profile = await getPayoutProfile(user.id, 'stripe_connect')
    return NextResponse.json({ profile }, { status: 200 })
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Failed to load Stripe payout profile', message: e?.message || String(e) },
      { status: 500 }
    )
  }
}
