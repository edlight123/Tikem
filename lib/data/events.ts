/**
 * Events Data Layer
 * 
 * Centralized data access for events with proper caching, pagination, and optimization.
 * Separates client-side and server-side operations.
 */

import { cache } from 'react'
import { adminDb } from '@/lib/firebase/admin'
import { normalizeCountryCode } from '@/lib/payment-provider'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { db } from '@/lib/firebase/client'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  getDoc,
  doc,
  DocumentSnapshot,
  QueryConstraint,
  getCountFromServer,
  Timestamp
} from 'firebase/firestore'
import { unstable_cache } from 'next/cache'
import { getCityMatchGroup } from '@/lib/filters/config'
import { eventHasEnded } from '@/lib/home/feed'

export interface Event {
  id: string
  title: string
  description: string
  organizer_id: string
  country?: string
  start_datetime: string
  end_datetime: string
  venue_name: string
  address: string
  city: string
  commune: string
  category: string
  status: 'draft' | 'published' | 'cancelled'
  capacity?: number
  ticket_price?: number
  /** Organizer-supplied promo video link (YouTube, Vimeo…). Unvalidated. */
  video_url?: string
  image_url?: string
  created_at: string
  updated_at: string
  [key: string]: any
}

export interface EventFilters {
  city?: string
  category?: string
  status?: string
  search?: string
  startDate?: Date
  endDate?: Date
}

export interface PaginatedResult<T> {
  data: T[]
  lastDoc: DocumentSnapshot | null
  hasMore: boolean
  total?: number
}

// ============================================================================
// SERVER-SIDE FUNCTIONS (use adminDb)
// ============================================================================

/**
 * Get a single event by ID (server-side).
 *
 * Wrapped in React `cache()`, which dedupes by argument for the lifetime of a
 * single request. That is not a micro-optimisation here: the event page calls
 * this TWICE per render — once in `generateMetadata` and once in the page body
 * — and `generateMetadata` blocks the streamed shell, so the second read was
 * sitting directly on top of how fast anything paints, skeleton included.
 * One request, one document read.
 *
 * (The old comment on this function claimed "Cached for 60 seconds". It was
 * not cached at all. The route's own `revalidate = 300` is what gives the
 * rendered page its TTL; this wrapper only collapses duplicate reads within
 * one render, which is the part that was missing.)
 *
 * `cache` is per-request, so it cannot serve one visitor's event to another.
 * The declaration below is a hoisted `function`, which is why it can be
 * referenced here before it appears.
 */
export const getEventById = cache(getEventByIdUncached)

