/**
 * POST /api/messages/[id]/react   body: { message_id, emoji }
 *
 * Toggle the caller's emoji reaction on one message of a conversation: the
 * opening message (`message_id: "opening"`) or any reply. Tapping the same
 * emoji again removes it; a different one replaces it (one reaction per person
 * per message). Only ALLOWED_REACTIONS are accepted (lib/messages/threadExtras).
 *
 * Who may react is who may write in the thread, with the same checks as the
 * two reply routes: the attendee who opened it, or the organization it is
 * addressed to (its account, or a team member whose role may answer:
 * getThreadForOrgMember 'manage_events', decided by the THREAD'S own org).
 * Everyone else, and a missing thread, get the same 404. A block either way
 * refuses with 403 `blocked` / `you_blocked` (lib/messages/blockGuard.ts).
 *
 * No push or notification: a reaction is not worth an interruption
 * (lib/notifications/policy.ts keeps those for things that need an answer).
 *
 * Responds with the message's reactions as the caller sees them (counts plus
 * "mine"), never who reacted.
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getThreadForParticipant, toggleMessageReaction } from '@/lib/organizer-messages'
import { getThreadForOrgMember } from '@/lib/messages/threadViewer'
import { isAllowedReaction, isValidMessageId } from '@/lib/messages/threadExtras'
import { blockMessage, messagingRefusal } from '@/lib/messages/blockGuard'

export const dynamic = 'force-dynamic'

function fail(error: string, code: string, status = 400) {
  return NextResponse.json({ error, code }, { status })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: threadId } = await params
    if (!threadId) return fail('Message is required.', 'missing_thread_id')

    const user = await getCurrentUser()
    if (!user) return fail('You must be signed in to react.', 'unauthorized', 401)

    let body: any
    try {
      body = await request.json()
    } catch {
      return fail('Malformed request body.', 'bad_request')
    }

    const messageId = body?.message_id
    if (!isValidMessageId(messageId)) return fail('Pick a message to react to.', 'missing_message_id')
    const emoji = body?.emoji
    if (!isAllowedReaction(emoji)) return fail('That reaction is not available.', 'invalid_reaction')

    // The attendee of THIS thread reacts as the attendee; everyone else must be
    // able to answer for the thread's own org.
    const participant = await getThreadForParticipant(threadId, user.id)
    const asAttendee = participant?.role === 'attendee'
    const member = asAttendee ? null : await getThreadForOrgMember(threadId, user, 'manage_events')
    if (!asAttendee && !member) return fail('Message not found.', 'thread_not_found', 404)

    const data = (asAttendee ? participant!.data : member!.data) || {}
    const refusal = await messagingRefusal({
      side: asAttendee ? 'attendee' : 'organizer',
      orgId: String(data.organizer_id || ''),
      attendeeId: String(data.sender_id || ''),
      actingUserId: asAttendee ? null : user.id,
    })
    if (refusal) return fail(blockMessage(refusal), refusal, 403)

    const result = await toggleMessageReaction({ threadId, messageId, userId: user.id, emoji })
    if (!result.ok) return fail('Message not found.', 'message_not_found', 404)

    return NextResponse.json({
      ok: true,
      message_id: messageId,
      reactions: result.reactions,
      mine: result.mine,
    })
  } catch (error) {
    console.error('message reaction failed', error)
    return fail('Could not save your reaction. Try again.', 'internal_error', 500)
  }
}
