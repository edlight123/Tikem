import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { canOnEvent } from '@/lib/organizer/context'
import { loadEventRecap } from '@/lib/postEvent/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/organizer/events/:id/recap — the post-event recap: sold vs came,
 * arrivals by half hour, ticket revenue, new followers since the event, and
 * the attendees' (private) ratings and comments. The organizer side only
 * (owner / org admin / org manager), same gate as managing the event.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const eventId = String((await params)?.id || '')
    const snap = eventId ? await adminDb.collection('events').doc(eventId).get() : null
    if (!snap?.exists) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    const event = snap.data() as Record<string, any>
    if (!(await canOnEvent(user, event, 'manage_events')).allowed) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    return NextResponse.json(await loadEventRecap(eventId, event))
  } catch (error) {
    console.error('[organizer/recap] failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