async function getEventByIdUncached(eventId: string): Promise<Event | null> {
    try {
      const eventDoc = await adminDb.collection('events').doc(eventId).get()
      
      if (!eventDoc.exists) {
        return null
      }

      const data = eventDoc.data()

      const inferCountryFromAccountLocation = (raw: unknown): string => {
        const value = String(raw || '').trim().toLowerCase()
        if (!value) return ''
        if (value === 'haiti' || value === 'haïti' || value === 'ht') return 'HT'
        if (
          value === 'united_states' ||
          value === 'united states' ||
          value === 'usa' ||
          value === 'us'
        )
          return 'US'
        if (value === 'canada' || value === 'ca') return 'CA'
        return ''
      }

      const inferCountryFromTextLocation = (raw: unknown): string => {
        const text = String(raw || '').toLowerCase()
        if (!text) return ''
        // Very conservative heuristics for Haiti-only inference.
        if (text.includes('haiti')) return 'HT'
        if (text.includes('port-au-prince') || text.includes('port au prince')) return 'HT'
        return ''
      }

      const directCountry =
        data?.country ??
        data?.location?.country ??
        data?.location?.countryCode ??
        data?.location?.country_code

      let country = normalizeCountryCode(directCountry)

      // If the event doesn't explicitly provide a country, try to infer from the event's own location text
      // BEFORE consulting organizer payout settings. This avoids cases where an organizer is US/CA-based
      // (Stripe Connect) but the specific event is actually in Haiti.
      if (!country) {
        country = inferCountryFromTextLocation(
          [data?.venue_name, data?.address, data?.commune, data?.city].filter(Boolean).join(' ')
        )
      }

      // Fallback: infer from organizer profile/payout config if event country is still missing.
      if (!country) {
        const organizerId = String(data?.organizer_id || '').trim()
        if (organizerId) {
          try {
            const [organizerDoc, userDoc, haitiProfile, stripeProfile] = await Promise.all([
              adminDb.collection('organizers').doc(organizerId).get(),
              adminDb.collection('users').doc(organizerId).get(),
              getPayoutProfile(organizerId, 'haiti'),
              getPayoutProfile(organizerId, 'stripe_connect'),
            ])

            const organizerData = organizerDoc.exists ? (organizerDoc.data() as any) : null
            const userData = userDoc.exists ? (userDoc.data() as any) : null

            // If both payout profiles exist, inference from payout settings is ambiguous.
            const hasHaitiProfile = Boolean(haitiProfile)
            const hasStripeProfile = Boolean(stripeProfile)

            const inferredFromPayout = (() => {
              if (hasHaitiProfile && !hasStripeProfile) return 'HT'
              if (hasStripeProfile && !hasHaitiProfile) {
                return (
                  inferCountryFromAccountLocation(
                    stripeProfile?.accountLocation ?? stripeProfile?.bankDetails?.accountLocation
                  ) || ''
                )
              }
              return ''
            })()

            country =
              normalizeCountryCode(
                organizerData?.country ??
                  organizerData?.location?.country ??
                  organizerData?.location?.countryCode ??
                  organizerData?.location?.country_code ??
                  userData?.country ??
                  userData?.location?.country ??
                  userData?.location?.countryCode ??
                  userData?.location?.country_code
              ) ||
              inferredFromPayout ||
              inferCountryFromAccountLocation(organizerData?.accountLocation ?? userData?.accountLocation) ||
              inferCountryFromTextLocation(
                [
                  organizerData?.default_city,
                  organizerData?.city,
                  organizerData?.address,
                  userData?.default_city,
                  userData?.city,
                  userData?.address,
                ]
                  .filter(Boolean)
                  .join(' ')
              )
          } catch (e) {
            console.warn('Country inference fallback failed for organizer:', organizerId, e)
          }
        }
      }
      
      // Explicitly construct event object to exclude problematic fields like ticket_tiers
      // (ticket_tiers array in event doc can cause React render errors if passed to client)
      return {
        id: eventDoc.id,
        organizer_id: data?.organizer_id,
        title: data?.title,
        description: data?.description,
        category: data?.category,
        venue_name: data?.venue_name,
        country,
        city: data?.city,
        commune: data?.commune,
        address: data?.address,
        location: data?.location,
        timezone: data?.timezone,
        status: data?.status || 'draft',
        start_datetime: data?.start_datetime?.toDate?.()?.toISOString() || data?.start_datetime,
        end_datetime: data?.end_datetime?.toDate?.()?.toISOString() || data?.end_datetime,
        capacity: data?.capacity,
        ticket_price: data?.ticket_price,
        // Pricing classification signals (see lib/ticketPricing.ts). `ticket_price`
        // is the LOWEST tier price and is 0 for any event that offers a free tier
        // alongside paid ones, so it cannot decide freeness on its own. These two
        // explicit flags are what `resolveEventPricing` trusts first.
        is_rsvp: data?.is_rsvp ?? undefined,
        has_paid_tiers: data?.has_paid_tiers ?? undefined,
        image_url: data?.banner_image_url || data?.image_url,
        banner_image_url: data?.banner_image_url || data?.image_url,
        currency: data?.currency || 'HTG',
        total_tickets: data?.total_tickets || data?.capacity || 0,
        tickets_sold: data?.tickets_sold || 0,
        tickets_available: data?.tickets_available,
        is_published: data?.is_published,
        // The buy flow must know to prompt for the access code BEFORE checkout —
        // the server routes enforce it either way, but without this flag the UI
        // never asks and buyers dead-end on access_code_required.
        is_password_protected: data?.is_password_protected ?? false,
        // The event's song (rendered by SpotifyEmbed on the event page).
        spotify_url: data?.spotify_url || null,
        // The bill — who is performing (rendered by EventLineup). This object is
        // an explicit whitelist, so a field absent here is invisible to every
        // reader no matter what the doc holds; the lineup an organizer typed was
        // dead on the page for exactly that reason.
        guestlist:
          data?.guestlist && Array.isArray(data.guestlist) ? data.guestlist : undefined,
        // The poster's dominant colour, derived in the composer and used to
        // tint the glow behind the artwork on this page. Without it in this
        // whitelist the field would be written and never seen — which is
        // exactly what happened to guestlist, spotify_url and theme_key.
        accent_color: typeof data?.accent_color === 'string' ? data.accent_color : undefined,
        // Whitelisted because this reader is explicit: a field absent here is a
        // field the event page never sees, however faithfully it was saved.
        // The promo video. The composer has always SAVED this and the web
        // event page has never shown it, because it was missing here — the
        // mobile app reads Firestore directly, so it worked there and only
        // there. Fifth field this explicit reader has silently swallowed.
        video_url: typeof data?.video_url === 'string' ? data.video_url : undefined,
        guestlist_visibility:
          data?.guestlist_visibility === 'faces' ||
          data?.guestlist_visibility === 'count' ||
          data?.guestlist_visibility === 'hidden'
            ? data.guestlist_visibility
            : undefined,
        show_guestlist: data?.show_guestlist === false ? false : undefined,
        // Read back by the composer's "Part of …?" toggle on edit.
        national_day: typeof data?.national_day === 'string' ? data.national_day : undefined,
        tags: data?.tags && Array.isArray(data.tags) ? data.tags.filter((tag: any) => typeof tag === 'string') : undefined,
        created_at: data?.created_at?.toDate?.()?.toISOString() || data?.created_at,
        updated_at: data?.updated_at?.toDate?.()?.toISOString() || data?.updated_at,
        // Note: ticket_tiers array is intentionally excluded to prevent React render errors
        // Ticket tiers are fetched separately from ticket_tiers collection
      } as Event
    } catch (error) {
      console.error('Error fetching event:', error)
      return null
    }
}

