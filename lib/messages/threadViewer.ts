import { adminDb } from '@/lib/firebase/admin'
import { isPlatformAdmin, teamRoleIn } from '@/lib/organizer/context'
import { orgCan, type OrgAction } from '@/lib/organizer/teamRoles'
import { getThreadForParticipant, type ParticipantRole } from '@/lib/organizer-messages'
import type { CurrentUser } from '@/lib/organizer/context'

/**
 * Access to one attendee ↔ organizer conversation is decided by the THREAD'S
 * OWN organization (its `organizer_id`), never by the org the app happens to
 * be acting for — the same rule as canOnEvent.
 *
 * Bug this fixes (2026-11-17): Freddy is an organizer AND an admin on the
 * Tikèm org's team. His app was acting for Tikèm, so replying to a question
 * on his own event "Sunday Vibe" looked the thread up under Tikèm, found
 * nothing and answered 404 ("Message not found"). Opening it worked because
 * that path already checked him as the thread's own organizer.
 */

const COLLECTION = 'organizer_messages'

export interface OrgThreadAccess {
  id: string
  data: Record<string, any>
  /** The thread's organization (organizer_id). */
  orgId: string
  /** The caller IS that organization's account. */
  isOwner: boolean
}

/**
 * The thread, if the caller may do `action` on it as its organization: the org
 * account itself, a team member whose role allows it there, or a platform
 * admin. Null for a missing thread and for everyone else alike (callers answer
 * 404 for both, so ids can't be probed).
 */
export async function getThreadForOrgMember(
  threadId: string,
  user: CurrentUser,
  action: OrgAction
): Promise<OrgThreadAccess | null> {
  if (!threadId || !user?.id) return null
  const snap = await adminDb.collection(COLLECTION).doc(threadId).get()
  if (!snap.exists) return null
  const data = snap.data() || {}
  const orgId = String(data.organizer_id || '')
  if (!orgId) return null

  if (orgId === user.id) {
    return orgCan('owner', action) ? { id: snap.id, data, orgId, isOwner: true } : null
  }
  const role = await teamRoleIn(orgId, user.id)
  if ((role && orgCan(role, action)) || isPlatformAdmin(user)) {
    return { id: snap.id, data, orgId, isOwner: false }
  }
  return null
}

/**
 * Who may OPEN a conversation (GET /api/messages/[id] and its /read): its two
 * participants (the attendee who asked, the organizer it's addressed to), or a
 * member of that organizer's team whose role may view the inbox.
 */
export async function getThreadForViewer(
  threadId: string,
  user: CurrentUser
): Promise<{ id: string; data: Record<string, any>; role: ParticipantRole } | null> {
  const direct = await getThreadForParticipant(threadId, user.id)
  if (direct) return direct

  const team = await getThreadForOrgMember(threadId, user, 'view')
  return team ? { id: team.id, data: team.data, role: 'organizer' } : null
}
