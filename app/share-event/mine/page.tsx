/**
 * /share-event/mine: the member's own shares ("My shared events") with where
 * each one stands: Live, Waiting for review, or Not approved.
 */
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import MySharesClient from './MySharesClient'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'My shared events | Tikèm', robots: { index: false } }

export default async function MySharesPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/auth/login?redirect=/share-event/mine')
  const admin = isAdmin((user as any)?.email_verified ? user.email : null)
  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      <Navbar user={user} isAdmin={admin} />
      <div className="mx-auto w-full max-w-xl px-4 py-7 sm:px-6 sm:py-10">
        <MySharesClient />
      </div>
      <MobileNavWrapper user={user} isAdmin={admin} />
    </div>
  )
}
