/**
 * POST /api/messages/[id]/read
 *
 * The viewer opened the conversation: clear THEIR unread flag. The attendee's
 * flag is `attendee_unread`; an organizer calling this acknowledges the thread
 * exactly as POST /api/organizer/messages/[id]/read does. Participants only;
 * anyone else gets the same 404 as a missing thread. Idempotent.
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  getThreadForParticipant,
  markThreadRead,
  markThreadReadByAttendee,
} from '@/lib/organizer-messages'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: threadId } = await params
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'You must be signed in.', code: 'unauthorized' },
        { status: 401 }
      )
    }

    const record = await getThreadForParticipant(threadId, user.id)
    if (!record) {
      return NextResponse.json(
        { error: 'Message not found.', code: 'thread_not_found' },
        { status: 404 }
      )
    }

    if (record.role === 'attendee') {
      await markThreadReadByAttendee(record.id, record.data)
    } else {
      await markThreadRead(record.id, Boolean(record.data.organizer_read_at))
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('messages mark-read failed', error)
    return NextResponse.json(
      { error: 'Could not update the conversation.', code: 'internal_error' },
      { status: 500 }
    )
  }
}
