import { NextResponse } from 'next/server'
import { authorizeDoorAccess } from '@/lib/scan/doorService'
import { orderAddOnsForTicket, setAddOnPickedUp } from '@/lib/addons/server'

export const dynamic = 'force-dynamic'

/**
 * Add-ons at the door (lib/addons/addOns.ts).
 *
 * GET  /api/staff/events/:id/add-ons/pickup?ticketId=…  the order's add-ons for a ticket
 * POST /api/staff/events/:id/add-ons/pickup             { ticketId, index, pickedUp }
 *
 * Same gate as the door list and check-in (authorizeDoorAccess). Tickets are
 * never written from a client, so the "picked up" toggle is recorded here, in
 * a transaction on the order's first ticket.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eventId = String((await params)?.id || '')
    const access = await authorizeDoorAccess(eventId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
    const ticketId = String(new URL(request.url).searchParams.get('ticketId') || '').trim()
    if (!ticketId) return NextResponse.json({ error: 'ticketId is required' }, { status: 400 })
    const order = await orderAddOnsForTicket(eventId, ticketId)
    return NextResponse.json({ addOns: order })
  } catch (error) {
    console.error('[staff/add-ons] read failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eventId = String((await params)?.id || '')
    const access = await authorizeDoorAccess(eventId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
    const body: any = await request.json().catch(() => null)
    const ticketId = typeof body?.ticketId === 'string' ? body.ticketId.trim() : ''
    const index = Number(body?.index)
    if (!ticketId || !Number.isInteger(index)) {
      return NextResponse.json({ error: 'ticketId and index are required' }, { status: 400 })
    }
    const result = await setAddOnPickedUp({
      eventId,
      ticketId,
      index,
      pickedUp: body?.pickedUp !== false,
      uid: access.uid,
    })
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
    return NextResponse.json({ ok: true, addOns: result.order })
  } catch (error) {
    console.error('[staff/add-ons] pickup failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
