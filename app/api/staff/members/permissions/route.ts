import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { assertEventOwner, normalizePermissions, serverTimestamp } from '@/app/api/staff/_utils'

/**
 * Update an existing team member's permissions for an event.
 * Only the event owner (or an admin) may change permissions. `checkin` is always
 * true for a member; `viewAttendees` is the toggleable capability.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // No account-role gate: an admin/manager of the event's org may be any
    // account. assertEventOwner below decides (lib/organizer/teamRoles.ts).

    const body = await request.json().catch(() => ({}))
    const eventId = String(body?.eventId || '')
    const memberId = String(body?.memberId || '')

    if (!eventId) return NextResponse.json({ error: 'eventId is required' }, { status: 400 })
    if (!memberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 })

    if (user.role !== 'admin') {
      await assertEventOwner({ eventId, uid: user.id })
    }

    const memberRef = adminDb.doc(`events/${eventId}/members/${memberId}`)
    const snap = await memberRef.get()
    if (!snap.exists) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Owners are not demotable through this endpoint.
    const role = String((snap.data() as any)?.role || '')
    if (role === 'owner') {
      return NextResponse.json({ error: 'Cannot change owner permissions' }, { status: 400 })
    }

    const permissions = normalizePermissions(body?.permissions)

    await memberRef.set(
      { permissions, updated_at: serverTimestamp() },
      { merge: true }
    )

    return NextResponse.json({ success: true, permissions })
  } catch (err: any) {
    const message = err?.message || 'Failed to update permissions'
    const status = message.includes('Only the event owner') ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
