import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { requireFinanceView } from '@/lib/organizer/context'
import { loadOrganizerAvailability } from '@/lib/payouts/availability-server'
import { summaryFromAvailability } from '@/lib/payouts/availability'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    if (!(await getCurrentUser())) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Read-only finances: the owner, or an admin the owner granted them
    // (never managers). Moving money stays owner-only elsewhere.
    const org = await requireFinanceView()
    if (!org.ok) return org.response
    const organizerId = org.value.orgId

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
