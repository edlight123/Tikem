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
import { teamRoleIn } from '@/lib/organizer/context'
import { resolveOrgCover } from '@/lib/organizer/cover'
import { orgPagePrefix, ownStorageUrl, readGallery, storageBucketName } from '@/lib/gallery'
import PreviewBanner from '@/components/organizer/page/PreviewBanner'
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

/** Hosts anything: the organizer role, or at least one event. Best-effort. */
async function isHostAccount(uid: string): Promise<boolean> {
  try {
    const [userDoc, events] = await Promise.all([
      adminDb.collection('users').doc(uid).get(),
      adminDb.collection('events').where('organizer_id', '==', uid).limit(1).get(),
    ])
    const u = userDoc.exists ? userDoc.data() : {}
    return u?.role === 'organizer' || u?.is_organizer === true || !events.empty
  } catch {
    return true
  }
}

/** The owner, or a team admin of this org (they edit its page). */
async function canEditOrgPage(viewerId: string | undefined, orgId: string): Promise<boolean> {
  if (!viewerId) return false
  if (viewerId === orgId) return true
  try {
    return (await teamRoleIn(orgId, viewerId)) === 'admin'
  } catch {
    return false
  }
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ organizerId: string }>
  searchParams?: Promise<{ view?: string }>
}): Promise<Metadata> {
  const { organizerId } = await params
  // The personal page is titled with the personal name, never the brand.
  if ((await searchParams)?.view === 'person') {
    const snap = await adminDb.collection('public_profiles').doc(organizerId).get().catch(() => null)
    const personal = String((snap?.exists && snap.data()?.full_name) || '').trim()
    const title = personal ? `${personal} | Tikèm` : 'Tikèm'
    return { title, openGraph: { title, type: 'profile' }, twitter: { card: 'summary', title } }
  }

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
  // A person who hosts nothing isn't an "Organizer" (owner, 2026-11-18): same
  // host test as the page body, cheap version (brand name or role).
  const host = !!String(brand.organization_name || organizer.organization_name || '').trim() || (await isHostAccount(organizerId))
  const title = host ? `${name} | Tikèm Organizer` : `${name} | Tikèm`
  const description = host ? `View all events organized by ${name} on Tikèm` : `${name} on Tikèm`
  return {
    title,
    description,
    // og:image comes from ./opengraph-image.tsx (the organizer card).
    openGraph: { title, description, type: 'profile' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function OrganizerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ organizerId: string }>
  searchParams?: Promise<{ preview?: string; view?: string }>
}) {
  const user = await getCurrentUser()
  const { organizerId } = await params
  const query = (await searchParams) || {}
  const isSelf = !!user && user.id === organizerId
  const editor = await canEditOrgPage(user?.id, organizerId)
  // ?preview=1 ("Preview my page"): exactly what a visitor sees, with no
  // owner tools and a bar saying so. Only for someone who can edit the page.
  const preview = query.preview === '1' && editor

  // ?view=person: the PERSONAL page, which every account has, also an
  // organization's owner (lib/profile/public-details.ts, PERSON VIEW). Opened
  // from attendee contexts: who's going, guest lists, an attendee's messages.
  if (query.view === 'person') {
    const loaded = await loadPublicProfileDetails(organizerId, user?.id ?? null, { view: 'person' }).catch((err) => {
      console.error('[person-profile] details failed', err?.message)
      return null
    })
    if (!loaded?.details.identity) notFound()
    const identity = loaded.details.identity
    const alsoRuns = loaded.details.also_runs
    return (
      <div className="min-h-screen bg-canvas pb-mobile-nav">
        <Navbar user={user} />
        <OrganizerProfileClient
          organizer={{
            id: organizerId,
            name: identity.full_name || 'Tikèm',
            logo: '',
            is_verified: identity.is_verified,
            created_at: identity.joined_at || '',
          }}
          upcomingEvents={[]}
          pastEvents={[]}
          followerCount={0}
          totalEvents={0}
          totalTicketsSold={0}
          isFollowing={false}
          userId={user?.id}
          details={loaded.details}
          friendshipState={loaded.friendship}
          isAuthenticated={!!user}
          isBlocked={user && !isSelf ? await isOrganizerBlocked(user.id, organizerId) : false}
          isHost={false}
          personPhoto={identity.photo_url}
          alsoRuns={
            alsoRuns ? { name: alsoRuns.name, logo: alsoRuns.logo, href: `/profile/organizer/${encodeURIComponent(organizerId)}` } : null
          }
        />
        <MobileNavWrapper user={user} />
      </div>
    )
  }
  
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

  // The banner and photos, from the page's public doc (lib/organizer/cover.ts,
  // lib/gallery.ts): only a known template or this org's own uploads show.
  const pageDoc = await adminDb
    .collection('public_profiles')
    .doc(organizerId)
    .get()
    .then((s: any) => (s.exists ? s.data() : null))
    .catch(() => null)
  const cover = resolveOrgCover(organizerId, pageDoc)
  const bucket = storageBucketName()
  const gallery = readGallery(pageDoc?.gallery, (u) => ownStorageUrl(u, bucket, orgPagePrefix(organizerId)))

  // Location only: the hero shows where they work. Nothing else from the
  // owner-only users doc reaches the page.
  const userDoc = await adminDb.collection('users').doc(organizerId).get()
  const userData = userDoc.exists ? userDoc.data() : {}

  // Not everyone is an organizer (owner, 2026-11-17, same rule as the app's
  // OrganizerProfileScreen). A host has an organization name, any event, or
  // the organizer role; anyone else gets a person's profile: "Joined Tikèm"
  // once, no "0 events", no Follow, no empty "upcoming events".
  const orgName = String(brand.organization_name || organizerRow.organization_name || '').trim()
  const isHost =
    !!orgName ||
    details.kind === 'org' ||
    organizerEvents.length > 0 ||
    userData?.role === 'organizer' ||
    userData?.is_organizer === true

  return (
    <div className="min-h-screen bg-canvas pb-mobile-nav">
      <Navbar user={user} />
      {preview && <PreviewBanner exitHref={`/profile/organizer/${encodeURIComponent(organizerId)}`} />}

      <OrganizerProfileClient
        organizer={organizer}
        upcomingEvents={upcomingEvents || []}
        pastEvents={pastEvents || []}
        followerCount={followerCount}
        totalEvents={totalEvents}
        totalTicketsSold={totalTicketsSold}
        isFollowing={isFollowing}
        userId={preview ? undefined : user?.id}
        details={details}
        friendshipState={preview ? 'none' : friendshipState}
        isAuthenticated={!!user && !preview}
        // Already in `userData` from the fetch above — the hero shows where an
        // organizer works when they have set it. Roughly half of production
        // organizer docs carry default_country, fewer default_city, so both
        // are optional and the row simply omits what is missing.
        city={typeof userData?.default_city === 'string' ? userData.default_city : undefined}
        country={typeof userData?.default_country === 'string' ? userData.default_country : undefined}
        isBlocked={user && !isSelf && !preview ? await isOrganizerBlocked(user.id, organizerId) : false}
        isHost={isHost}
        cover={cover}
        gallery={gallery}
        canEdit={editor && !preview}
        preview={preview}
      />

      <MobileNavWrapper user={user} />
    </div>
  )
}