/** How long a discover/home Firestore read is reused before going back to Firestore. */
const DISCOVER_CACHE_SECONDS = 30

/**
 * The Firestore half of getDiscoverEvents: the published-events read plus the
 * field mapping, with NOTHING time- or user-dependent in it.
 *
 * Split out and cached because the home and discover pages are both
 * `force-dynamic` (they read auth cookies to personalize), so without this every
 * single request ran the query again. Only the three inputs that actually shape
 * the query are cache keys — search terms and date cutoffs are applied in memory
 * by the caller, so they don't fragment the cache.
 */
const readPublishedEvents = unstable_cache(
  async (city: string, category: string, fetchLimit: number): Promise<Event[]> => {
    const buildBaseQuery = (mode: 'is_published' | 'status') => {
      let queryRef = adminDb.collection('events').orderBy('start_datetime', 'asc')

      if (mode === 'is_published') {
        queryRef = queryRef.where('is_published', '==', true) as any
      } else {
        queryRef = queryRef.where('status', '==', 'published') as any
      }

      // Apply filters — metro-inclusive city match (city + its subdivisions).
      if (city) {
        const cityGroup = getCityMatchGroup(city)
        queryRef = (cityGroup.length > 1
          ? queryRef.where('city', 'in', cityGroup)
          : queryRef.where('city', '==', city)) as any
      }

      if (category) {
        queryRef = queryRef.where('category', '==', category) as any
      }

      queryRef = queryRef.limit(fetchLimit) as any
      return queryRef
    }

    // Primary: canonical Firestore field `is_published: true`
    let snapshot = await buildBaseQuery('is_published').get()
    // Fallback: legacy field `status: 'published'`
    if (snapshot.empty) {
      snapshot = await buildBaseQuery('status').get()
    }

    // The base query above is ordered OLDEST first and capped, so once the
    // catalogue holds more than `fetchLimit` published events it returns past
    // events only and the upcoming ones fall off the end. Worse, start_datetime
    // is stored as a Timestamp by mobile and as an ISO string by the web
    // composer, and Firestore sorts every Timestamp before any string, so the
    // string-dated (web-created) events are the first to be cut.
    //
    // So also read the upcoming window directly, once per stored type: a range
    // on a Date matches only Timestamps, a range on an ISO string matches only
    // strings. The window opens a week back so a multi-day event that started
    // earlier but has not ended is still read; ended events are cut by the
    // caller. A failing read (e.g. a missing index) degrades to the base query
    // instead of emptying the feed.
    const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const upcomingQuery = (bound: Date | string) => {
      let q: any = adminDb
        .collection('events')
        .where('is_published', '==', true)
        .where('start_datetime', '>=', bound)
      if (city) {
        const cityGroup = getCityMatchGroup(city)
        q = cityGroup.length > 1 ? q.where('city', 'in', cityGroup) : q.where('city', '==', city)
      }
      if (category) q = q.where('category', '==', category)
      return q
        .orderBy('start_datetime', 'asc')
        .limit(fetchLimit)
        .get()
        .catch((err: unknown) => {
          console.warn('Upcoming events window read failed; using the base query only:', err)
          return null
        })
    }
    const windows = await Promise.all([
      upcomingQuery(windowStart),
      upcomingQuery(windowStart.toISOString()),
    ])
    const seen = new Set<string>()
    const docs: any[] = []
    for (const snap of [...windows, snapshot]) {
      for (const d of snap?.docs || []) {
        if (seen.has(d.id)) continue
        seen.add(d.id)
        docs.push(d)
      }
    }

    return docs.map((doc: any) => {
      const data = doc.data()
      return {
        id: doc.id,
        organizer_id: data.organizer_id,
        title: data.title,
        description: data.description,
        category: data.category,
        venue_name: data.venue_name,
        city: data.city,
        commune: data.commune,
        address: data.address,
        country: data.country || 'HT', // Default to Haiti for events without country
        // The zone cards print times in (lib/home/feed eventZone).
        timezone: typeof data.timezone === 'string' ? data.timezone : undefined,
        status: data.status || 'draft',
        start_datetime: data.start_datetime?.toDate?.()?.toISOString() || data.start_datetime,
        end_datetime: data.end_datetime?.toDate?.()?.toISOString() || data.end_datetime,
        capacity: data.capacity,
        ticket_price: data.ticket_price,
        // Pricing classification signals — see lib/ticketPricing.ts.
        is_rsvp: data?.is_rsvp ?? undefined,
        has_paid_tiers: data?.has_paid_tiers ?? undefined,
        image_url: data.banner_image_url || data.image_url,
        banner_image_url: data.banner_image_url || data.image_url,
        currency: data.currency || 'HTG',
        total_tickets: data.total_tickets || data.capacity || 0,
        tickets_sold: data.tickets_sold || 0,
        show_on_explore: data.show_on_explore,
        rejected: data.rejected,
        // Auto-hidden after repeated user reports, pending admin review
        // (lib/moderation/reports.ts). Discovery skips it; direct links still work.
        hidden_pending_review: data.hidden_pending_review === true,
        // The admin Feature star. Missing from this whitelist, it never reached
        // a single listing: the homepage's picks and the relevance sort both
        // read it and both always saw `undefined`. `is_featured` is legacy
        // test data.
        featured: data.featured === true || data.is_featured === true,
        // The organizer's absorb/pass-on choice. A card's all-in price depends
        // on it; without it every diaspora card assumed the country default.
        fee_incidence: typeof data.fee_incidence === 'string' ? data.fee_incidence : undefined,
        // Who is on the bill — the homepage hero prints it.
        guestlist: Array.isArray(data.guestlist) ? data.guestlist : undefined,
        // The national day the organizer tagged it for (lib/nationalDays.ts):
        // the homepage banner counts these and /discover?day= lists them.
        national_day: typeof data.national_day === 'string' ? data.national_day : undefined,
        created_at: data.created_at?.toDate?.()?.toISOString() || data.created_at,
        updated_at: data.updated_at?.toDate?.()?.toISOString() || data.updated_at,
      } as Event
    })
  },
  ['discover-events'],
  { revalidate: DISCOVER_CACHE_SECONDS, tags: ['events'] }
)

