import { NextResponse } from 'next/server'
import { authorizeDoorAccess, performDoorCheckIn } from '@/lib/scan/doorService'
import { normalizeEntryPoint } from '@/lib/scan/doorRules'

export const dynamic = 'force-dynamic'

/**
 * POST /api/staff/events/:id/check-in
 *
 * Body: { ticketId?, code?, method?: 'scan' | 'manual', entryPoint?, reentry?, override? }
 *
 * Same gate as the door list. Validates exactly as the scanner does (right
 * event, not expired, not already in unless re-entry is allowed, live status,
 * entry window unless overridden) and writes the scanner's fields inside a
 * Firestore transaction, so a ticket cannot be admitted twice.
 *
 * Every judged outcome is a 200 with a `verdict`. Only auth, bad input and
 * server faults are errors, so an offline queue can tell "refused" from "retry".
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eventId = String((await params)?.id || '')
    const access = await authorizeDoorAccess(eventId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const body: any = await request.json().catch(() => null)
    const ticketId = typeof body?.ticketId === 'string' ? body.ticketId.trim() : ''
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!ticketId && !code) {
      return NextResponse.json({ error: 'ticketId or code is required' }, { status: 400 })
    }

    const result = await performDoorCheckIn({
      eventId,
      uid: access.uid,
      ticketId: ticketId || null,
      code: code || null,
      method: body?.method === 'manual' ? 'manual' : 'scan',
      entryPoint: normalizeEntryPoint(body?.entryPoint),
      reentry: body?.reentry === true,
      override: body?.override === true,
    })
    return NextResponse.json({ ok: result.verdict === 'CHECKED_IN', ...result })
  } catch (error) {
    console.error('[staff/check-in] failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
