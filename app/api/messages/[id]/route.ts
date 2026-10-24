/**
 * GET /api/messages/[id]
 *
 * One conversation, in order: the attendee's opening message, then every reply
 * and follow-up from either side. Readable by its TWO participants only (the
 * attendee who opened it and the organizer it is addressed to). Anybody else,
 * and a thread that does not exist, get the same 404 so the endpoint can't be
 * used to probe which ids are real.
 *
 * Reading does not mark the thread read; that is POST /api/messages/[id]/read,
 * so a prefetch or a retry never clears a badge by accident.
 *
 * PRIVACY: the view carries the attendee's display name only, never their
 * email or phone (the thread document doesn't store either).
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { buildConversationView, getThreadForParticipant } from '@/lib/organizer-messages'

export const dynamic = 'force-dynamic'

export async function GET(
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

    const thread = await buildConversationView(record)
    return NextResponse.json({ thread })
  } catch (error) {
    console.error('messages thread failed', error)
    return NextResponse.json(
      { error: 'Could not load this conversation.', code: 'internal_error' },
      { status: 500 }
    )
  }
}
