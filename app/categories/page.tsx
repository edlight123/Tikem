import { createClient } from '@/lib/firebase-db/server'
import type { Metadata } from 'next'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import CategoriesContent from './CategoriesContent'

export const revalidate = 120 // Cache for 2 minutes

// Uses auth cookies for Navbar/user context.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Event categories | Tikèm',
  description: 'Browse concerts, parties, festivals, food, sports and more on Tikèm.',
  alternates: { canonical: '/categories' },
}

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const user = await getCurrentUser()
  const params = await searchParams

  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
      <CategoriesContent initialCategory={params.category} />
      <MobileNavWrapper user={user} />
    </div>
  )
}
