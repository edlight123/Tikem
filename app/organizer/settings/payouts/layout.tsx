import { redirectNonOwners } from '@/app/organizer/_lib/orgPage'

export const dynamic = 'force-dynamic'

/**
 * Owner-only area (lib/organizer/teamRoles.ts `owner_only`): the pages below
 * read and write the signed-in account's own payout / verification records, so
 * a team member acting for another org is sent back to /organizer.
 */
export default async function OwnerOnlyLayout({ children }: { children: React.ReactNode }) {
  await redirectNonOwners()
  return <>{children}</>
}
