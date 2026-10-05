import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { cookies } from 'next/headers'
import { loadOrganizerAvailability } from '@/lib/payouts/availability-server'
import { summaryFromAvailability } from '@/lib/payouts/availability'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value

    if (!sessionCookie) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    const organizerId = decodedClaims.uid

    // Same figures as the finance page and the payout routes (one shared
    // availability function), with the per-currency withdrawable totals.
    const { events, totals } = await loadOrganizerAvailability(organizerId)
    return NextResponse.json({ ...summaryFromAvailability(events), withdrawable: totals })
  } catch (error: any) {
    console.error('Error fetching earnings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch earnings', message: error.message },
      { status: 500 }
    )
  }
}
