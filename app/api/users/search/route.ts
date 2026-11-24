import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { friendshipStateFrom, mapConnectionsForViewer } from '@/lib/firestore/connections'
import { consumeRateLimit } from '@/lib/rate-limit'
import { isFindableInSearch } from '@/lib/social/suggestions'

export const runtime = 'nodejs'

/**
 * Search users by name (prefix) or exact email so people can send friend
 * requests. Returns only minimal public info plus the viewer's friendship
 * state — never private data.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // An exact-email lookup answers "does this address have an account": cap
    // it per user so it can't be used to enumerate addresses. Fails closed.
    const MIN = 60_000
    const perMinute = await consumeRateLimit({ key: `user-search:min:${user.id}`, limit: 30, windowMs: MIN })
    const perDay = perMinute.limited
      ? perMinute
      : await consumeRateLimit({ key: `user-search:day:${user.id}`, limit: 300, windowMs: 24 * 60 * MIN })
    if (perMinute.limited || perDay.limited) {
      return NextResponse.json({ results: [], error: 'Too many searches. Try again later.' }, { status: 429 })
    }

    const { searchParams } = new URL(request.url)
    const qRaw = (searchParams.get('q') || '').trim()
    if (qRaw.length < 2) {
      return NextResponse.json({ results: [] })
    }

    const isEmail = qRaw.includes('@')
    const usersRef = adminDb.collection('users')

    const results = new Map<string, any>()

    if (isEmail) {
      const snap = await usersRef.where('email', '==', qRaw.toLowerCase()).limit(10).get()
      snap.docs.forEach((doc: any) => results.set(doc.id, doc.data()))
    } else {
      // Case-insensitive-ish prefix search on full_name.
      const end = qRaw + '\uf8ff'
      const snap = await usersRef
        .orderBy('full_name')
        .startAt(qRaw)
        .endAt(end)
        .limit(40)
        .get()
      snap.docs.forEach((doc: any) => results.set(doc.id, doc.data()))

      // Also try a capitalized variant to be forgiving about casing.
      const cap = qRaw.charAt(0).toUpperCase() + qRaw.slice(1)
      if (cap !== qRaw) {
        const snap2 = await usersRef
          .orderBy('full_name')
          .startAt(cap)
          .endAt(cap + '\uf8ff')
          .limit(40)
          .get()
        snap2.docs.forEach((doc: any) => results.set(doc.id, doc.data()))
      }
    }

    results.delete(user.id) // never include self

    const ids = Array.from(results.keys())
    const connectionsByOther = await mapConnectionsForViewer(user.id)

    // People who keep their profile private or opted out of being found are
    // not offered to strangers. Only a real tie still finds them: an accepted
    // friendship, or a request THEY sent the viewer. A request the viewer sent
    // that was never answered grants nothing (it would let anyone keep finding
    // a person who went private after ignoring them).
    const knows = (id: string) => {
      const conn = connectionsByOther.get(id)
      return Boolean(conn && (conn.status === 'accepted' || conn.requester_id === id))
    }
    const payload = ids
      .filter((id) => isFindableInSearch(results.get(id), knows(id)))
      .slice(0, 20)
      .map((id) => {
      const data = results.get(id)
      const conn = connectionsByOther.get(id) || null
      return {
        uid: id,
        displayName: data.full_name || data.display_name || data.displayName || 'Tikèm user',
        photoURL: data.photo_url || data.photoURL || '',
        isVerified: Boolean(data.is_verified),
        friendship: friendshipStateFrom(conn, user.id, id),
      }
    })

    return NextResponse.json({ results: payload })
  } catch (error: any) {
    console.error('Error searching users:', error)
    return NextResponse.json({ results: [] }, { status: 200 })
  }
}
