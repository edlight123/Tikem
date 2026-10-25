import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { denyIfActingForAnotherOrg } from '@/lib/organizer/ownerOnly'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Money and identity stay with the org owner (lib/organizer/ownerOnly.ts).
    const notOwner = await denyIfActingForAnotherOrg(user.id)
    if (notOwner) return notOwner

    const snap = await adminDb.collection('config').doc('payouts').get()
    const data = snap.exists ? snap.data() : null

    const prefunding = data?.prefunding || null

    const enabled = Boolean(prefunding?.enabled)
    const available = Boolean(prefunding?.available)

    return NextResponse.json({
      // Back-compat: some clients expect enabled/available at the top level.
      enabled,
      available,
      prefunding: {
        enabled,
        available,
        updatedAt: prefunding?.updatedAt?.toDate?.()?.toISOString?.() || prefunding?.updatedAt || null,
      },
    })
  } catch (error: any) {
    console.error('payout-prefunding-status error:', error)
    return NextResponse.json(
      { error: 'Failed to load prefunding status', message: error?.message || String(error) },
      { status: 500 }
    )
  }
}
