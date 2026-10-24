/**
 * GET /api/messages
 *
 * The signed-in attendee's own conversations with organizers: every thread they
 * opened through /api/events/contact-organizer, newest activity first, with the
 * event poster, the last message preview and an unread flag (the organizer said
 * something they have not opened yet).
 *
 * Scoped by `sender_id == <session user>` and nothing else; the caller never
 * supplies whose threads to list. The organizer's side of the same threads is
 * GET /api/organizer/messages.
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { listThreadsForAttendee } from '@/lib/organizer-messages'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'You must be signed in.', code: 'unauthorized' },
        { status: 401 }
      )
    }

    const threads = await listThreadsForAttendee(user.id)
    return NextResponse.json({
      threads,
      unreadCount: threads.filter((t) => t.unread).length,
    })
  } catch (error) {
    console.error('messages list failed', error)
    return NextResponse.json(
      { error: 'Could not load your messages.', code: 'internal_error' },
      { status: 500 }
    )
  }
}
