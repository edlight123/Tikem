import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { sendConnectionRequest } from '@/lib/firestore/connections'
import { createNotification } from '@/lib/notifications/helpers'
import { isOrganizerBlocked } from '@/lib/moderation/blocks'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { targetUserId } = await request.json()
    if (!targetUserId || typeof targetUserId !== 'string' || targetUserId.includes('/')) {
      return NextResponse.json({ error: 'targetUserId is required' }, { status: 400 })
    }

    // Make sure the target exists.
    const targetDoc = await adminDb.collection('users').doc(targetUserId).get()
    if (!targetDoc.exists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // A block either way (users/{uid}/blocked_organizers covers people too)
    // stops friend requests: a blocked person must not keep pinging.
    const [theyBlocked, iBlocked] = await Promise.all([
      isOrganizerBlocked(targetUserId, user.id),
      isOrganizerBlocked(user.id, targetUserId),
    ])
    if (theyBlocked || iBlocked) {
      return NextResponse.json({ error: 'You cannot send a request to this person.' }, { status: 403 })
    }

    const result = await sendConnectionRequest(user.id, targetUserId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Failed' }, { status: 400 })
    }
    // Already friends, or our request was already pending: nothing to announce
    // (tapping Add friend twice used to notify the other person twice).
    if (result.unchanged) {
      return NextResponse.json({ ok: true, status: result.status })
    }

    // Best-effort notification to the other user.
    try {
      const actorName = user.full_name || 'Someone'
      if (result.status === 'request_sent') {
        await createNotification(
          targetUserId,
          'connection_request',
          'New friend request',
          `${actorName} wants to connect with you on Tikèm.`,
          '/connections',
          { actorId: user.id }
        )
      } else if (result.status === 'friends') {
        // Auto-accepted an existing incoming request → tell the other person.
        await createNotification(
          targetUserId,
          'connection_accepted',
          'You are now friends',
          `${actorName} accepted your friend request.`,
          '/connections',
          { actorId: user.id }
        )
      }
    } catch (e) {
      console.warn('[connections/request] notification failed', e)
    }

    return NextResponse.json({ ok: true, status: result.status })
  } catch (error: any) {
    console.error('Error sending connection request:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
