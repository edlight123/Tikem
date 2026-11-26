import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { respondToConnectionRequest } from '@/lib/firestore/connections'
import { createNotification } from '@/lib/notifications/helpers'
import { pushFriendRequest } from '@/lib/social/friend-push'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { targetUserId, action } = await request.json()
    if (!targetUserId || typeof targetUserId !== 'string') {
      return NextResponse.json({ error: 'targetUserId is required' }, { status: 400 })
    }
    if (action !== 'accept' && action !== 'decline') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const result = await respondToConnectionRequest(user.id, targetUserId, action)
    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Failed' }, { status: 400 })
    }

    if (action === 'accept' && result.status === 'friends') {
      try {
        const actorName = user.full_name || 'Someone'
        await createNotification(
          targetUserId,
          'connection_accepted',
          'Friend request accepted',
          `${actorName} accepted your friend request. You are now connected.`,
          '/connections',
          { actorId: user.id }
        )
        await pushFriendRequest(targetUserId, { id: user.id, name: actorName }, 'accepted')
      } catch (e) {
        console.warn('[connections/respond] notification failed', e)
      }
    }

    return NextResponse.json({ ok: true, status: result.status })
  } catch (error: any) {
    console.error('Error responding to connection request:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
