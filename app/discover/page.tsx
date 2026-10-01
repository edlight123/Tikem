// Event Discovery Page
// Optimized with data layer caching and efficient queries
export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { COUNTRY_COOKIE, normalizeCountry } from '@/lib/home/country'
import { getCurrentUser } from '@/lib/auth'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { isAdmin } from '@/lib/admin'
import { isDemoMode, DEMO_EVENTS } from '@/lib/demo'
import { parseFiltersFromURL } from '@/lib/filters/utils'
import { applyFiltersAndSort } from '@/lib/filters/apply'
import { DiscoverFilterManager } from '@/components/DiscoverFilterManager'
import { DiscoverPageContent } from '@/components/discover/DiscoverPageContent'
import { DiscoverFilterBarSkeleton, DiscoverContentSkeleton } from '@/components/discover/DiscoverSkeleton'
import { LocationBannerWrapper } from '@/components/LocationBannerWrapper'
import { 
  getFeaturedEvents, 
  getUpcomingEvents, 
  filterFreeEvents, 
  filterEventsByPrice, 
  filterOnlineEvents,
  filterEventsByLocation,
  filterEventsByCountry,
  sortEventsDefault,
  sortEventsByDate
} from '@/lib/discover/helpers'
import { getDiscoverEvents } from '@/lib/data/events'
import { filterBlockedEvents, getBlockedOrganizerIds } from '@/lib/moderation/blocks'
import { getUserProfileAdmin } from '@/lib/firestore/user-profile-admin'

