import { createClient } from '@/lib/firebase-db/server'
import { requireAuth } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { redirect } from 'next/navigation'
import TicketsPageClient from './TicketsPageClient'
import { Suspense } from 'react'
import LoadingSkeleton from '@/components/ui/LoadingSkeleton'
import MyTicketsList from './sections/MyTicketsList'

export const dynamic = 'force-dynamic'
export const revalidate = 30 // Cache for 30 seconds

// Helper function to serialize all Timestamp objects recursively
function serializeTimestamps(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj
  
  // Check if it's a Firestore Timestamp
  if (obj.toDate && typeof obj.toDate === 'function') {
    return obj.toDate().toISOString()
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => serializeTimestamps(item))
  }
  
  // Handle plain objects
  const serialized: any = {}
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      serialized[key] = serializeTimestamps(obj[key])
    }
  }
  return serialized
}

export default async function MyTicketsPage() {
  const { user, error } = await requireAuth()

  if (error || !user) {
    redirect('/auth/login?redirect=/tickets')
  }

  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />

      <TicketsPageClient userId={user.id}>
        <Suspense fallback={<LoadingSkeleton rows={5} animated={false} />}>
          <MyTicketsList userId={user.id} />
        </Suspense>
      </TicketsPageClient>
      
      <MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
    </div>
  )
}
