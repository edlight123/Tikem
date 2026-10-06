import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { assertEventOwner } from '@/app/api/staff/_utils'

type ResolvedProfile = {
  uid: string
  email: string | null
  full_name: string | null
}

const MAX_UIDS = 100

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const eventId = String(body?.eventId || '')
    const uidsRaw = Array.isArray(body?.uids) ? body.uids : []
    const uids: string[] = Array.from(
      new Set(
        uidsRaw
          .map((v: any) => String(v || '').trim())
          .filter((v: string) => Boolean(v))
      )
    )

    if (!eventId) return NextResponse.json({ error: 'eventId is required' }, { status: 400 })
    if (uids.length === 0) return NextResponse.json({ profiles: {} })
    if (uids.length > MAX_UIDS) {
      return NextResponse.json({ error: `At most ${MAX_UIDS} uids per call` }, { status: 400 })
    }

    await assertEventOwner({ eventId, uid: user.id })

    // Only resolve people who are actually attached to THIS event: a members
    // doc, or an invite they redeemed. Without this, any organizer could pass
    // an arbitrary uid and read that user's Auth email.
    const eventRef = adminDb.collection('events').doc(eventId)
    const memberSnaps = await adminDb.getAll(...uids.map((uid) => eventRef.collection('members').doc(uid)))
    const allowed = new Set(memberSnaps.filter((s: any) => s.exists).map((s: any) => String(s.id)))
    const remaining = uids.filter((uid) => !allowed.has(uid))
    for (let i = 0; i < remaining.length; i += 30) {
      const chunk = remaining.slice(i, i + 30)
      const inv = await eventRef.collection('invites').where('usedBy', 'in', chunk).get().catch(() => null)
      inv?.docs.forEach((d: any) => {
        const usedBy = String((d.data() as any)?.usedBy || '')
        if (usedBy) allowed.add(usedBy)
      })
    }
    const permitted = uids.filter((uid) => allowed.has(uid))

    const profilesArr: ResolvedProfile[] = await Promise.all(
      permitted.map(async (uid: string) => {
        const [authRecord, userDoc] = await Promise.all([
          adminAuth
            .getUser(uid)
            .catch(() => null),
          adminDb
            .collection('users')
            .doc(uid)
            .get()
            .catch(() => null),
        ])

        const email = authRecord?.email ? String(authRecord.email).toLowerCase() : null
        const full_name = userDoc?.exists ? (userDoc.data() as any)?.full_name || null : null

        return { uid, email, full_name: full_name ? String(full_name) : null }
      })
    )

    const profiles = profilesArr.reduce<Record<string, Omit<ResolvedProfile, 'uid'>>>((acc, p) => {
      acc[p.uid] = { email: p.email, full_name: p.full_name }
      return acc
    }, {})

    return NextResponse.json({ profiles })
  } catch (err: any) {
    const message = err?.message || 'Failed to resolve member profiles'
    const status = message === 'Event not found' ? 404 : message.includes('Only the event owner') ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
