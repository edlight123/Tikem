import { getCurrentUser } from '@/lib/auth'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import HeroSection from '@/components/HeroSection'
import HeroPase from '@/components/home/HeroPase'
import AppScrub from '@/components/home/AppScrub'
import WorldsChapters from '@/components/home/WorldsChapters'
import HomePageContent from '@/components/HomePageContent'
import PosterFilmStrip from '@/components/home/PosterFilmStrip'
import { CULTURAL_CATEGORIES, culturalCategoryHref } from '@/lib/categories'
import { normalizeEventCategory } from '@/lib/filters/config'
import CitiesShowcase from '@/components/home/CitiesShowcase'
import PosterChapter from '@/components/home/PosterChapter'
import HomeOutro from '@/components/home/HomeOutro'
import { BRAND } from '@/config/brand'
import { isDemoMode, DEMO_EVENTS } from '@/lib/demo'
import { isAdmin } from '@/lib/admin'
import type { Database } from '@/types/database'
import { parseFiltersFromURL } from '@/lib/filters/utils'
import { applyFiltersAndSort } from '@/lib/filters/apply'
import { getDiscoverEvents, getCinemaArtworkEvents } from '@/lib/data/events'
import { filterBlockedEvents, getBlockedOrganizerIds } from '@/lib/moderation/blocks'
import { getUserProfileAdmin } from '@/lib/firestore/user-profile-admin'
import { LocationBannerWrapper } from '@/components/LocationBannerWrapper'
import { adminDb } from '@/lib/firebase/admin'

type Event = Database['public']['Tables']['events']['Row']

// Revalidate every 2 minutes for public home page
export const revalidate = 120

