import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireFinanceView } from '@/lib/organizer/context'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  try {
    // Platform-wide flag, read-only: anyone who may see the org's finances.
    const gate = await requireFinanceView()
    if (!gate.ok) return gate.response

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
