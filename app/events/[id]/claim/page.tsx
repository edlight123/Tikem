/**
 * /events/:id/claim: "Is this your event? Claim it" for a community-shared
 * event (lib/community). Signed out → sign in first. An event that is not
 * claimable goes back to its page.
 */
import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import { adminDb } from '@/lib/firebase/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import ClaimEventClient from './ClaimEventClient'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Claim this event | Tikèm', robots: { index: false } }

export default async function ClaimEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) redirect(`/auth/login?redirect=${encodeURIComponent(`/events/${id}/claim`)}`)
  const snap = await adminDb.collection('events').doc(id).get()
  if (!snap.exists) notFound()
  const event = snap.data() || {}
  if (event.claimable !== true) redirect(`/events/${id}`)
  const admin = isAdmin((user as any)?.email_verified ? user.email : null)
  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      <Navbar user={user} isAdmin={admin} />
      <div className="mx-auto w-full max-w-xl px-4 py-7 sm:px-6 sm:py-10">
        <ClaimEventClient
          eventId={id}
          eventTitle={String(event.title || '')}
          sourceName={String(event.source_name || '')}
        />
      </div>
      <MobileNavWrapper user={user} isAdmin={admin} />
    </div>
  )
}
