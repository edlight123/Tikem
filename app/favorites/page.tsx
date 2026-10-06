import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import FavoritesContent from './FavoritesContent'
import FavoritesSignInPrompt from './FavoritesSignInPrompt'

export const revalidate = 30 // Cache for 30 seconds

// Uses auth cookies for personalization / access control.
export const dynamic = 'force-dynamic'

export default async function FavoritesPage() {
  const user = await getCurrentUser()

  if (!user) {
    return (
      <div className="surface-dark min-h-screen pb-mobile-nav">
        <Navbar user={null} />
        <FavoritesSignInPrompt />
      </div>
    )
  }

  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
      <FavoritesContent userId={user.id} />
      <MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
    </div>
  )
}