/**
 * Get events for discover page with filters and pagination (server-side).
 * The Firestore read is cached for DISCOVER_CACHE_SECONDS; the time-sensitive
 * and search filtering below runs fresh on every call.
 */
export async function getDiscoverEvents(
  filters: EventFilters = {},
  pageSize: number = 20
): Promise<Event[]> {
    try {
      const now = new Date()

      // start_datetime is stored with mixed types (Timestamp vs ISO string) and
      // Firestore range filters are type-sensitive, so readPublishedEvents reads
      // the upcoming window once per type and merges; ended events are cut in
      // memory below.
      const fetchLimit = Math.min(Math.max(pageSize * 2, 50), 100)

      let events = await readPublishedEvents(
        filters.city || '',
        filters.category || '',
        fetchLimit
      )

      // Exclude events the organizer opted out of Explore/discovery.
      // Only `show_on_explore === false` hides an event; missing/undefined stays visible
      // (legacy events lack the field). Done in-memory so docs without the field aren't dropped.
      // Unlisted events remain reachable by direct link (single-event fetchers are unaffected).
      events = events.filter((event: Event) => event.show_on_explore !== false)

      // Moderation: never surface events an admin has rejected. Only `rejected === true` hides an
      // event; missing/undefined stays visible (legacy events lack the field). Done in-memory so
      // docs without the field aren't dropped by a type-sensitive Firestore inequality query.
      events = events.filter((event: Event) => (event as any).rejected !== true)

      // Moderation: an event auto-hidden after repeated reports stays out of
      // discovery until an admin reviews it (lib/moderation/reports.ts).
      events = events.filter((event: Event) => (event as any).hidden_pending_review !== true)

      // Apply search filter in memory (Firestore doesn't support text search)
      if (filters.search) {
        const searchLower = filters.search.toLowerCase()
        events = events.filter((event: Event) =>
          event.title?.toLowerCase().includes(searchLower) ||
          event.description?.toLowerCase().includes(searchLower) ||
          event.venue_name?.toLowerCase().includes(searchLower) ||
          event.category?.toLowerCase().includes(searchLower)
        )
      }

      // Apply startDate in memory (see note above re: mixed Firestore field types)
      if (filters.startDate) {
        const startCutoff = filters.startDate instanceof Date
          ? filters.startDate
          : new Date(filters.startDate as any)

        if (!Number.isNaN(startCutoff.getTime())) {
          events = events.filter((event: Event) => {
            const start = new Date(event.start_datetime)
            return !Number.isNaN(start.getTime()) && start.getTime() >= startCutoff.getTime()
          })
        }
      }

      // Drop ended events: past their end, or, with no end stored, past start
      // plus the default run (lib/home/feed). This used to keep anything that
      // started within the last WEEK, so a one-night event dated Oct 3 was
      // still listed on Oct 5.
      events = events.filter((event: Event) => !eventHasEnded(event as any, now.getTime()))

      // Return soonest upcoming first (query is already ASC, but keep this deterministic)
      events = events
        .sort((a: Event, b: Event) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime())
        .slice(0, pageSize)

      return events
    } catch (error) {
      console.error('Error fetching discover events:', error)
      return []
    }
}

