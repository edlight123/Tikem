import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { assertEventOwner, serverTimestamp } from '@/app/api/staff/_utils'

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
    const inviteId = String(body?.inviteId || '')

    if (!eventId) return NextResponse.json({ error: 'eventId is required' }, { status: 400 })
    if (!inviteId) return NextResponse.json({ error: 'inviteId is required' }, { status: 400 })

    if (user.role !== 'admin') {
      await assertEventOwner({ eventId, uid: user.id })
    }

    const inviteRef = adminDb.doc(`events/${eventId}/invites/${inviteId}`)

    const snap = await inviteRef.get()
    if (!snap.exists) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    const invite = snap.data() as any
    if (invite?.usedAt) {
      return NextResponse.json({ error: 'Invite already claimed' }, { status: 409 })
    }

    await inviteRef.update({ revokedAt: serverTimestamp() })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    const message = err?.message || 'Failed to revoke invite'
    const status = message.includes('Only the event owner') ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
