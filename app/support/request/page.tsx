import { getCurrentUser } from '@/lib/auth'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { isAdmin } from '@/lib/admin'
import SupportRequestForm from './SupportRequestForm'

export const metadata = {
  title: 'Submit Support Request - Tikèm',
  description: 'Submit a detailed support request and our team will get back to you within 24 hours.',
}

// Uses auth cookies for Navbar/user context.
export const dynamic = 'force-dynamic'

export default async function SupportRequestPage() {
  const user = await getCurrentUser()

  return (
      <div className="min-h-screen bg-[#0a0a0a] pb-mobile-nav">
        <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
        
        <SupportRequestForm />
        
        <MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
      </div>
  )
}
