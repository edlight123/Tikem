import { NextResponse } from 'next/server'
import { authorizeDoorAccess } from '@/lib/scan/doorService'
import { parseUndoReason, undoCheckIn } from '@/lib/scan/undoCheckIn'

export const dynamic = 'force-dynamic'

/**
 * POST /api/staff/events/:id/check-in/undo
 *
 * Body: { ticketId, reason: 'mistake' | 'wrong_person' | 'testing' }
 *
 * Takes back an admission (see lib/scan/undoCheckIn). The event's owner side
 * only (owner / org admin / org manager, or a platform admin): door staff can
 * admit but not un-admit.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eventId = String((await params)?.id || '')
    const access = await authorizeDoorAccess(eventId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
    if (access.role !== 'owner' && access.role !== 'admin') {
      return NextResponse.json({ error: 'Only the organizer can undo a check-in', code: 'forbidden' }, { status: 403 })
    }

    const body: any = await request.json().catch(() => null)
    const ticketId = typeof body?.ticketId === 'string' ? body.ticketId.trim() : ''
    const reason = parseUndoReason(body?.reason)
    if (!ticketId || !reason) {
      return NextResponse.json({ error: 'ticketId and a valid reason are required' }, { status: 400 })
    }

    const result = await undoCheckIn({ eventId, ticketId, uid: access.uid, reason })
    if (!result.ok) {
      const status = result.code === 'not_checked_in' ? 409 : 404
      return NextResponse.json({ ok: false, code: result.code }, { status })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[staff/check-in/undo] failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
