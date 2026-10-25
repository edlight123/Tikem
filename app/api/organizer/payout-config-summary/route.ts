import { NextRequest, NextResponse } from 'next/server'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { requireFinanceView } from '@/lib/organizer/context'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  try {
    // Masked summary only (method kind and statuses: no account or phone
    // numbers), so read-only finance admins may see it too. Changing any of it
    // stays owner-only (payout-profiles, payout-destinations).
    const gate = await requireFinanceView()
    if (!gate.ok) return gate.response
    const orgId = gate.value.orgId

    const [haitiProfile, stripeProfile] = await Promise.all([
      getPayoutProfile(orgId, 'haiti'),
      getPayoutProfile(orgId, 'stripe_connect'),
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
