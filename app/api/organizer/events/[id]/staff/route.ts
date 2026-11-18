import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canOnEvent, eventOrgId, teamCol } from '@/lib/organizer/context'
import { isTeamRole } from '@/lib/organizer/teamRoles'
import { adminDb } from '@/lib/firebase/admin'

type ApiInvite = {
  id: string
  method: 'link' | 'email' | 'phone'
  targetEmail: string | null
  targetPhone: string | null
  expiresAt: string | null
  revokedAt: string | null
  usedAt: string | null
  usedBy: string | null
  createdAt: string | null
}

type ApiMember = {
  id: string
  role: string
  permissions: { checkin?: boolean; viewAttendees?: boolean }
  createdAt: string | null
  profile: { email: string | null; full_name: string | null; photo_url: string | null }
}

/** An active member of the event's org team, assignable to this event's door staff. */
type ApiTeamMember = {
  uid: string
  role: string
  name: string | null
  email: string | null
  photo_url: string | null
}

function tsToIso(value: any): string | null {
  if (!value) return null
  try {
    if (typeof value === 'string') return value
    if (typeof value.toDate === 'function') return value.toDate().toISOString()
    if (value instanceof Date) return value.toISOString()
  } catch {
    // ignore
  }
  return null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params

    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const eventDoc = await adminDb.collection('events').doc(eventId).get()
    if (!eventDoc.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const eventData = eventDoc.data() as any
    if (!(await canOnEvent(user, eventData, 'view')).allowed) {
      return NextResponse.json({ error: 'Not authorized for this event' }, { status: 403 })
    }

    // The event's OWN org (not the acting-org header): its team is who can be
    // assigned here without an invite (/api/staff/members/assign).
    const orgId = eventOrgId(eventData)
    const [invitesSnap, membersSnap, teamSnap] = await Promise.all([
      adminDb.collection('events').doc(eventId).collection('invites').orderBy('createdAt', 'desc').get(),
      adminDb.collection('events').doc(eventId).collection('members').orderBy('createdAt', 'desc').get(),
      orgId ? teamCol(orgId).get() : Promise.resolve(null),
    ])

    const invites: ApiInvite[] = invitesSnap.docs.map((d: any) => {
      const data = d.data() as any
      return {
        id: d.id,
        method: (String(data?.method || 'link') as any) === 'email' ? 'email' : (String(data?.method || 'link') as any) === 'phone' ? 'phone' : 'link',
        targetEmail: data?.targetEmail ? String(data.targetEmail) : null,
        targetPhone: data?.targetPhone ? String(data.targetPhone) : null,
        expiresAt: tsToIso(data?.expiresAt),
        revokedAt: tsToIso(data?.revokedAt),
        usedAt: tsToIso(data?.usedAt),
        usedBy: data?.usedBy ? String(data.usedBy) : null,
        createdAt: tsToIso(data?.createdAt),
      }
    })

    const memberDocs = membersSnap.docs as any[]
    const memberIds = memberDocs.map((d: any) => d.id).filter(Boolean)

    // Active seats only (status active, doc id === uid): legacy/invited rows grant nothing.
    const teamDocs = (teamSnap?.docs || []).filter((d: any) => {
      const x = d.data() || {}
      return x.status === 'active' && x.uid === d.id && isTeamRole(x.role)
    })
    const profileIds = Array.from(new Set([...memberIds, ...teamDocs.map((d: any) => d.id)].map(String)))

    const userDocs = await Promise.all(profileIds.map((uid) => adminDb.collection('users').doc(uid).get()))
    const profileById: Record<string, { email: string | null; full_name: string | null; photo_url: string | null }> = {}

    userDocs.forEach((docSnap) => {
      if (!docSnap.exists) return
      const data = docSnap.data() as any
      const name = String(data?.full_name || data?.display_name || '').trim()
      profileById[docSnap.id] = {
        email: data?.email ? String(data.email) : null,
        full_name: name || null,
        photo_url: data?.photo_url ? String(data.photo_url) : null,
      }
    })

    const team: ApiTeamMember[] = teamDocs.map((d: any) => {
      const x = d.data() || {}
      const p = profileById[d.id]
      return {
        uid: d.id,
        role: String(x.role),
        name: p?.full_name || (x.name ? String(x.name) : null),
        email: p?.email || (x.email ? String(x.email) : null),
        photo_url: p?.photo_url || null,
      }
    })

    const members: ApiMember[] = memberDocs.map((d: any) => {
      const data = d.data() as any
      const profile = profileById[d.id] || { email: null, full_name: null, photo_url: null }

      return {
        id: d.id,
        role: String(data?.role || 'staff'),
        permissions: (data?.permissions && typeof data.permissions === 'object' ? data.permissions : {}) as any,
        createdAt: tsToIso(data?.createdAt),
        profile,
      }
    })

    return NextResponse.json({ invites, members, team }, { status: 200 })
  } catch (e) {
    console.error('GET /api/organizer/events/[id]/staff error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
