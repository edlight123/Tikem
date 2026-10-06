import { NextResponse } from 'next/server'
import { authorizeDoorAccess, loadDoorList } from '@/lib/scan/doorService'

export const dynamic = 'force-dynamic'

/**
 * GET /api/staff/events/:id/door-list
 *
 * What the door needs and nothing else: display name, tier, status, checked-in
 * state and a SHA-256 of the ticket code (never the code itself: it admits),
 * for live tickets plus ones already checked in. No email, phone, payment or
 * amounts. Door staff without the view-attendees
 * permission validate QRs and look guests up this way, because Firestore
 * cannot hide fields on a direct tickets read.
 *
 * Allowed for the event owner, platform admins, and staff whose
 * members/{uid}.permissions.checkin is true.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eventId = String((await params)?.id || '')
    const access = await authorizeDoorAccess(eventId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const rows = await loadDoorList(access.event)
    return NextResponse.json(
      {
        event: {
          id: access.event.id,
          title: String(access.event.title || ''),
          allowReentry: Boolean(access.event.allow_reentry),
        },
        role: access.role,
        generatedAt: new Date().toISOString(),
        rows,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('[staff/door-list] failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
