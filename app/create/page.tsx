import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import EventComposer from '@/app/organizer/events/EventComposer'

export const metadata: Metadata = {
  title: 'Create an event | Tikèm',
  description:
    'Set up your event on Tikèm in minutes, name, date, venue, tickets. Free to start; sign in only when you publish.',
}

export const dynamic = 'force-dynamic'

// The churn-killer: ANYONE can compose their event here, signed out. The form
// autosaves locally; sign-up happens at the very end and the draft follows
// them through it (see EventComposer's guest mode). Organizers who land here
// go straight to the real composer.
export default async function CreatePage() {
  const user = await getCurrentUser()

  if (user?.role === 'organizer') {
    redirect('/organizer/events/new')
  }

  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
      <EventComposer userId={user?.id || ''} guest authed={!!user} />
      <MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
    </div>
  )
}
