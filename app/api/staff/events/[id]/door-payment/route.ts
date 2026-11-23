import { NextResponse } from 'next/server'
import { authorizeDoorAccess } from '@/lib/scan/doorService'
import { markDoorPaid } from '@/lib/scan/doorPayment'

export const dynamic = 'force-dynamic'

/**
 * POST /api/staff/events/:id/door-payment
 *
 * Body: { ticketId, paid: boolean }
 *
 * Pay at the door: records that the organizer's team took the cash
 * for one ticket (paid: true), or undoes it (paid: false). Same gate as the
 * door list and check-in. Tikem handles no money; nothing here touches
 * price_paid, fees or payouts. Idempotent: the first payment record is kept.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eventId = String((await params)?.id || '')
    const access = await authorizeDoorAccess(eventId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const body: any = await request.json().catch(() => null)
    const ticketId = typeof body?.ticketId === 'string' ? body.ticketId.trim() : ''
    if (!ticketId || typeof body?.paid !== 'boolean') {
      return NextResponse.json({ error: 'ticketId and paid are required' }, { status: 400 })
    }

    const result = await markDoorPaid({ eventId, ticketId, staffUid: access.uid, paid: body.paid })
    if (!result.ok) {
      const status = result.code === 'not_found' ? 404 : 400
      return NextResponse.json({ error: result.code, code: result.code }, { status })
    }
    return NextResponse.json({ ok: true, row: result.row })
  } catch (error) {
    console.error('[staff/door-payment] failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
