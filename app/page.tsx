import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import HomePageContent from '@/components/HomePageContent'
import LiveTicker from '@/components/home/LiveTicker'
import CityRow from '@/components/home/CityRow'
import { isDemoMode, DEMO_EVENTS } from '@/lib/demo'
import { isAdmin } from '@/lib/admin'
import { parseFiltersFromURL } from '@/lib/filters/utils'
import { getDiscoverEvents, getCinemaArtworkEvents } from '@/lib/data/events'
import { filterBlockedEvents, getBlockedOrganizerIds } from '@/lib/moderation/blocks'
import { getUserProfileAdmin } from '@/lib/firestore/user-profile-admin'
import { getLocationFromVercelHeaders, mapToSupportedLocation } from '@/lib/geolocation'
import { LocationBannerWrapper } from '@/components/LocationBannerWrapper'
import { COUNTRY_COOKIE, resolveCountry } from '@/lib/home/country'
import {
  type HomeEvent,
  DEFAULT_ZONE,
  validZone,
  buildCityIndex,
  buildTickerSignals,
  buildWeek,
  buildWorlds,
  hasEnded,
  inCity,
  pickHeroEvents,
  resolveActiveCity,
  startingSoon,
  toHomeEvent,
  zoneFor,
} from '@/lib/home/feed'

// This page reads auth cookies for personalization.
export const dynamic = 'force-dynamic'

