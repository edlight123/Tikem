import { getOrgContext } from '@/lib/organizer/context'
import { orgCan } from '@/lib/organizer/teamRoles'
import {
  getThreadForOrganizer,
  getThreadForParticipant,
  type ParticipantRole,
} from '@/lib/organizer-messages'

/**
 * Who may open one attendee ↔ organizer conversation (GET /api/messages/[id]
 * and its /read):
 *
 * - its two participants: the attendee who asked (`sender_id`) and the
 *   organizer account it is addressed to (`organizer_id`);
 * - a member of that organizer's TEAM whose role may view the inbox. The
 *   organizer inbox (/api/organizer/messages) already lists these threads for
 *   them, so the conversation screen has to open for them too, or tapping a
 *   row in the app's Messages tab would 404 for every admin and manager.
 *
 * Anybody else, and a missing thread, get null (callers answer 404 either way).
 */
export async function getThreadForViewer(
  threadId: string,
  userId: string
): Promise<{ id: string; data: Record<string, any>; role: ParticipantRole } | null> {
  const direct = await getThreadForParticipant(threadId, userId)
  if (direct) return direct

  const org = await getOrgContext()
  if (!org || !orgCan(org.role, 'view')) return null
  const thread = await getThreadForOrganizer(threadId, org.orgId)
  return thread ? { ...thread, role: 'organizer' } : null
}
