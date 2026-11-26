/**
 * GET /api/social/friend-activity: upcoming events the caller's friends are
 * going to (Home rail, web and app). Signed-in only, behind the same remote
 * switch as "friends going" (config/auth.friend_suggestions, fails closed),
 * rate-limited per uid. Every privacy rule: lib/social/friend-activity.ts.
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { isSocialFlagOn } from '@/lib/social/flags'
import { friendsGoingRateLimit } from '@/lib/social/handlers'
import { getFriendActivity } from '@/lib/social/suggestions-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

export async function GET() {
  const uid = (await getCurrentUser().catch(() => null))?.id ?? null
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const on = await isSocialFlagOn('friend_suggestions').catch(() => false)
  if (!on) return NextResponse.json({ enabled: false, events: [] }, { headers: NO_STORE })
  const rl = await friendsGoingRateLimit(uid).catch(() => ({ limited: true }))
  if (rl.limited) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: NO_STORE })
  try {
    const events = await getFriendActivity(uid)
    return NextResponse.json({ enabled: true, events }, { headers: NO_STORE })
  } catch (err) {
    console.error('[social/friend-activity] failed', err)
    return NextResponse.json({ enabled: true, events: [] }, { headers: NO_STORE })
  }
}