// This page reads auth cookies for personalization.
export const dynamic = 'force-dynamic'

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const user = await getCurrentUser()
  const params = await searchParams
  
  // Get user's default country for filtering
  let userCountry = 'HT' // Default to Haiti
  let userCity = ''
  let userSubarea = ''
  if (user?.id) {
    try {
      const profile = await getUserProfileAdmin(user.id)
      userCountry = profile?.defaultCountry || 'HT'
      userCity = profile?.defaultCity || ''
      userSubarea = profile?.defaultSubarea || ''
    } catch (error) {
      console.error('Failed to fetch user profile:', error)
    }
  }
  
  // Parse filters from URL. Repeated keys (?category=A&category=B — the
  // cultural-world tiles link this way) arrive as arrays and must be appended
  // one by one; String() would collapse them into "A,B", which normalizes to
  // 'Other' and matches nothing.
  const urlParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (!value) return
    if (Array.isArray(value)) {
      value.forEach((v) => urlParams.append(key, v))
    } else {
      urlParams.set(key, String(value))
    }
  })
  const filters = parseFiltersFromURL(urlParams)

  // The hero's diaspora city chips switch the page's country scope: a visitor
  // whose default scope is Haiti who taps "Miami" must actually see Miami —
  // the strict country filter below would otherwise erase the selection.
  const DIASPORA_CITY_COUNTRY: Record<string, string> = {
    Miami: 'US',
    'New York': 'US',
    Montréal: 'CA',
    Montreal: 'CA',
    Paris: 'FR',
  }
  const effectiveCountry = DIASPORA_CITY_COUNTRY[filters.city] || userCountry

  let events: any[] = []
  
  if (isDemoMode()) {
    // Use demo events in demo mode
    events = DEMO_EVENTS as any[]
  } else {
    // Fetch events using optimized data layer with caching (30s revalidation)
    // Reduced from 100 to 50 - homepage only displays ~30 events max
    events = await getDiscoverEvents(filters, 50)
  }

  // Organizers this viewer blocked never reach their feed (App Store 1.2).
  // Per-user, so it runs here, outside the shared discover cache.
  const blockedOrganizers = await getBlockedOrganizerIds(user?.id)
  events = filterBlockedEvents(events, blockedOrganizers)

  // Apply filters and sorting using new filter system
  events = applyFiltersAndSort(events, filters)

  // Filter out events that have definitively ended
  // Be lenient: show events that are ongoing or haven't started yet
  const now = new Date()
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  
  const notDefinitelyEnded = (event: any) => {
    const start = event?.start_datetime ? new Date(event.start_datetime) : null
    const end = event?.end_datetime ? new Date(event.end_datetime) : null

    // If event has an end time, check if it's passed
    if (end && !Number.isNaN(end.getTime())) {
      return end.getTime() >= now.getTime()
    }
    
    // If no end time but has start, show if started within last week (could be ongoing)
    // or hasn't started yet
    if (start && !Number.isNaN(start.getTime())) {
      return start.getTime() >= oneWeekAgo.getTime()
    }
    
    // If no valid dates, show it anyway
    return true
  }

  events = events.filter(notDefinitelyEnded)

  // The cinema acts run on artwork, and artwork doesn't expire the night the
  // event ends — getDiscoverEvents cuts past events, so the archive comes from
  // its own (same-cache) read. Tops up the film strip, poster chapter and city
  // collages when few events are upcoming.
  const artworkArchive = isDemoMode() ? [] : filterBlockedEvents(await getCinemaArtworkEvents(20), blockedOrganizers)

  // Everything still upcoming, ALL countries — the diaspora rail reads from
  // here, since the strict scope filter below would erase it.
  const allCountriesEvents = events

  // STRICT country filtering - ONLY show events from user's country
  // Events without a country field are assumed to be in Haiti (HT)
  events = events.filter(e => {
    const eventCountry = e.country || 'HT' // Default to Haiti if no country set
    return eventCountry === effectiveCountry
  })

  // Attach organizer display names so the hero search autocomplete can match by
  // organizer. The events carry organizer_id but not a name; resolve in one
  // batched read (getAll — robust vs the fragile `__name__ in` pattern). Never
  // let this break the home page.
  if (!isDemoMode()) {
    try {
      const organizerIds = Array.from(
        new Set(events.map((e: any) => e.organizer_id).filter(Boolean)),
      ) as string[]
      if (organizerIds.length > 0) {
        const refs = organizerIds.map((id) => adminDb.collection('users').doc(id))
        const docs = await adminDb.getAll(...refs)
        const nameById = new Map<string, string>()
        docs.forEach((d: any) => {
          if (!d.exists) return
          const u = d.data() || {}
          // NEVER fall back to email here — this name is serialized into the
          // PUBLIC homepage payload. Only the organizer's public display name.
          nameById.set(d.id, u.full_name || u.name || '')
        })
        events = events.map((e: any) => ({
          ...e,
          organizer_name: e.organizer_name || nameById.get(e.organizer_id) || '',
        }))
      }
    } catch (error) {
      console.error('Failed to resolve organizer names for home events:', error)
    }
  }

  // Prioritize events by user's city first, then rest of country
  const eventsInUserCity = userCity ? events.filter(e => e.city === userCity) : []
  const eventsInOtherCities = userCity ? events.filter(e => e.city !== userCity) : events
  const prioritizedEvents = [...eventsInUserCity, ...eventsInOtherCities]
  
  // Organize events into sections
  
  const trendingEvents = prioritizedEvents
    .filter(notDefinitelyEnded)
    .filter(e => (e.tickets_sold || 0) > 10)
    .slice(0, 6)
  const thisWeekEnd = new Date(now)
  thisWeekEnd.setDate(now.getDate() + 7)
  const upcomingThisWeek = prioritizedEvents
    .filter(notDefinitelyEnded)
    .filter(e => {
      const start = new Date(e.start_datetime)
      if (Number.isNaN(start.getTime())) return false
      return start.getTime() <= thisWeekEnd.getTime()
    })
    .slice(0, 6)
  const countryEvents = prioritizedEvents.slice(0, 6)

  // Tonight — starts today (through late night), the most urgent rail.
  const endOfTonight = new Date(now)
  endOfTonight.setHours(29, 59, 59, 999) // rolls into tomorrow 5:59 AM, night events count
  const tonightEvents = prioritizedEvents
    .filter(e => {
      const start = new Date(e.start_datetime)
      if (Number.isNaN(start.getTime())) return false
      return (
        start.getTime() >= now.getTime() - 6 * 3_600_000 &&
        start.getTime() <= endOfTonight.getTime()
      )
    })
    .slice(0, 12)

  // In the diaspora (or, for a diaspora visitor, back home): events OUTSIDE the
  // visitor's current scope. This is the identity rail — Tikèm is the Haitian
  // event ecosystem, not just Haiti's ticket counter.
  const diasporaIsHome = effectiveCountry !== 'HT'
  const diasporaEvents = allCountriesEvents
    .filter(e => {
      const eventCountry = e.country || 'HT'
      return diasporaIsHome ? eventCountry === 'HT' : eventCountry !== 'HT'
    })
    .slice(0, 12)

  // Tikèm Picks — the human-curated rail. Admin's Feature star writes
  // `featured` (legacy test data wrote `is_featured`); curation is scarce, so
  // picks draw from ALL countries rather than being country-erased.
  const picksEvents = allCountriesEvents
    .filter((e: any) => e.featured === true || e.is_featured === true)
    .slice(0, 8)

  // Recently added — newest events on the platform first (by created_at).
  const recentlyAddedEvents = [...prioritizedEvents]
    .filter(notDefinitelyEnded)
    .sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0
      return bTime - aTime
    })
    .slice(0, 6)
  
  // Check if we have any active filters
  const hasActiveFilters = filters.date !== 'any' || 
                          filters.city !== '' || 
                          filters.categories.length > 0 || 
                          filters.price !== 'any' || 
                          filters.eventType !== 'all'

  // Serialize all data before passing to client components
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

  /**
   * The hero search's pool — ALL countries, unlike every rail on this page.
   *
   * `events` is the strictly country-scoped list, and handing that to the
   * autocomplete meant a Haiti-scoped visitor's search could not see MTL
   * KOMPA, BK KONPA, KONPA CRUISE or LA NUIT CRÉOLE at all: they are in the
   * payload, just not in the pool. Typing "mtl" returned nothing, which is
   * what the owner reported. The rails stay scoped — a reader in
   * Port-au-Prince should not have Miami events in their listings — but SEARCH
   * is the one place where asking for something out of scope is the point.
   *
   * Organizer names are overlaid from the enriched in-country list by id:
   * `allCountriesEvents` was captured before that enrichment ran, so without
   * this the pool would silently lose organizer-name matching. Out-of-country
   * events keep whatever name is on their own doc, which is still strictly
   * more than the nothing they had before.
   */
  const enrichedNameById = new Map<string, string>(
    (events as any[])
      .filter((e) => e?.id && e?.organizer_name)
      .map((e) => [String(e.id), String(e.organizer_name)])
  )
  const searchPool = serializeData(
    (allCountriesEvents as any[]).map((e) => ({
      ...e,
      organizer_name: e.organizer_name || enrichedNameById.get(String(e.id)) || '',
    }))
  )

  const serializedEvents = serializeData(events)
  const serializedTrendingEvents = serializeData(trendingEvents)
  const serializedUpcomingThisWeek = serializeData(upcomingThisWeek)
  const serializedCountryEvents = serializeData(countryEvents)
  const serializedRecentlyAdded = serializeData(recentlyAddedEvents)
  const serializedTonight = serializeData(tonightEvents)
  const serializedDiaspora = serializeData(diasporaEvents)
  const serializedPicks = serializeData(picksEvents)

  // Homepage cinema pools: upcoming artwork first, then the archive of recent
  // past posters — the theatre stays open even when tonight's inventory is
  // thin. Every poster still links to a real (renderable) event page. Diaspora
  // cities read from the ALL-countries lists, since the scope filter above
  // would erase them.
  const upcomingArt = allCountriesEvents.filter((e: any) => e.banner_image_url)
  const upcomingArtIds = new Set(upcomingArt.map((e: any) => e.id))
  const cinemaPool = [
    ...upcomingArt,
    ...artworkArchive.filter((e: any) => !upcomingArtIds.has(e.id)),
  ]
  const filmStripEvents = serializeData(cinemaPool.slice(0, 14))
  const SHOWCASE_CITIES = ['Port-au-Prince', 'Cap-Haïtien', 'Miami', 'New York', 'Montréal', 'Paris']
  const showcaseCities = SHOWCASE_CITIES.map(city => ({
    city,
    posters: cinemaPool
      .filter((e: any) => String(e.city || '').toLowerCase() === city.toLowerCase())
      .slice(0, 4)
      .map((e: any) => String(e.banner_image_url)),
  }))
  // Act 2 (the pinned chapter) leads with the biggest rooms: same pool, sorted
  // by tickets sold.
  const chapterEvents = serializeData(
    [...cinemaPool]
      .sort((a: any, b: any) => (b.tickets_sold || 0) - (a.tickets_sold || 0))
      .slice(0, 5)
  )

  // The statement hero's floating room: curated picks lead, the cinema pool
  // fills — minimal shape only, it crosses to a client component.
  const posterShape = (e: any) => ({
    id: String(e.id),
    title: String(e.title || ''),
    banner_image_url: String(e.banner_image_url),
  })
  const heroPosterPool = [
    ...cinemaPool.filter((e: any) => e.featured === true || e.is_featured === true),
    ...cinemaPool.filter((e: any) => e.featured !== true && e.is_featured !== true),
  ].filter((e: any) => e.banner_image_url)
  // Seven, matching HeroPase's slot count — the scatter grew and a short pool
  // silently leaves its later slots empty.
  const heroPosters = heroPosterPool.slice(0, 7).map(posterShape)

  // "Inside the app" (AppScrub): the pinned phone whose screen is driven by
  // page scroll. Feed = the artwork pool with city captions; the story opens
  // and tickets the top pick (falls back to the pool's first poster).
  const appScrubEvents = cinemaPool
    .filter((e: any) => e.banner_image_url)
    .slice(0, 10)
    .map((e: any) => ({
      ...posterShape(e),
      city: e.city ? String(e.city) : undefined,
      venue_name: e.venue_name ? String(e.venue_name) : undefined,
      // Pricing signals so the in-phone cards show the real price label.
      ticket_price: e.ticket_price ?? null,
      currency: e.currency ?? null,
      is_rsvp: e.is_rsvp ?? undefined,
      has_paid_tiers: e.has_paid_tiers ?? undefined,
    }))
  const appScrubHero = serializeData(
    heroPosterPool.find((e: any) => e.featured === true || e.is_featured === true) ||
      heroPosterPool[0] ||
      null
  )

  // The worlds journey: four immersive chapters, each carrying its own real
  // posters from the pool (a chapter with none still renders — the word and
  // the wash carry it).
  const CHAPTER_KEYS = ['mizik', 'lavi-lannwit', 'kilti', 'espo']
  const worldsData = CHAPTER_KEYS.flatMap((key) => {
    const world = CULTURAL_CATEGORIES.find((c) => c.key === key)
    if (!world) return []
    return [
      {
        key: world.key,
        label: world.label,
        sublabel: world.sublabel,
        from: world.from,
        to: world.to,
        href: culturalCategoryHref(world),
        posters: cinemaPool
          .filter((e: any) => world.categories.includes(normalizeEventCategory(e.category)))
          .slice(0, 3)
          .map(posterShape),
      },
    ]
  })

  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      {/* flush: the homepage is one dark canvas — no hairline under the nav.
          (The filtered band draws its own working-state rule.) */}
      <Navbar user={user} isAdmin={isAdmin(user?.email)} flush />
      
      {/* Location Detection Banner */}
      <LocationBannerWrapper 
        userId={user?.id}
        currentCountry={userCountry}
        currentCity={userCity}
      />

      {/* Demo Mode Banner */}
      {isDemoMode() && (
        <div className="bg-gradient-to-r from-warning-50 to-warning-100 border-b border-warning-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-center gap-2 text-warning-800">
              <span className="text-lg">🎭</span>
              <p className="text-sm font-medium">
                <strong>Demo Mode:</strong> You&apos;re viewing sample events. Login with <code className="bg-warning-100 px-1.5 py-0.5 rounded">demo-organizer@tikem.co</code> or <code className="bg-warning-100 px-1.5 py-0.5 rounded">demo-attendee@tikem.co</code> (password: <code className="bg-warning-100 px-1.5 py-0.5 rounded">demo123</code>)
              </p>
            </div>
          </div>
        </div>
      )}

      {/* HERO: the statement (SA K AP PASE? + floating posters), or the
          compact working band when filters are active. */}
      {hasActiveFilters ? (
        <HeroSection events={searchPool} />
      ) : (
        <HeroPase posters={heroPosters} events={searchPool} />
      )}

      {/* Act 1: the poster film strip — the platform, alive, in one glance. */}
      {!hasActiveFilters && <PosterFilmStrip events={filmStripEvents} />}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 md:py-12">
        <HomePageContent
            hasActiveFilters={hasActiveFilters}
            events={serializedEvents}
            trendingEvents={serializedTrendingEvents}
            upcomingThisWeek={serializedUpcomingThisWeek}
            countryEvents={serializedCountryEvents}
            recentlyAddedEvents={serializedRecentlyAdded}
            tonightEvents={serializedTonight}
            diasporaEvents={serializedDiaspora}
            picksEvents={serializedPicks}
            diasporaIsHome={diasporaIsHome}
            userCountry={userCountry}
            userCity={userCity}
            userSubarea={userSubarea}
          />
        </div>

      {/* Acts 2 & 3 + sign-off: the pinned poster chapter (scroll-scrubbed,
          after the store so theatre never delays a ticket), the diaspora as
          theatre (each city a real filter), then the Kreyòl goodbye with the
          app and organizer doors. */}
      {!hasActiveFilters && (
        <>
          {/* Inside the app: the pinned phone scrubbed by page scroll. */}
          <AppScrub events={appScrubEvents} hero={appScrubHero} />
          {/* The worlds journey — scrolling through Haitian life. */}
          <WorldsChapters worlds={worldsData} />
          <PosterChapter events={chapterEvents} />
          <CitiesShowcase cities={showcaseCities} />
          <HomeOutro />
        </>
      )}

      {/* Mobile Bottom Navigation */}
      <MobileNavWrapper user={user} isAdmin={isAdmin(user?.email)} />
    </div>
  )
}
