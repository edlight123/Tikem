/**
 * POST /api/organizer/messages/[id]/read
 *
 * Acknowledge a thread so it stops counting as unread. Separate from the reply
 * route because opening a message is not the same act as answering it — an
 * organizer may read a question, decide it needs no answer, and should still see
 * their badge clear.
 *
 * Idempotent: the first acknowledgement is the one kept.
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { requireOrg } from '@/lib/organizer/context'
import { getThreadForOrganizer, markThreadRead } from '@/lib/organizer-messages'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: threadId } = await params
    if (!threadId) {
      return NextResponse.json(
        { error: 'Message is required.', code: 'missing_thread_id' },
        { status: 400 }
      )
    }

    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'You must be signed in.', code: 'unauthorized' },
        { status: 401 }
      )
    }

    const org = await requireOrg('view')
    if (!org.ok) return org.response

    const thread = await getThreadForOrganizer(threadId, org.value.orgId)
    if (!thread) {
      return NextResponse.json(
        { error: 'Message not found.', code: 'thread_not_found' },
        { status: 404 }
      )
    }

    await markThreadRead(threadId, Boolean(thread.data.organizer_read_at))
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('organizer message mark-read failed', error)
    return NextResponse.json(
      { error: 'Could not update the message.', code: 'internal_error' },
      { status: 500 }
    )
  }
}
