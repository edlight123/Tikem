import { NextRequest, NextResponse, after } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireEventAccess, teamRoleIn } from '@/lib/organizer/context'
import { normalizePermissions, serverTimestamp } from '@/app/api/staff/_utils'
import { sendPushNotification } from '@/lib/notification-triggers'
import { isTikemCrewSeat } from '@/lib/doorTeam/rules'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Put an existing member of the event's organization team on this event's
 * door staff, without an invite (owner feedback 2026-11-18: "we already have a
 * team, we should be able to assign them to the event").
 *
 *   POST { eventId, uid, permissions?: { viewAttendees } }
 *
 * Writes events/{eventId}/members/{uid}, the same doc an accepted staff invite
 * writes (redeem route), so scanning and the staff event list work unchanged.
 * Unassigning uses /api/staff/members/remove.
 *
 * Gate: whoever may manage the event (owner, org admin/manager, platform
 * admin), via requireEventAccess. The assignee must hold an ACTIVE seat in the
 * event's own org (organizers/{orgId}/team/{uid}); anyone else needs an invite.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const eventId = String(body?.eventId || '')
  const uid = String(body?.uid || '')
  if (!eventId) return NextResponse.json({ error: 'eventId is required' }, { status: 400 })
  if (!uid) return NextResponse.json({ error: 'uid is required' }, { status: 400 })

  const gate = await requireEventAccess(eventId, 'manage_events')
  if (!gate.ok) return gate.response
  const { orgId, event, user } = gate.value

  try {
    if (!orgId) return NextResponse.json({ error: 'Event has no organization' }, { status: 400 })
    if (uid === orgId) {
      return NextResponse.json({ error: 'The owner already has access to every event' }, { status: 400 })
    }
    const role = await teamRoleIn(orgId, uid)
    if (!role) {
      return NextResponse.json({ error: 'Not an active member of this organization' }, { status: 404 })
    }

    const memberRef = adminDb.collection('events').doc(eventId).collection('members').doc(uid)
    const existing = await memberRef.get()
    // A Tikèm door crew seat is never re-scoped by the organizer.
    if (existing.exists && isTikemCrewSeat(existing.data())) {
      return NextResponse.json({ error: "Tikèm's door crew is managed by Tikèm", code: 'tikem_crew_seat' }, { status: 403 })
    }
    if (existing.exists && String(existing.data()?.role || '') === 'owner') {
      return NextResponse.json({ success: true, alreadyAssigned: true })
    }

    const permissions = normalizePermissions(body?.permissions)
    await memberRef.set(
      {
        uid,
        eventId,
        role: 'staff',
        permissions,
        source: 'org_team',
        createdAt: existing.exists ? existing.data()?.createdAt || new Date() : new Date(),
        createdBy: user.id,
        updated_at: serverTimestamp(),
      },
      { merge: true },
    )

    if (!existing.exists) {
      const eventTitle = String(event?.title || 'an event')
      after(async () => {
        try {
          await sendPushNotification(
            uid,
            'Added to the door team',
            `You can now check guests in for "${eventTitle}".`,
            undefined,
            { type: 'staff_assigned', eventId },
          )
        } catch (err) {
          console.error('staff assign push failed', err)
        }
      })
    }

    return NextResponse.json({ success: true, permissions })
  } catch (e: any) {
    console.error('POST /api/staff/members/assign error', e)
    return NextResponse.json({ error: e?.message || 'Failed to assign' }, { status: 500 })
  }
}