// Revalidate every 30 seconds for discover page (frequently updated)
export const revalidate = 30

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const user = await getCurrentUser()
  const params = await searchParams
  
  // Get user's default country for prioritization
  let userCountry = 'HT' // Default to Haiti
  let userCity = ''
  if (user?.id) {
    try {
      const profile = await getUserProfileAdmin(user.id)
      userCountry = profile?.defaultCountry || 'HT'
      userCity = profile?.defaultCity || ''
    } catch (error) {
      console.error('Failed to fetch user profile:', error)
    }
  }

  // The homepage's country scope reaches here too: an explicit ?country=
  // (its links carry one), else the saved "Change country" choice, else the
  // profile's. `?country=abroad` is the homepage's "Haitian events abroad"
  // door: every country except Haiti.
  const countryParam = typeof params.country === 'string' ? params.country : ''
  const showAbroad = countryParam.toLowerCase() === 'abroad'
  const chosenCountry =
    normalizeCountry(countryParam) || normalizeCountry((await cookies()).get(COUNTRY_COOKIE)?.value)
  if (chosenCountry) userCountry = chosenCountry

  // Parse filters from URL
  const urlParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      if (Array.isArray(value)) {
        value.forEach(v => urlParams.append(key, v))
      } else {
        urlParams.set(key, String(value))
      }
    }
  })
  const filters = parseFiltersFromURL(urlParams)
  
  let allEvents: any[] = []
  
  if (isDemoMode()) {
    allEvents = DEMO_EVENTS
  } else {
    // Use optimized data layer with 30s caching
    allEvents = await getDiscoverEvents(filters, 200)
  }

  // Organizers this viewer blocked never reach their feed (App Store 1.2).
  allEvents = filterBlockedEvents(allEvents, await getBlockedOrganizerIds(user?.id))

  // Apply filters and sort
  let filteredEvents = applyFiltersAndSort(allEvents, filters)

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

  filteredEvents = filteredEvents.filter(notDefinitelyEnded)
  
  // Search, and the country rule it is allowed to break.
  //
  // Two defects lived here, both reproduced on production before this change:
  //
  // 1. The matcher only lowercased, so it never folded accents. `?search=foj`
  //    returned "No events found" while `?search=FÒJ` found FÒJ 2026, and
  //    `siwel` missed SIWÈL. On a phone nobody reaches for È or Ò, and this
  //    catalogue is named in Kreyòl and French — so folding is not a nicety.
  //
  // 2. The STRICT country filter ran BEFORE the search, so a typed query could
  //    never leave the visitor's default country (HT for anyone signed out).
  //    The autosuggest, which does not country-filter, offered "MTL KOMPA" for
  //    the query `mtl`; pressing the keyboard's search key then said "No events
  //    found". A typed query is an explicit intent, so it now searches every
  //    country and the country restriction applies only to the unfiltered feed.
  //    That alone makes the owner's `mtl` land on MTL KOMPA — no alias table.
  const searchQuery = typeof params.search === 'string' ? params.search.trim() : ''

  /** Lowercase and strip diacritics, so "siwel" reaches "SIWÈL". */
  const fold = (value: unknown) =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()

  if (searchQuery) {
    const query = fold(searchQuery)
    filteredEvents = filteredEvents.filter(event =>
      fold(event.title).includes(query) ||
      fold(event.description).includes(query) ||
      fold(event.venue_name).includes(query) ||
      fold(event.city).includes(query) ||
      fold(event.commune).includes(query) ||
      fold(event.category).includes(query) ||
      fold(Array.isArray(event.tags) ? event.tags.join(' ') : '').includes(query)
    )
  } else {
    // No query: the feed stays local. Events with no country are Haitian, as before.
    filteredEvents = filteredEvents.filter(e =>
      showAbroad ? (e.country || 'HT') !== 'HT' : (e.country || 'HT') === userCountry
    )
  }

  // Apply sorting rules
  if (filters.sortBy === 'date') {
    filteredEvents = sortEventsByDate(filteredEvents)
  } else {
    filteredEvents = sortEventsDefault(filteredEvents)
  }
  
  // Organize into sections
  const featuredEvents = getFeaturedEvents(filteredEvents, 6)
  const upcomingEvents = getUpcomingEvents(filteredEvents, 8)
  const freeEvents = filterFreeEvents(filteredEvents)
  const budgetEvents = filterEventsByPrice(filteredEvents, 500)
  const onlineEvents = filterOnlineEvents(filteredEvents)
  
  // Events from user's country (prioritized)
  const countryEvents = filterEventsByCountry(filteredEvents, userCountry)
  
  // Near you events (specific city + commune)
  const nearYouEvents = filters.city 
    ? filterEventsByLocation(allEvents, filters.city, filters.commune).filter(notDefinitelyEnded)
    : []

  const hasActiveFilters: boolean = filters.date !== 'any' || 
                          filters.city !== '' || 
                          filters.categories.length > 0 || 
                          filters.price !== 'any' || 
                          filters.eventType !== 'all' ||
                          (!!searchQuery && searchQuery.trim() !== '')

  // Serialize all event data before passing to client component
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

  const serializedFeaturedEvents = serializeData(featuredEvents)
  const serializedUpcomingEvents = serializeData(upcomingEvents)
  const serializedCountryEvents = serializeData(countryEvents)
  const serializedNearYouEvents = serializeData(nearYouEvents)
  const serializedBudgetEvents = serializeData(budgetEvents)
  const serializedOnlineEvents = serializeData(onlineEvents)
  const serializedFilteredEvents = serializeData(filteredEvents)

  return (
    <div className="surface-dark min-h-screen pb-mobile-nav">
      {/* flush: the sticky filter header below supplies the header band's one
          bottom rule, so the navbar doesn't draw its own. */}
      <Navbar user={user} isAdmin={isAdmin(user?.email)} flush />
      
      {/* Location Detection Banner */}
      <LocationBannerWrapper 
        userId={user?.id}
        currentCountry={userCountry}
        currentCity={userCity}
      />

      {/* Top Bar with Filter Manager (includes ActiveFiltersRow) */}
      <Suspense fallback={<DiscoverFilterBarSkeleton />}>
        <DiscoverFilterManager userCountry={userCountry} />
      </Suspense>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Suspense fallback={<DiscoverContentSkeleton />}>
          <DiscoverPageContent
            hasActiveFilters={hasActiveFilters}
            featuredEvents={serializedFeaturedEvents}
            upcomingEvents={serializedUpcomingEvents}
            countryEvents={serializedCountryEvents}
            nearYouEvents={serializedNearYouEvents}
            budgetEvents={serializedBudgetEvents}
            onlineEvents={serializedOnlineEvents}
            filteredEvents={serializedFilteredEvents}
            city={filters.city}
            commune={filters.commune}
            userCountry={userCountry}
            userId={user?.id}
          />
        </Suspense>
      </div>

      <MobileNavWrapper user={user} isAdmin={isAdmin(user?.email)} />
    </div>
  )
}
