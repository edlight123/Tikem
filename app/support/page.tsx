import { getCurrentUser } from '@/lib/auth'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { isAdmin } from '@/lib/admin'
import SupportContent from './SupportContent'

export const metadata = {
  title: 'Support - Tikèm Help Center',
  description: 'Get help with tickets, events, and your organizer account. Browse FAQs and contact support.',
}

// Uses auth cookies for Navbar/user context.
export const dynamic = 'force-dynamic'

export default async function SupportPage() {
  const user = await getCurrentUser()

  return (
      <div className="min-h-screen bg-[#0a0a0a] pb-mobile-nav">
        <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
        
        <SupportContent />
        
        <MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
      </div>
  )
}