/**
 * Poster artwork pool for the homepage cinema (film strip, pinned chapter,
 * city collages). Unlike getDiscoverEvents this does NOT cut past events —
 * posters are marketing artwork and outlive their event, and every one still
 * links to a renderable event page. Published, moderated, explore-visible,
 * with artwork; most recent first. Reuses the same 30s-cached Firestore read
 * as the discover surfaces, so it costs no extra query on a warm cache.
 */
export async function getCinemaArtworkEvents(limit: number = 20): Promise<Event[]> {
  try {
    const events = await readPublishedEvents('', '', 100)
    return events
      .filter((e: Event) => e.show_on_explore !== false)
      .filter((e: Event) => (e as any).rejected !== true)
      .filter((e: Event) => (e as any).hidden_pending_review !== true)
      .filter((e: Event) => e.banner_image_url)
      .sort((a: Event, b: Event) => {
        const ta = new Date(a.start_datetime).getTime() || 0
        const tb = new Date(b.start_datetime).getTime() || 0
        return tb - ta
      })
      .slice(0, limit)
  } catch (error) {
    console.error('Error fetching cinema artwork events:', error)
    return []
  }
}

/**
 * Get organizer's events with pagination (server-side)
 */
export async function getOrganizerEvents(
  organizerId: string,
  pageSize: number = 20,
  lastDocument?: DocumentSnapshot
): Promise<PaginatedResult<Event>> {
  try {
    let queryRef = adminDb.collection('events')
      .where('organizer_id', '==', organizerId)
      .orderBy('created_at', 'desc')
      .limit(pageSize + 1) // Fetch one extra to check if there are more

    if (lastDocument) {
      queryRef = queryRef.startAfter(lastDocument) as any
    }

    const snapshot = await queryRef.get()
    const hasMore = snapshot.docs.length > pageSize
    const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs

    const events = docs.map((doc: any) => {
      const data = doc.data()
      return {
        id: doc.id,
        organizer_id: data.organizer_id,
        title: data.title,
        description: data.description,
        category: data.category,
        venue_name: data.venue_name,
        city: data.city,
        commune: data.commune,
        address: data.address,
        status: data.status || 'draft',
        start_datetime: data.start_datetime?.toDate?.()?.toISOString() || data.start_datetime,
        end_datetime: data.end_datetime?.toDate?.()?.toISOString() || data.end_datetime,
        capacity: data.capacity,
        ticket_price: data.ticket_price,
        // Pricing classification signals — see lib/ticketPricing.ts. `ticket_price`
        // is the LOWEST tier price, so it is 0 for an event that offers a free tier
        // next to paid ones and cannot decide freeness on its own.
        is_rsvp: data?.is_rsvp ?? undefined,
        has_paid_tiers: data?.has_paid_tiers ?? undefined,
        image_url: data.banner_image_url || data.image_url,
        banner_image_url: data.banner_image_url || data.image_url,
        currency: data.currency || 'HTG',
        total_tickets: data.total_tickets || data.capacity || 0,
        tickets_sold: data.tickets_sold || 0,
        created_at: data.created_at?.toDate?.()?.toISOString() || data.created_at,
        updated_at: data.updated_at?.toDate?.()?.toISOString() || data.updated_at,
      }
    })

    return {
      data: events,
      lastDoc: hasMore ? docs[docs.length - 1] : null,
      hasMore,
    }
  } catch (error) {
    console.error('Error fetching organizer events:', error)
    return { data: [], lastDoc: null, hasMore: false }
  }
}

