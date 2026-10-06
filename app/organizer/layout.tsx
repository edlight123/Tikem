import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { OrganizerTopNav } from '@/components/organizer/OrganizerTopNav'
import OrganizerChrome from '@/components/organizer/OrganizerChrome'
import { isAdmin } from '@/lib/admin'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getOrganizerStats(organizerId: string) {
  try {
    // Get draft events count
    const draftEventsSnap = await adminDb.collection('events')
      .where('organizer_id', '==', organizerId)
      .where('status', '==', 'draft')
      .count()
      .get()

    const draftEvents = draftEventsSnap.data().count || 0

    // Get pending payout requests count
    const pendingPayoutsSnap = await adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('payouts')
      .where('status', '==', 'pending')
      .count()
      .get()

    const pendingPayouts = pendingPayoutsSnap.data().count || 0

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

  // If not an organizer, show upgrade prompt (handled by each page)
  if (user.role !== 'organizer') {
    return (
      <OrganizerChrome
        chromeTop={<Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />}
        chromeBottom={<MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />}
      >
        {children}
      </OrganizerChrome>
    )
  }

  // Fetch organizer-specific stats for badges
  const { draftEvents, pendingPayouts } = await getOrganizerStats(user.id)

  const accountInitial = (user.full_name || user.email || 'U').trim().charAt(0).toUpperCase()

  return (
    <OrganizerChrome
      chromeTop={
        // Single Posh-style top bar (replaces the global site navbar in /organizer)
        <OrganizerTopNav
          draftEvents={draftEvents}
          pendingPayouts={pendingPayouts}
          accountInitial={accountInitial}
        />
      }
      chromeBottom={<MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />}
    >
      {children}
    </OrganizerChrome>
  )
}
