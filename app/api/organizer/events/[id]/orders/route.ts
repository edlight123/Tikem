import { NextResponse } from 'next/server'
import { normalizeCurrency } from '@/lib/money'
import { groupOrders } from '@/lib/organizer/eventOrders'
import { authorizeEventOwner, loadEventTicketRows } from '@/lib/organizer/eventOrdersLoader'

export const dynamic = 'force-dynamic'

/**
 * Orders for one event, grouped by the payment that bought them. JSON twin of
 * app/organizer/events/[id]/orders (a server component) for the mobile app,
 * which cannot read buyer `users` docs under the H4 rules.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eventId = String((await params)?.id || '')
    const access = await authorizeEventOwner(eventId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const rows = await loadEventTicketRows(access.event)
    return NextResponse.json({
      event: {
        id: access.event.id,
        title: access.event.title || '',
        currency: normalizeCurrency(access.event.currency, 'HTG'),
        status: access.event.status || null,
      },
      orders: groupOrders(rows),
    })
  } catch (error) {
    console.error('[organizer/events/orders] failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
