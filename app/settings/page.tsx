import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import Navbar from '@/components/Navbar'
import { redirect } from 'next/navigation'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { revalidatePath } from 'next/cache'
import SettingsPageClient from './SettingsPageClient'

export const revalidate = 60 // Cache for 1 minute

// Depends on auth cookies and per-user settings.
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/auth/login?redirect=/settings')
  }

  async function refreshPage() {
    'use server'
    revalidatePath('/settings')
  }

  return (
    <div className="min-h-screen bg-canvas pb-mobile-nav">
      <Navbar user={user} />

      <SettingsPageClient user={user} />
      
      <MobileNavWrapper user={user} />
    </div>
  )
}
