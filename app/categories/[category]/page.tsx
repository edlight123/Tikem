import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { getDiscoverEvents } from '@/lib/data/events'
import { filterBlockedEvents, getBlockedOrganizerIds } from '@/lib/moderation/blocks'
import { getUserProfileAdmin } from '@/lib/firestore/user-profile-admin'
import { isDemoMode, DEMO_EVENTS } from '@/lib/demo'
import CategoryPageContent from './CategoryPageContent'

export const revalidate = 120

// Reads auth cookies for personalization / Navbar context.
export const dynamic = 'force-dynamic'

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>
}) {
  const { category: rawCategory } = await params
  const category = decodeURIComponent(rawCategory)
  const user = await getCurrentUser()

  // Country used to scope events (mirrors the homepage behaviour).
  let userCountry = 'HT'
  if (user?.id) {
    try {
      const profile = await getUserProfileAdmin(user.id)
      userCountry = profile?.defaultCountry || 'HT'
    } catch (error) {
      console.error('Failed to fetch user profile:', error)
    }
  }

  let events: any[] = []
  if (isDemoMode()) {
    events = (DEMO_EVENTS as any[]).filter((e) => e.category === category)
  } else {
    events = await getDiscoverEvents({ category }, 60)
  }

  // Organizers this viewer blocked never reach their feed (App Store 1.2).
  events = filterBlockedEvents(events, await getBlockedOrganizerIds(user?.id))

  // Strict country scope + soonest first (data layer already returns ISO strings).
  events = events
    .filter((e) => (e.country || 'HT') === userCountry)
    .sort(
      (a, b) =>
        new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
    )

  // Defensive serialization for any residual Firestore Timestamps.
  const serializeData = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj
    if (obj.toDate && typeof obj.toDate === 'function') return obj.toDate().toISOString()
    if (Array.isArray(obj)) return obj.map(serializeData)
    const out: any = {}
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) out[key] = serializeData(obj[key])
    }
    return out
  }

  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      <Navbar user={user} isAdmin={isAdmin(user?.email)} />
      <CategoryPageContent category={category} events={serializeData(events)} />
      <MobileNavWrapper user={user} isAdmin={isAdmin(user?.email)} />
    </div>
  )
}
