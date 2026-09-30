import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { isOrganizerBlocked } from '@/lib/moderation/blocks'

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { organizerId } = await request.json()

    if (!organizerId) {
      return Response.json({ error: 'Organizer ID required' }, { status: 400 })
    }

    if (organizerId === user.id) {
      return Response.json({ error: 'Cannot follow yourself' }, { status: 400 })
    }

    // Check if already following
    const existingSnapshot = await adminDb
      .collection('organizer_follows')
      .where('follower_id', '==', user.id)
      .where('organizer_id', '==', organizerId)
      .limit(1)
      .get()

    // A blocked organizer cannot be (re)followed: blocking removed the follow,
    // and following again would restart their "new event" notifications.
    if (existingSnapshot.empty && (await isOrganizerBlocked(user.id, organizerId))) {
      return Response.json(
        { error: 'Unblock this organizer to follow them.', code: 'blocked' },
        { status: 409 }
      )
    }

    if (!existingSnapshot.empty) {
      // Unfollow
      const docId = existingSnapshot.docs[0].id
      await adminDb
        .collection('organizer_follows')
        .doc(docId)
        .delete()

      return Response.json({ isFollowing: false })
    } else {
      // Follow
      await adminDb
        .collection('organizer_follows')
        .add({
          follower_id: user.id,
          organizer_id: organizerId,
          created_at: new Date()
        })

      return Response.json({ isFollowing: true })
    }
  } catch (error) {
    console.error('Error toggling follow:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
