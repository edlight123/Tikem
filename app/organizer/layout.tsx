import { cookies } from 'next/headers'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { OrganizerTopNav } from '@/components/organizer/OrganizerTopNav'
import OrganizerChrome from '@/components/organizer/OrganizerChrome'
import { OrgRoleProvider } from '@/components/organizer/OrgRoleProvider'
import { isAdmin } from '@/lib/admin'
import { adminDb } from '@/lib/firebase/admin'
import { ConfirmProvider } from '@/components/ui/ConfirmProvider'
import { ORG_COOKIE, listMemberships, orgDisplayName } from '@/lib/organizer/context'
import { orgCan } from '@/lib/organizer/teamRoles'
import { getPortalOrgContext } from './_lib/orgPage'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getOrganizerStats(orgId: string, includePayouts: boolean) {
  try {
    // Get draft events count
    const draftEventsSnap = await adminDb.collection('events')
      .where('organizer_id', '==', orgId)
      .where('status', '==', 'draft')
      .count()
      .get()

    const draftEvents = draftEventsSnap.data().count || 0

    // Pending payout requests: money is the owner's business only.
    let pendingPayouts = 0
    if (includePayouts) {
      const pendingPayoutsSnap = await adminDb
        .collection('organizers')
        .doc(orgId)
        .collection('payouts')
        .where('status', '==', 'pending')
        .count()
        .get()
      pendingPayouts = pendingPayoutsSnap.data().count || 0
    }

    return { draftEvents, pendingPayouts }
  } catch (error) {
    console.error('Error fetching organizer stats:', error)
    return { draftEvents: 0, pendingPayouts: 0 }
  }
}

export default async function OrganizerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/auth/login?redirect=/organizer')
  }

  const adminFlag = isAdmin(((user as any)?.email_verified) ? user?.email : null)

  // The org this request acts for (own org, or one the account is on the team
  // of as admin/manager). None: the public chrome, and each page shows the
  // upgrade prompt or redirects, as before teams existed.
  const ctx = await getPortalOrgContext()
  if (!ctx) {
    return (
      <OrganizerChrome
        chromeTop={<Navbar user={user} isAdmin={adminFlag} />}
        chromeBottom={<MobileNavWrapper user={user} isAdmin={adminFlag} />}
      >
        <ConfirmProvider tone="posh">{children}</ConfirmProvider>
      </OrganizerChrome>
    )
  }

  const isOrganizer = user.role === 'organizer' || user.role === 'admin' || user.role === 'super_admin'
  const [{ draftEvents, pendingPayouts }, orgName, memberships, ownName] = await Promise.all([
    getOrganizerStats(ctx.orgId, ctx.isOwner),
    ctx.isOwner ? Promise.resolve('') : orgDisplayName(ctx.orgId),
    listMemberships(user.id).catch(() => []),
    isOrganizer ? orgDisplayName(user.id) : Promise.resolve(''),
  ])

  // Orgs this account can run from the portal (staff seats grant nothing org-wide).
  const orgs = [
    ...(isOrganizer ? [{ orgId: user.id, orgName: ownName || user.full_name || user.email || '', role: 'owner' as const }] : []),
    ...memberships
      .filter((m) => orgCan(m.role, 'view'))
      .map((m) => ({ orgId: m.orgId, orgName: m.orgName, role: m.role })),
  ]
  const activeOrgName = ctx.isOwner
    ? ownName || user.full_name || user.email || ''
    : orgName || memberships.find((m) => m.orgId === ctx.orgId)?.orgName || ''

  // The switcher cookie points at an org this portal is not acting for (a
  // staff-only seat, or a membership that was removed): clear it client-side
  // so API calls and pages agree on the org.
  const cookieOrg = (await cookies()).get(ORG_COOKIE)?.value || ''
  const staleOrgCookie = Boolean(cookieOrg) && cookieOrg !== ctx.orgId

  const accountInitial = (user.full_name || user.email || 'U').trim().charAt(0).toUpperCase()

  return (
    <OrgRoleProvider value={{ orgId: ctx.orgId, orgName: activeOrgName, role: ctx.role, isOwner: ctx.isOwner, financeView: ctx.financeView }}>
      <OrganizerChrome
        chromeTop={
          // Single Posh-style top bar (replaces the global site navbar in /organizer)
          <OrganizerTopNav
            draftEvents={draftEvents}
            pendingPayouts={pendingPayouts}
            accountInitial={accountInitial}
            orgs={orgs}
            staleOrgCookie={staleOrgCookie}
          />
        }
        chromeBottom={<MobileNavWrapper user={user} isAdmin={adminFlag} />}
      >
        <ConfirmProvider tone="posh">{children}</ConfirmProvider>
      </OrganizerChrome>
    </OrgRoleProvider>
  )
}
