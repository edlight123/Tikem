/**
 * Blocks vs attendee ↔ organizer messages (SERVER-SIDE ONLY).
 *
 * A conversation has two SIDES, not two people:
 *  - the attendee (the thread's `sender_id`), a person;
 *  - the organization (the thread's `organizer_id`). Its account owner and its
 *    active team admins speak for it, and any team member who may answer
 *    (lib/messages/threadViewer, 'manage_events') can type a reply.
 *
 * The thread is closed to new messages and reactions, in both directions,
 * when either side has blocked the other:
 *  - the ORG blocked the attendee: the owner or an active admin (or, for a
 *    reply, the team member typing it) has a block on the attendee's uid;
 *  - the ATTENDEE blocked the org: they blocked the org's account, or (for a
 *    reply) the team member typing it.
 * Blocks live at users/{uid}/blocked_organizers/{otherUid} (lib/moderation/blocks.ts).
 *
 * The org is always the thread's own `organizer_id`, never the org the app is
 * acting for (the same rule as threadViewer: Freddy, 2026-11-17).
 *
 * Every read fails open: a Firestore fault must not silently swallow every
 * message (isBlockedByAny logs and answers false).
 */
import { isBlockedByAny } from '@/lib/moderation/blocks'
import { teamCol } from '@/lib/organizer/context'

/** Bound on the admins read per check; an org with more is not a real case today. */
const MAX_ADMINS = 25

export type BlockCode = 'blocked' | 'you_blocked'

export interface ThreadBlockState {
  /** The org (owner, an admin, or the acting team member) blocked the attendee. */
  orgBlockedAttendee: boolean
  /** The attendee blocked the org (or the acting team member). */
  attendeeBlockedOrg: boolean
}

/** The org's account plus its active admins: the people who speak for it. */
export async function orgVoiceIds(orgId: string): Promise<string[]> {
  const out = new Set<string>()
  const org = String(orgId || '').trim()
  if (!org) return []
  out.add(org)
  try {
    const snap = await teamCol(org)
      .where('role', '==', 'admin')
      .where('status', '==', 'active')
      .limit(MAX_ADMINS)
      .get()
    for (const d of snap.docs as any[]) if (d?.id) out.add(String(d.id))
  } catch (err) {
    console.error('[blockGuard] admin lookup failed', err)
  }
  return Array.from(out)
}

/**
 * Both directions of the block between a thread's attendee and its org.
 * `actingUserId` is the team member about to write on the org's behalf (omit
 * when the attendee is the one writing, or when only displaying the state).
 */
export async function threadBlockState(params: {
  orgId: string
  attendeeId: string
  actingUserId?: string | null
}): Promise<ThreadBlockState> {
  const orgId = String(params.orgId || '').trim()
  const attendeeId = String(params.attendeeId || '').trim()
  if (!orgId || !attendeeId || orgId === attendeeId) {
    return { orgBlockedAttendee: false, attendeeBlockedOrg: false }
  }
  const acting = String(params.actingUserId || '').trim()
  const voices = await orgVoiceIds(orgId)
  const orgSide = Array.from(new Set([...voices, ...(acting ? [acting] : [])])).filter((id) => id !== attendeeId)

  const [orgChecks, attendeeBlockedOrg] = await Promise.all([
    Promise.all(orgSide.map((id) => isBlockedByAny(id, [attendeeId]))),
    isBlockedByAny(attendeeId, [orgId, acting]),
  ])
  return { orgBlockedAttendee: orgChecks.some(Boolean), attendeeBlockedOrg }
}

/**
 * The refusal for a write from `side`, or null when it may go ahead.
 *  - 'blocked': the OTHER side blocked the writer.
 *  - 'you_blocked': the writer's own side blocked the other; unblock to write.
 */
export function refusalFor(side: 'attendee' | 'organizer', state: ThreadBlockState): BlockCode | null {
  if (side === 'attendee') {
    if (state.orgBlockedAttendee) return 'blocked'
    if (state.attendeeBlockedOrg) return 'you_blocked'
    return null
  }
  if (state.attendeeBlockedOrg) return 'blocked'
  if (state.orgBlockedAttendee) return 'you_blocked'
  return null
}

/** The English (log-facing) error for a refusal; the apps localize off the code. */
export function blockMessage(code: BlockCode): string {
  return code === 'you_blocked'
    ? 'You blocked this person. Unblock them to send a message.'
    : 'You can’t message this person.'
}

/** One call for a write path: the refusal code, or null. */
export async function messagingRefusal(params: {
  side: 'attendee' | 'organizer'
  orgId: string
  attendeeId: string
  actingUserId?: string | null
}): Promise<BlockCode | null> {
  const state = await threadBlockState({
    orgId: params.orgId,
    attendeeId: params.attendeeId,
    actingUserId: params.side === 'organizer' ? params.actingUserId : null,
  })
  return refusalFor(params.side, state)
}
