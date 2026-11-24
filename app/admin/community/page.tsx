/**
 * /admin/community: the community moderation queue (lib/community). Shared
 * events to check, edit and publish (or reject, or merge into an event that
 * is already on Tikèm), and claims from organizers. The layout already gates
 * admins; every action route re-checks requireAdmin.
 */
import CommunityReview from './CommunityReview'

export const dynamic = 'force-dynamic'

export default function AdminCommunityPage() {
  return <CommunityReview />
}
