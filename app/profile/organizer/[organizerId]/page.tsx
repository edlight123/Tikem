import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { getFriendshipState } from '@/lib/firestore/connections'
import { DEFAULT_PRIVACY } from '@/types/social'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { notFound } from 'next/navigation'
import OrganizerProfileClient from './OrganizerProfileClient'
import { isOrganizerBlocked } from '@/lib/moderation/blocks'
import type { Metadata } from 'next'

export const runtime = 'nodejs'
export const revalidate = 0

export async function generateMetadata({ params }: { params: Promise<{ organizerId: string }> }): Promise<Metadata> {
  const { organizerId } = await params
  
  const supabase = await createClient()
  const { data: organizer } = await supabase
    .from('users')
    .select('full_name, is_verified')
    .eq('id', organizerId)
    .single()

  if (!organizer) {
    return {
      title: 'Organizer Not Found',
    }
  }

  return {
    title: `${organizer.full_name} | Tikèm Organizer`,
    description: `View all events organized by ${organizer.full_name} on Tikèm`,
  }
}

export default async function OrganizerProfilePage({ params }: { params: Promise<{ organizerId: string }> }) {
  const user = await getCurrentUser()
  const { organizerId } = await params
  
  const supabase = await createClient()
  
  // Fetch organizer info
  const { data: organizer } = await supabase
    .from('users')
    .select('id, full_name, email, is_verified, created_at')
    .eq('id', organizerId)
    .single()

  if (!organizer) {
    notFound()
  }

  // Fetch organizer's events
  const now = new Date().toISOString()

  /**
   * ONE read of the organizer's events, then everything derived in memory.
   *
   * This page used to query the `events` collection FOUR times for the same
   * organizer: the full list, then an identical full list whose only consumer
   * was a `console.log`, then a published-only list to count events, then a
   * fourth to sum `tickets_sold`. Every one of them was a fan-out over the
   * same documents, on a public page. The first query selects `*`, so the
   * other three were already answerable from it.
   *
   * The debug logging went with them. It printed the organizer id, the
   * current time, event counts and a sample of event titles and dates on
   * every production request — noise in the logs, and user data in them.
   */
  const { data: allOrganizerEvents, error: allEventsError } = await supabase
    .from('events')
    .select('*')
    .eq('organizer_id', organizerId)

  if (allEventsError) {
    console.error('[organizer-profile] events query failed', allEventsError)
  }

  const organizerEvents = allOrganizerEvents || []
  const publishedEvents = organizerEvents.filter((e: any) => e.is_published)

  const withOrganizer = (event: any) => ({
    ...event,
    users: {
      full_name: organizer.full_name,
      is_verified: organizer.is_verified,
    },
  })

  const upcomingEvents = publishedEvents
    .filter((e: any) => e.start_datetime >= now)
    .sort((a: any, b: any) => a.start_datetime.localeCompare(b.start_datetime))
    .map(withOrganizer)

  const pastEvents = publishedEvents
    .filter((e: any) => e.start_datetime < now)
    .sort((a: any, b: any) => b.start_datetime.localeCompare(a.start_datetime))
    .slice(0, 6)
    .map(withOrganizer)

  const totalEvents = publishedEvents.length
  const totalTicketsSold = publishedEvents.reduce(
    (sum: number, e: any) => sum + (e.tickets_sold || 0),
    0
  )

  // Followers is a different collection, so it stays its own read.
  const { data: followersData } = await supabase
    .from('organizer_follows')
    .select('id')
    .eq('organizer_id', organizerId)

  const followerCount = followersData?.length || 0

  // Check if current user is following this organizer
  let isFollowing = false
  if (user) {
    const { data: followData } = await supabase
      .from('organizer_follows')
      .select('id')
      .eq('organizer_id', organizerId)
      .eq('follower_id', user.id)
      .single()
    
    isFollowing = !!followData
  }

  // Social profile + friendship state (privacy-gated).
  const userDoc = await adminDb.collection('users').doc(organizerId).get()
  const userData = userDoc.exists ? userDoc.data() : {}
  const privacy = { ...DEFAULT_PRIVACY, ...(userData?.privacy || {}) }
  const isSelf = !!user && user.id === organizerId

  let friendshipState: string = 'none'
  if (user && !isSelf) {
    try {
      friendshipState = await getFriendshipState(user.id, organizerId)
    } catch {
      friendshipState = 'none'
    }
  } else if (isSelf) {
    friendshipState = 'self'
  }

  const canViewSocial =
    privacy.profile_visibility === 'public' || friendshipState === 'friends' || isSelf
  const socialLinks = canViewSocial ? userData?.social_links || {} : {}
  const bio = canViewSocial ? userData?.bio || '' : ''

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-mobile-nav">
      <Navbar user={user} />

      <OrganizerProfileClient
        organizer={organizer}
        upcomingEvents={upcomingEvents || []}
        pastEvents={pastEvents || []}
        followerCount={followerCount}
        totalEvents={totalEvents}
        totalTicketsSold={totalTicketsSold}
        isFollowing={isFollowing}
        userId={user?.id}
        socialLinks={socialLinks}
        bio={bio}
        friendshipState={friendshipState as any}
        isAuthenticated={!!user}
        // Already in `userData` from the fetch above — the hero shows where an
        // organizer works when they have set it. Roughly half of production
        // organizer docs carry default_country, fewer default_city, so both
        // are optional and the row simply omits what is missing.
        city={typeof userData?.default_city === 'string' ? userData.default_city : undefined}
        country={typeof userData?.default_country === 'string' ? userData.default_country : undefined}
        isBlocked={user && !isSelf ? await isOrganizerBlocked(user.id, organizerId) : false}
      />

      <MobileNavWrapper user={user} />
    </div>
  )
}
