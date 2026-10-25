import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canOnEvent } from '@/lib/organizer/context'
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
  profile: { email: string | null; full_name: string | null }
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

    const [invitesSnap, membersSnap] = await Promise.all([
      adminDb.collection('events').doc(eventId).collection('invites').orderBy('createdAt', 'desc').get(),
      adminDb.collection('events').doc(eventId).collection('members').orderBy('createdAt', 'desc').get(),
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

    const userDocs = await Promise.all(memberIds.map((uid: any) => adminDb.collection('users').doc(String(uid)).get()))
    const profileById: Record<string, { email: string | null; full_name: string | null }> = {}

    userDocs.forEach((docSnap) => {
      if (!docSnap.exists) return
      const data = docSnap.data() as any
      profileById[docSnap.id] = {
        email: data?.email ? String(data.email) : null,
        full_name: data?.full_name ? String(data.full_name) : null,
      }
    })

    const members: ApiMember[] = memberDocs.map((d: any) => {
      const data = d.data() as any
      const profile = profileById[d.id] || { email: null, full_name: null }

      return {
        id: d.id,
        role: String(data?.role || 'staff'),
        permissions: (data?.permissions && typeof data.permissions === 'object' ? data.permissions : {}) as any,
        createdAt: tsToIso(data?.createdAt),
        profile,
      }
    })

    return NextResponse.json({ invites, members }, { status: 200 })
  } catch (e) {
    console.error('GET /api/organizer/events/[id]/staff error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
