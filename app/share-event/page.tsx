/**
 * /share-event: "Share an event" (lib/community). A signed-in member sends a
 * flyer they saw; an admin checks it and publishes it credited to its source.
 * Signed out → sign in first (shares are rate-limited per account).
 */
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import ShareEventClient from './ShareEventClient'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Share an event | Tikèm',
  description: 'Saw a flyer? Share the event and we will add it to Tikèm, credited to its organizer.',
}

export default async function ShareEventPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/auth/login?redirect=/share-event')
  const admin = isAdmin((user as any)?.email_verified ? user.email : null)
  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      <Navbar user={user} isAdmin={admin} />
      <div className="mx-auto w-full max-w-xl px-4 py-7 sm:px-6 sm:py-10">
        <ShareEventClient />
      </div>
      <MobileNavWrapper user={user} isAdmin={admin} />
    </div>
  )
}
