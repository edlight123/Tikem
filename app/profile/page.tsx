import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import { getUserProfileAdmin, createUserProfileAdmin } from '@/lib/firestore/user-profile-admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import ProfileClient from './ProfileClient'

export const revalidate = 60 // Cache for 1 minute

// Depends on auth cookies and per-user profile data.
export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/auth/login?redirect=/profile')
  }

  // Try to get existing profile using admin SDK
  let profile = await getUserProfileAdmin(user.id)

  // If profile doesn't exist, create it
  if (!profile) {
    await createUserProfileAdmin(user.id, {
      displayName: user.full_name || '',
      email: user.email || '',
      photoURL: '',
      phone: user.phone_number || '',
      defaultCountry: 'HT',
      defaultCity: '',
      subareaType: 'COMMUNE',
      defaultSubarea: '',
      favoriteCategories: [],
      language: 'en',
      notify: {
        reminders: true,
        updates: true,
        promos: false
      }
    })

    // Fetch the newly created profile
    profile = await getUserProfileAdmin(user.id)
  }

  if (!profile) {
    redirect('/auth/login?redirect=/profile')
  }

  const isVerifiedOrganizer = profile.verificationStatus === 'approved'

  // Serialize all data before passing to client component
  const serializeData = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate().toISOString()
    if (Array.isArray(obj)) return obj.map(serializeData)
    
    const serialized: any = {}
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        serialized[key] = serializeData(obj[key])
      }
    }
    return serialized
  }

  const serializedProfile = serializeData(profile)

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-mobile-nav">
      <Navbar user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 md:py-10">
        <ProfileClient 
          initialProfile={serializedProfile} 
          userId={user.id}
          isVerifiedOrganizer={isVerifiedOrganizer}
        />
      </div>

      <MobileNavWrapper user={user} isAdmin={isAdmin(((user as any)?.email_verified) ? user?.email : null)} />
    </div>
  )
}