/**
 * Get count of organizer's events by status (server-side, aggregation)
 */
export async function getOrganizerEventsCounts(organizerId: string): Promise<{
  total: number
  published: number
  draft: number
  cancelled: number
}> {
  try {
    const [totalSnap, publishedSnap, draftSnap, cancelledSnap] = await Promise.all([
      adminDb.collection('events')
        .where('organizer_id', '==', organizerId)
        .count()
        .get(),
      adminDb.collection('events')
        .where('organizer_id', '==', organizerId)
        .where('status', '==', 'published')
        .count()
        .get(),
      adminDb.collection('events')
        .where('organizer_id', '==', organizerId)
        .where('status', '==', 'draft')
        .count()
        .get(),
      adminDb.collection('events')
        .where('organizer_id', '==', organizerId)
        .where('status', '==', 'cancelled')
        .count()
        .get(),
    ])

    return {
      total: totalSnap.data().count,
      published: publishedSnap.data().count,
      draft: draftSnap.data().count,
      cancelled: cancelledSnap.data().count,
    }
  } catch (error) {
    console.error('Error getting event counts:', error)
    return { total: 0, published: 0, draft: 0, cancelled: 0 }
  }
}

/**
 * Get admin events with filters and pagination (server-side)
 */
export async function getAdminEvents(
  filters: EventFilters = {},
  pageSize: number = 50,
  lastDocument?: DocumentSnapshot
): Promise<PaginatedResult<Event>> {
  try {
    let queryRef = adminDb.collection('events').orderBy('created_at', 'desc')

    if (filters.city) {
      const cityGroup = getCityMatchGroup(filters.city)
      queryRef = (cityGroup.length > 1
        ? queryRef.where('city', 'in', cityGroup)
        : queryRef.where('city', '==', filters.city)) as any
    }

    if (filters.category) {
      queryRef = queryRef.where('category', '==', filters.category) as any
    }

    if (filters.status) {
      queryRef = queryRef.where('status', '==', filters.status) as any
    }

    queryRef = queryRef.limit(pageSize + 1) as any

    if (lastDocument) {
      queryRef = queryRef.startAfter(lastDocument) as any
    }

    const snapshot = await queryRef.get()
    const hasMore = snapshot.docs.length > pageSize
    const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs

    let events = docs.map((doc: any) => {
      const data = doc.data()
      return {
        id: doc.id,
        organizer_id: data.organizer_id,
        title: data.title,
        description: data.description,
        category: data.category,
        venue_name: data.venue_name,
        city: data.city,
        commune: data.commune,
        address: data.address,
        status: data.status || 'draft',
        start_datetime: data.start_datetime?.toDate?.()?.toISOString() || data.start_datetime,
        end_datetime: data.end_datetime?.toDate?.()?.toISOString() || data.end_datetime,
        capacity: data.capacity,
        ticket_price: data.ticket_price,
        // Pricing classification signals — see lib/ticketPricing.ts. `ticket_price`
        // is the LOWEST tier price, so it is 0 for an event that offers a free tier
        // next to paid ones and cannot decide freeness on its own.
        is_rsvp: data?.is_rsvp ?? undefined,
        has_paid_tiers: data?.has_paid_tiers ?? undefined,
        image_url: data.banner_image_url || data.image_url,
        banner_image_url: data.banner_image_url || data.image_url,
        currency: data.currency || 'HTG',
        total_tickets: data.total_tickets || data.capacity || 0,
        tickets_sold: data.tickets_sold || 0,
        created_at: data.created_at?.toDate?.()?.toISOString() || data.created_at,
        updated_at: data.updated_at?.toDate?.()?.toISOString() || data.updated_at,
      }
    })

    // Apply search filter in memory
    if (filters.search) {
      const searchLower = filters.search.toLowerCase()
      events = events.filter((event: Event) =>
        event.title?.toLowerCase().includes(searchLower) ||
        event.city?.toLowerCase().includes(searchLower)
      )
    }

    return {
      data: events,
      lastDoc: hasMore ? docs[docs.length - 1] : null,
      hasMore,
    }
  } catch (error) {
    console.error('Error fetching admin events:', error)
    return { data: [], lastDoc: null, hasMore: false }
  }
}

