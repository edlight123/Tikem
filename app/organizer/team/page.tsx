import { adminDb } from '@/lib/firebase/admin'
import { roster } from '@/lib/organizer/teamRoster'
import { TranslatedPageHeader } from '@/components/organizer/ui/TranslatedPageHeader'
import { requireOrgPage } from '../_lib/orgPage'
import OrgTeamClient, { type TeamRow } from './OrgTeamClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function OrganizerTeamPage() {
  // Owners and org admins manage the team (manage_team); everyone else goes to /organizer.
  const ctx = await requireOrgPage('manage_team', '/organizer/team')

  let members: TeamRow[] = []
  let loadError = false
  try {
    members = await roster(ctx.orgId)
  } catch (e) {
    console.error('Team roster failed to load:', e)
    loadError = true
  }

  // The owner is never a team row: it is the account the org belongs to.
  let ownerName = ''
  let ownerEmail = ''
  if (ctx.isOwner) {
    ownerName = ctx.user.full_name || ''
    ownerEmail = ctx.user.email || ''
  } else {
    try {
      const owner = (await adminDb.collection('users').doc(ctx.orgId).get()).data() || {}
      ownerName = String(owner.full_name || owner.organization_name || '')
      ownerEmail = String(owner.email || '')
    } catch {
      /* the row still renders with the role */
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 md:py-10">
      <TranslatedPageHeader eyebrowKey="organization" titleKey="org_team_title" subtitleKey="org_team_subtitle" />
      <div className="mt-8">
        <OrgTeamClient
          ownerName={ownerName || ownerEmail}
          ownerEmail={ownerEmail}
          viewerIsOwner={ctx.isOwner}
          viewerId={ctx.user.id}
          members={members}
          loadError={loadError}
        />
      </div>
    </div>
  )
}
