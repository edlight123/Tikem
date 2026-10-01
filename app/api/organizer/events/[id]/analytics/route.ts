import { NextResponse } from 'next/server'
import { normalizeCurrency } from '@/lib/money'
import { computeEventAnalytics } from '@/lib/organizer/eventOrders'
import { authorizeEventOwner, loadEventTicketRows } from '@/lib/organizer/eventOrdersLoader'

export const dynamic = 'force-dynamic'

/**
 * Per-event analytics. JSON twin of app/organizer/events/[id]/analytics for the
 * mobile app, plus buyers by city (from each buyer's profile city).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eventId = String((await params)?.id || '')
    const access = await authorizeEventOwner(eventId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const rows = await loadEventTicketRows(access.event)
    const capacity = Number(access.event.total_tickets ?? access.event.max_tickets ?? access.event.capacity ?? 0)
    return NextResponse.json({
      event: {
        id: access.event.id,
        title: access.event.title || '',
        currency: normalizeCurrency(access.event.currency, 'HTG'),
      },
      analytics: computeEventAnalytics(rows, capacity),
    })
  } catch (error) {
    console.error('[organizer/events/analytics] failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
