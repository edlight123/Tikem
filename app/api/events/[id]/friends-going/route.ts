/**
 * GET /api/events/[id]/friends-going: up to 5 of the caller's CONNECTIONS who
 * hold a ticket to this event, plus the count. Never anyone else. Behind
 * config/auth.friend_suggestions (fails closed), rate-limited per uid.
 * Privacy rules: lib/social/suggestions.ts#selectFriendsGoing.
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { isSocialFlagOn } from '@/lib/social/flags'
import { friendsGoingRateLimit, handleFriendsGoing } from '@/lib/social/handlers'
import { getFriendsGoing } from '@/lib/social/suggestions-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id || typeof id !== 'string' || id.length > 200 || id.includes('/')) {
    return NextResponse.json({ error: 'Event id is required' }, { status: 400 })
  }
  return handleFriendsGoing({
    getUserId: async () => (await getCurrentUser())?.id ?? null,
    flagOn: () => isSocialFlagOn('friend_suggestions'),
    rateLimit: friendsGoingRateLimit,
    load: (uid) => getFriendsGoing(uid, id),
  })
}
