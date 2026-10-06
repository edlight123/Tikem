import type { Metadata } from 'next'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import ResourcesContent from '@/components/resources/ResourcesContent'

export const metadata: Metadata = {
  title: 'Guides & Resources | Tikèm',
  description:
    'Step-by-step guides for organizers and attendees, creating events, posters, pricing, payouts, the door, and buying tickets. Read online or download the PDF.',
}

// Reads auth cookies for the navbar context.
export const dynamic = 'force-dynamic'

// The page itself is a client experience (i18n, scroll films); this server
// shell only resolves the user for the chrome.
export default async function ResourcesPage() {
  const user = await getCurrentUser()

  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
      <ResourcesContent />
      <MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
    </div>
  )
}
