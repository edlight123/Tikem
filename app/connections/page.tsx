/**
 * /connections — auth-gated friends surface.
 *
 * The shell only: auth gate, one server read, and the dark public canvas. All
 * of the UI (header, tabs, lists, search, contact matching) lives in
 * ConnectionsClient so the page's visual structure is readable in one file.
 *
 * `max-w-2xl` rather than 3xl: every row here is avatar + name + one action,
 * so a wider column just stretches a 15px name across dead space. A reading
 * measure keeps the list feeling like a list.
 */
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import { getConnectionsOverview } from '@/lib/firestore/connections'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import ConnectionsClient from './ConnectionsClient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Friends | Tikèm',
  description: 'Connect with friends and see who\'s going to events.',
}

export default async function ConnectionsPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/auth/login?redirect=/connections')
  }

  const overview = await getConnectionsOverview(user.id)

  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />

      <div className="mx-auto w-full max-w-2xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
        <ConnectionsClient initialOverview={overview} />
      </div>

      <MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
    </div>
  )
}