// ============================================================================
// CLIENT-SIDE FUNCTIONS (use db)
// ============================================================================

/**
 * Get organizer's events (client-side) with pagination
 * Use this from client components only
 */
export async function getOrganizerEventsClient(
  organizerId: string,
  pageSize: number = 20,
  lastDocument?: DocumentSnapshot
): Promise<PaginatedResult<Event>> {
  try {
    const constraints: QueryConstraint[] = [
      where('organizer_id', '==', organizerId),
      orderBy('created_at', 'desc'),
      limit(pageSize + 1),
    ]

    if (lastDocument) {
      constraints.push(startAfter(lastDocument))
    }

    const q = query(collection(db, 'events'), ...constraints)
    const snapshot = await getDocs(q)

    const hasMore = snapshot.docs.length > pageSize
    const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs

    const events = docs.map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        organizer_id: data.organizer_id,
        title: data.title,
        description: data.description,
        category: data.category,
        venue_name: data.venue_name,
        city: data.city,
        commune: data.commune,
        address: data.address,
        status: data.status || 'draft',
        start_datetime: data.start_datetime instanceof Timestamp 
          ? data.start_datetime.toDate().toISOString() 
          : data.start_datetime,
        end_datetime: data.end_datetime instanceof Timestamp 
          ? data.end_datetime.toDate().toISOString() 
          : data.end_datetime,
        capacity: data.capacity,
        ticket_price: data.ticket_price,
        // Pricing classification signals — see lib/ticketPricing.ts. `ticket_price`
        // is the LOWEST tier price, so it is 0 for an event that offers a free tier
        // next to paid ones and cannot decide freeness on its own.
        is_rsvp: data?.is_rsvp ?? undefined,
        has_paid_tiers: data?.has_paid_tiers ?? undefined,
        image_url: data.banner_image_url || data.image_url,
        banner_image_url: data.banner_image_url || data.image_url,
        currency: data.currency || 'HTG',
        total_tickets: data.total_tickets || data.capacity || 0,
        tickets_sold: data.tickets_sold || 0,
        created_at: data.created_at instanceof Timestamp 
          ? data.created_at.toDate().toISOString() 
          : data.created_at,
        updated_at: data.updated_at instanceof Timestamp 
          ? data.updated_at.toDate().toISOString() 
          : data.updated_at,
      } as Event
    })

    return {
      data: events,
      lastDoc: hasMore ? docs[docs.length - 1] : null,
      hasMore,
    }
  } catch (error) {
    console.error('Error fetching organizer events (client):', error)
    return { data: [], lastDoc: null, hasMore: false }
  }
}

