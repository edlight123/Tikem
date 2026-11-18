import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserSummaries } from '@/lib/firestore/connections'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX = 500

/**
 * GET: who follows the signed-in organizer (organizer_follows where
 * organizer_id == me), newest first. Public profile fields only (name, photo,
 * verified): never email or phone. Owner call 2026-11-18: organizers can see
 * their followers, not just the count.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const snap = await adminDb.collection('organizer_follows').where('organizer_id', '==', user.id).limit(MAX).get()
    const rows = snap.docs
      .map((d: any) => d.data() || {})
      .filter((x: any) => typeof x.follower_id === 'string' && x.follower_id && x.follower_id !== user.id)
    const time = (v: any) => {
      const d = typeof v?.toDate === 'function' ? v.toDate() : new Date(v || 0)
      return Number.isNaN(d.getTime()) ? 0 : d.getTime()
    }
    rows.sort((a: any, b: any) => time(b.created_at) - time(a.created_at))
    const ids: string[] = Array.from(new Set(rows.map((x: any) => String(x.follower_id))))
    const summaries = await getPublicUserSummaries(ids)
    const followers = ids
      .map((uid) => summaries.get(uid))
      .filter(Boolean)
      .map((s: any) => ({
        uid: s.uid,
        displayName: s.displayName,
        photoURL: s.photoURL || '',
        isVerified: Boolean(s.isVerified),
      }))
    return NextResponse.json({ followers, total: ids.length })
  } catch (e: any) {
    console.error('GET /api/me/followers error', e)
    return NextResponse.json({ error: 'Failed to load followers' }, { status: 500 })
  }
}
