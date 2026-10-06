import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { assertEventOwnedByUser } from '@/lib/tracking-links'
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
      // Get breakdown for specific event — only the event's organizer (or an admin).
      if (user.role !== 'admin') {
        const owned = await assertEventOwnedByUser(eventId, user.id)
        if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status })
      }
      breakdown = await getEventRevenueBreakdown(eventId)
    } else {
      // Get breakdown for organizer's all events
      const options: any = {}
      if (startDate) options.startDate = new Date(startDate)
      if (endDate) options.endDate = new Date(endDate)
      
      breakdown = await getOrganizerRevenueBreakdown(user.id, options)
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
