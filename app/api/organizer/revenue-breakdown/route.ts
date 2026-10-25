import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { requireFinanceView } from '@/lib/organizer/context'
import { requireEventFinance } from '@/lib/organizer/financeAccess'
import { getOrganizerRevenueBreakdown, getEventRevenueBreakdown } from '@/lib/analytics/revenue'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get('eventId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    let breakdown

    if (eventId) {
      // One event's revenue: whoever may see that event's org finances
      // (owner, finance-granted admin, platform admin).
      const gate = await requireEventFinance(user, eventId)
      if (!gate.ok) return gate.response
      breakdown = await getEventRevenueBreakdown(eventId)
    } else {
      // All of the acting org's events: read-only finances.
      const org = await requireFinanceView()
      if (!org.ok) return org.response
      const options: any = {}
      if (startDate) options.startDate = new Date(startDate)
      if (endDate) options.endDate = new Date(endDate)
      
      breakdown = await getOrganizerRevenueBreakdown(org.value.orgId, options)
    }

    return NextResponse.json(breakdown)
  } catch (error: any) {
    console.error('Revenue breakdown error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get revenue breakdown' },
      { status: 500 }
    )
  }
}