/**
 * Get event count for organizer (client-side, aggregation)
 */
export async function getOrganizerEventsCountClient(organizerId: string): Promise<number> {
  try {
    const q = query(
      collection(db, 'events'),
      where('organizer_id', '==', organizerId)
    )
    const snapshot = await getCountFromServer(q)
    return snapshot.data().count
  } catch (error) {
    console.error('Error counting events (client):', error)
    return 0
  }
}

/**
 * Check if a user has favorited an event (server-side)
 */
export async function checkIsFavorite(userId: string, eventId: string): Promise<boolean> {
  try {
    const snapshot = await adminDb.collection('event_favorites')
      .where('user_id', '==', userId)
      .where('event_id', '==', eventId)
      .limit(1)
      .get()
    
    return !snapshot.empty
  } catch (error) {
    console.error('Error checking favorite status:', error)
    return false
  }
}

/**
 * Check if a user is following an organizer (server-side)
 */
export async function checkIsFollowing(userId: string, organizerId: string): Promise<boolean> {
  try {
    const snapshot = await adminDb.collection('organizer_follows')
      .where('follower_id', '==', userId)
      .where('organizer_id', '==', organizerId)
      .limit(1)
      .get()
    
    return !snapshot.empty
  } catch (error) {
    console.error('Error checking following status:', error)
    return false
  }
}

