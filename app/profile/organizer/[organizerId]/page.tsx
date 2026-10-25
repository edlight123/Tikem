import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { readOrgBrandAdmin } from '@/lib/firestore/org-brand-server'
import { loadPublicProfileDetails } from '@/lib/profile/public-details'
import type { FriendshipState } from '@/types/social'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { notFound } from 'next/navigation'
import OrganizerProfileClient from './OrganizerProfileClient'
import { isOrganizerBlocked } from '@/lib/moderation/blocks'
import type { Metadata } from 'next'

export const runtime = 'nodejs'
export const revalidate = 0

/**
 * The organizer's public display name: the organization/brand name when set,
 * else the personal full name (as app/events/[id]/page.tsx and the publish
 * route's organizer_name stamp resolve it).
 */
function organizerDisplayName(organizer: { organization_name?: unknown; full_name?: unknown } | null | undefined): string {
  const org = typeof organizer?.organization_name === 'string' ? organizer.organization_name.trim() : ''
  const full = typeof organizer?.full_name === 'string' ? organizer.full_name.trim() : ''
  return org || full || 'Organizer'
}

export async function generateMetadata({ params }: { params: Promise<{ organizerId: string }> }): Promise<Metadata> {
  const { organizerId } = await params
  
  const supabase = await createClient()
  const { data: organizer } = await supabase
    .from('users')
    .select('full_name, organization_name, is_verified')
    .eq('id', organizerId)
    .single()

  if (!organizer) {
    return {
      title: 'Organizer Not Found',
    }
  }

  // The brand name's canonical home is public_profiles (lib/profile/org-brand.ts).
  const brand = await readOrgBrandAdmin(organizerId)
  const name = organizerDisplayName({ ...organizer, organization_name: brand.organization_name })
  const title = `${name} | Tikèm Organizer`
  const description = `View all events organized by ${name} on Tikèm`
  return {
    title,
    description,
    openGraph: { title, description, type: 'profile' },
    twitter: { card: 'summary', title, description },
  }
}

export default async function OrganizerProfilePage({ params }: { params: Promise<{ organizerId: string }> }) {
  const user = await getCurrentUser()
  const { organizerId } = await params
  
  const supabase = await createClient()
  
  // Fetch organizer info. Public fields only: everything here reaches the
  // client component and is serialized into the page, so no email/phone.
  const { data: organizerRow } = await supabase
    .from('users')
    .select('id, full_name, organization_name, is_verified, created_at')
    .eq('id', organizerId)
    .single()

  if (!organizerRow) {
    notFound()
  }

  // Name + logo from their canonical home, public_profiles, so a brand set in
  // either app shows here (lib/profile/org-brand.ts).
  const brand = await readOrgBrandAdmin(organizerId)
  const organizer = {
    id: String(organizerRow.id || organizerId),
    name: organizerDisplayName({ ...organizerRow, organization_name: brand.organization_name }),
    logo: brand.organization_logo,
    is_verified: !!organizerRow.is_verified,
    created_at: organizerRow.created_at,
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
      full_name: organizer.name,
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

  // What shows under the name (org details for an organization; a person's
  // bio + socials only when their privacy allows), one rule shared with the
  // app's GET /api/profiles/{uid}/public-details: lib/profile/public-details.ts.
  const loaded = await loadPublicProfileDetails(organizerId, user?.id ?? null, {
    hasPublishedEvents: publishedEvents.length > 0,
  }).catch((err) => {
    console.error('[organizer-profile] public details failed', err?.message)
    return null
  })
  const details = loaded?.details ?? { kind: 'person' as const, person: null }
  const friendshipState: FriendshipState = loaded?.friendship ?? (user?.id === organizerId ? 'self' : 'none')
  const isSelf = !!user && user.id === organizerId

  // Location only: the hero shows where they work. Nothing else from the
  // owner-only users doc reaches the page.
  const userDoc = await adminDb.collection('users').doc(organizerId).get()
  const userData = userDoc.exists ? userDoc.data() : {}

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
        details={details}
        friendshipState={friendshipState}
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