/** Events in the "back home" / abroad rail. */
const ELSEWHERE_MAX = 12

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams

  // Repeated keys (?category=A&category=B) arrive as arrays and must be
  // appended one by one; String() would collapse them into "A,B".
  const urlParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (!value) return
    if (Array.isArray(value)) value.forEach((v) => urlParams.append(key, v))
    else urlParams.set(key, String(value))
  })

  // The homepage is no longer a filtered listing; /discover is. Old links
  // (shared world tiles, bookmarked /?category=…) still land somewhere real:
  // the same query on discover. Only ?country= and ?city= stay here; they
  // scope this page.
  const filters = parseFiltersFromURL(urlParams)
  const isListingQuery =
    filters.date !== 'any' ||
    filters.categories.length > 0 ||
    filters.price !== 'any' ||
    filters.eventType !== 'all' ||
    urlParams.has('search') ||
    urlParams.has('sort')
  if (isListingQuery) redirect(`/discover?${urlParams.toString()}`)

  const [user, headerList, cookieStore] = await Promise.all([getCurrentUser(), headers(), cookies()])

  let profileCountry: string | undefined
  let profileCity = ''
  if (user?.id) {
    try {
      const profile = await getUserProfileAdmin(user.id)
      profileCountry = profile?.defaultCountry || undefined
      profileCity = profile?.defaultCity || ''
    } catch (error) {
      console.error('Failed to fetch user profile:', error)
    }
  }

  // Detection without a round trip: Vercel stamps the visitor's country, city
  // and zone on the request (the same source /api/geolocation reads first).
  // Locally there are no headers and the page opens on Haiti, all cities.
  const geo = getLocationFromVercelHeaders(headerList)
  const detected = geo ? mapToSupportedLocation(geo) : null
  const detectedCity = detected?.isSupported ? detected.city || geo?.city || '' : ''

  // One country at a time: ?country=, then the saved choice (the country
  // menu and the "Events near…" prompt both write the cookie), then the
  // profile, then where the request comes from, then Haiti.
  const country = resolveCountry(
    typeof params.country === 'string' ? params.country : null,
    cookieStore.get(COUNTRY_COOKIE)?.value,
    profileCountry,
    detected?.isSupported ? detected.countryCode : null
  )

  // One read for every section: all upcoming events, every country; country
  // and city are applied in memory below.
  const rawEvents: any[] = isDemoMode() ? (DEMO_EVENTS as any[]) : await getDiscoverEvents({}, 50)
  const blockedOrganizers = await getBlockedOrganizerIds(user?.id)

  const now = Date.now()
  const upcoming: HomeEvent[] = filterBlockedEvents(rawEvents, blockedOrganizers)
    .map(toHomeEvent)
    .filter((e): e is HomeEvent => !!e && !hasEnded(e, now))
    .sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime())

  const inCountry = upcoming.filter((e) => e.country === country)
  const cities = buildCityIndex(inCountry)
  const cityParam = typeof params.city === 'string' ? params.city : undefined
  const active = resolveActiveCity(
    cities,
    cityParam,
    profileCountry === country ? profileCity : null,
    detected?.countryCode === country ? detectedCity : null
  )
  const scoped = inCountry.filter((e) => inCity(e, active?.key ?? null))

  // The one step outside the country, asymmetric on purpose (ElsewhereRail):
  // a diaspora visitor gets "back home", Haiti's upcoming events; a visitor in
  // Haiti gets a quiet link to the events abroad, or the events themselves
  // when Haiti has nothing listed.
  const elsewhereMode = country === 'HT' ? 'abroad' : 'home'
  const elsewhere = upcoming
    .filter((e) => (elsewhereMode === 'home' ? e.country === 'HT' : e.country !== 'HT'))
    .slice(0, ELSEWHERE_MAX)

  // The film strip runs on artwork, which outlives its event: upcoming
  // posters first, then recent past ones. The chosen city's art when it has
  // enough to fill the strip, else the country's; never another country's.
  const archive = isDemoMode() ? [] : filterBlockedEvents(await getCinemaArtworkEvents(40), blockedOrganizers)
  const stripShape = (e: any) => ({
    id: String(e.id),
    title: String(e.title || ''),
    banner_image_url: e.banner_image_url ? String(e.banner_image_url) : null,
    city: String(e.city || ''),
    country: String(e.country || 'HT'),
  })
  const upcomingArt = inCountry.filter((e) => e.banner_image_url).map(stripShape)
  const seen = new Set(upcomingArt.map((e) => e.id))
  const countryArt = [
    ...upcomingArt,
    ...archive
      .map(stripShape)
      .filter((e) => e.banner_image_url && e.country === country && !seen.has(e.id)),
  ]
  const cityArt = active
    ? countryArt.filter((e) => inCity({ city: e.city, country: e.country } as HomeEvent, active.key))
    : []
  const filmStrip = (cityArt.length >= 6 ? cityArt : countryArt)
    .slice(0, 14)
    .map(({ id, title, banner_image_url }) => ({ id, title, banner_image_url }))

  // Every date prints in the reader's zone, as on the event page and cards:
  // Vercel's per-request zone, else the browsing country's, else Haiti's.
  // Resolved once here so server render and hydration agree.
  const zone = validZone(headerList.get('x-vercel-ip-timezone')) || zoneFor(country) || DEFAULT_ZONE

  // Links into discover carry the same scope, so a day or a world opens on
  // the events it counted.
  const scopeQs = `country=${country}${active ? `&city=${encodeURIComponent(active.name)}` : ''}`

  return (
    <div className="min-h-screen bg-black pb-mobile-nav">
      <LiveTicker signals={buildTickerSignals(inCountry, now)} />
      {/* flush: one black canvas, no hairline under the nav. */}
      <Navbar user={user} isAdmin={isAdmin(user?.email)} flush />
      <CityRow country={country} cities={cities} active={active?.key ?? null} total={inCountry.length} />

      <LocationBannerWrapper userId={user?.id} currentCountry={country} currentCity={profileCity} />

      {isDemoMode() && (
        <div className="bg-white/[0.06]">
          <p className="mx-auto max-w-7xl px-4 py-3 text-sm text-white/80 sm:px-6 lg:px-8">
            <strong>Demo Mode:</strong> You&apos;re viewing sample events. Login with{' '}
            <code>demo-organizer@tikem.co</code> or <code>demo-attendee@tikem.co</code> (password:{' '}
            <code>demo123</code>)
          </p>
        </div>
      )}

      <HomePageContent
        now={now}
        zone={zone}
        country={country}
        countryEmpty={inCountry.length === 0}
        scopeQs={scopeQs}
        hero={pickHeroEvents(scoped, now)}
        filmStrip={filmStrip}
        week={buildWeek(scoped, now, zone)}
        worlds={buildWorlds(scoped)}
        soon={startingSoon(scoped, now)}
        elsewhereMode={elsewhereMode}
        elsewhere={elsewhere}
      />

      <MobileNavWrapper user={user} isAdmin={isAdmin(user?.email)} />
    </div>
  )
}
