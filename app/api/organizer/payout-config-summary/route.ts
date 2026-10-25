import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { denyIfActingForAnotherOrg } from '@/lib/organizer/ownerOnly'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Money and identity stay with the org owner (lib/organizer/ownerOnly.ts).
    const notOwner = await denyIfActingForAnotherOrg(user.id)
    if (notOwner) return notOwner

    const [haitiProfile, stripeProfile] = await Promise.all([
      getPayoutProfile(user.id, 'haiti'),
      getPayoutProfile(user.id, 'stripe_connect'),
    ])
    const data = haitiProfile as any
    const stripe = stripeProfile as any

    return NextResponse.json({
      allowInstantMoncash: Boolean(data?.allowInstantMoncash),
      payoutProvider: data?.payoutProvider || null,
      method: data?.method || null,
      status: data?.status || null,
      // Both region profiles, for the "an event's country decides which profile
      // pays out" UX (event-creation nudge + settings cards, 2026-08-29).
      profiles: {
        haiti: {
          configured: Boolean(haitiProfile),
          status: data?.verificationStatus || data?.status || null,
        },
        stripeConnect: {
          configured: Boolean(stripeProfile),
          status: stripe?.verificationStatus || stripe?.status || null,
        },
      },
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Failed to load payout config summary', message: e?.message || String(e) },
      { status: 500 }
    )
  }
}
