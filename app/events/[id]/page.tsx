import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import { getEventById, checkIsFavorite, checkIsFollowing } from '@/lib/data/events'
import { adminDb } from '@/lib/firebase/admin'
import Navbar from '@/components/Navbar'
import { notFound } from 'next/navigation'
import { isDemoMode, DEMO_EVENTS } from '@/lib/demo'
import type { Metadata } from 'next'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import EventDetailsClient from './EventDetailsClient'
import { cookies } from 'next/headers'
import { intlLocaleFor } from '@/lib/dateLocale'
import { ticketScarcity, isUrgent } from '@/lib/ticketScarcity'

export const runtime = 'nodejs'
export const revalidate = 300 // Cache for 5 minutes

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params

  let event: any = null

  if (isDemoMode()) {
    event = DEMO_EVENTS.find(e => e.id === id)
  } else {
    event = await getEventById(id)
  }

  if (!event) {
    return {
      title: 'Event Not Found',
    }
  }

  // The og:title/description language follows the visitor's cookie-set language,
  // same signal app/layout.tsx uses to SSR the rest of the page in fr/ht.
  const lang = (await cookies()).get('i18nextLng')?.value?.slice(0, 2)
  const eventDate = new Date(event.start_datetime).toLocaleDateString(intlLocaleFor(lang), {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  // NOTE: no `images` here, deliberately. An explicit openGraph.images OVERRIDES
  // the opengraph-image.tsx file convention, and this used to point straight at
  // the raw poster — which shipped a bare og:image with no og:image:width or
  // og:image:height. Scrapers (WhatsApp especially) will not download an image
  // just to measure it, so the preview arrived with no picture; and when it did
  // render, a 1080x1350 portrait poster in a summary_large_image card was
  // cropped to nothing. Leaving images unset lets the sibling opengraph-image
  // route supply the 1200x630 card AND its dimensions automatically.
  return {
    title: `${event.title} | Tikèm`,
    description: event.description || `Join us for ${event.title} at ${event.venue_name}, ${event.city}`,
    alternates: { canonical: `/events/${id}` },
    openGraph: {
      title: event.title,
      description: event.description || `Join us for ${event.title}`,
      type: 'website',
      siteName: 'Tikèm',
      url: `/events/${id}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: event.title,
      description: event.description || `Join us for ${event.title}`,
    },
  }
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  const { id } = await params
  
  let event: any = null
  
  if (isDemoMode()) {
    // Find demo event by ID
    event = DEMO_EVENTS.find(e => e.id === id)
    
    if (!event) {
      notFound()
    }
    
    // Add mock organizer info for demo events
    event = {
      ...event,
      users: {
        full_name: 'Demo Organizer',
        is_verified: true
      }
    }
  } else {
    try {
      // Fetch from Firestore with timeout handling
      const eventData = await getEventById(id)

      if (!eventData) {
        notFound()
      }

      const isPubliclyPublished = Boolean(eventData.is_published || eventData.status === 'published')
      if (!isPubliclyPublished && eventData.organizer_id !== user?.id) {
        notFound()
      }

      // Fetch organizer and ticket tiers in parallel
      const [organizerDoc, tiersSnapshot] = await Promise.all([
        adminDb.collection('users').doc(eventData.organizer_id).get(),
        adminDb.collection('ticket_tiers').where('event_id', '==', id).get().catch(() => ({ docs: [] }))
      ])
      
      const organizerData = organizerDoc.exists ? organizerDoc.data() : null

      // Calculate total capacity from tiers
      const totalFromTiers = tiersSnapshot.docs.reduce((sum: number, doc: any) => {
        const data = doc.data()
        return sum + (data.total_quantity || data.quantity || 0)
      }, 0)

      // Price-only shadow of the tier set, so the client can classify this event's
      // pricing (free / paid / mixed) without `ticket_price` — which is the LOWEST
      // tier price and therefore 0 for any event that has a free tier next to paid
      // ones. `getEventById` intentionally drops the event doc's embedded
      // `ticket_tiers` array (rich objects break client serialization), so we
      // rebuild a minimal `{ price }[]` from the authoritative `ticket_tiers`
      // collection we already fetched above. See lib/ticketPricing.ts.
      const tierPriceShadow = tiersSnapshot.docs.map((doc: any) => ({
        price: Number(doc.data()?.price ?? 0) || 0,
      }))

      // Combine event and organizer data
      event = {
        ...eventData,
        ticket_tiers: tierPriceShadow,
        total_tickets: totalFromTiers || eventData.total_tickets || 0,
        users: organizerData ? {
          full_name: organizerData.full_name || 'Event Organizer',
          // Organization brand overrides the personal name wherever the
          // organizer is displayed (falls back to full_name when unset).
          organization_name: organizerData.organization_name || '',
          organization_logo: organizerData.organization_logo || '',
          is_verified: organizerData.is_verified ?? false
        } : {
          full_name: 'Event Organizer',
          organization_name: '',
          organization_logo: '',
          is_verified: false
        }
      }
    } catch (error) {
      console.error('Error fetching event:', error)
      notFound()
    }
  }

  const remainingTickets = (event.total_tickets || 0) - (event.tickets_sold || 0)
  const isSoldOut = remainingTickets <= 0 && (event.total_tickets || 0) > 0
  // Freeness is NOT derived here. `!ticket_price` was wrong (ticket_price is the
  // lowest tier price, so a free tier next to a paid one read as "free") and the
  // value was never used — the real classification happens in EventDetailsClient
  // via `resolveEventPricing` from lib/ticketPricing.ts, off the tier set attached
  // above.

  // Premium badge logic
  // isVIP removed with the badge it fed (owner ask) — see EventDetailsClient.
  const isTrending = (event.tickets_sold || 0) > 10
  // Shared ladder — see lib/ticketScarcity. Was a second, independent
  // `remainingTickets < 10` that could disagree with the client component's.
  const selloutSoon = !isSoldOut && isUrgent(ticketScarcity({
    total: (event as any).total_tickets,
    sold: (event as any).tickets_sold,
    startsAt: (event as any).start_datetime,
  }))

  // Fetch related events and user status in parallel
  let relatedEvents: any[] = []
  let isFollowing = false
  let isFavorite = false

  if (!isDemoMode()) {
    const now = new Date()

    // Start all independent queries in parallel
    const [relatedSnapshot, followingResult, favoriteResult] = await Promise.all([
      adminDb.collection('events')
        .where('category', '==', event.category)
        .where('is_published', '==', true)
        .where('start_datetime', '>=', now)
        .limit(4)
        .get(),
      user && event.organizer_id ? checkIsFollowing(user.id, event.organizer_id) : Promise.resolve(false),
      user ? checkIsFavorite(user.id, id) : Promise.resolve(false)
    ])

    isFollowing = followingResult
    isFavorite = favoriteResult

    // Process related events - batch fetch organizers
    const filteredRelated = relatedSnapshot.docs
      .filter((doc: any) => doc.id !== id)
      .slice(0, 3)
    
    const organizerIds = Array.from(new Set(filteredRelated.map((doc: any) => doc.data().organizer_id)))
    const organizersMap = new Map<string, any>()
    
    if (organizerIds.length > 0) {
      const organizerSnapshots = await Promise.all(
        organizerIds.map(orgId => adminDb.collection('users').doc(orgId).get())
      )
      
      organizerSnapshots.forEach((doc: any) => {
        if (doc.exists) {
          organizersMap.set(doc.id, doc.data())
        }
      })
    }
    
    // Map related events with pre-fetched organizer data
    relatedEvents = filteredRelated.map((doc: any) => {
      const data = doc.data()
      const organizerData = organizersMap.get(data.organizer_id)
      
      return {
        id: doc.id,
        title: data.title,
        description: data.description,
        category: data.category,
        venue_name: data.venue_name,
        city: data.city,
        commune: data.commune,
        address: data.address,
        start_datetime: data.start_datetime?.toDate?.()?.toISOString() || data.start_datetime,
        end_datetime: data.end_datetime?.toDate?.()?.toISOString() || data.end_datetime,
        ticket_price: data.ticket_price,
        total_tickets: data.total_tickets,
        tickets_sold: data.tickets_sold,
        banner_image_url: data.banner_image_url || data.image_url,
        image_url: data.image_url,
        currency: data.currency || 'HTG',
        organizer_id: data.organizer_id,
        is_published: data.is_published,
        users: organizerData ? {
          full_name: organizerData.full_name || 'Event Organizer',
          // Organization brand overrides the personal name wherever the
          // organizer is displayed (falls back to full_name when unset).
          organization_name: organizerData.organization_name || '',
          organization_logo: organizerData.organization_logo || '',
          is_verified: organizerData.is_verified ?? false
        } : {
          full_name: 'Event Organizer',
          organization_name: '',
          organization_logo: '',
          is_verified: false
        }
      }
    })
  } else {
    // Use demo events for related section
    relatedEvents = DEMO_EVENTS.filter(e => e.category === event.category && e.id !== id).slice(0, 3)
  }

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

  const serializedEvent = serializeData(event)
  const serializedRelatedEvents = serializeData(relatedEvents)

  return (
    <div className="surface-dark min-h-screen pb-mobile-nav md:pb-8">
      <Navbar user={user} isAdmin={isAdmin(user?.email)} />
      <EventDetailsClient 
        event={serializedEvent}
        user={user}
        isFavorite={isFavorite}
        isFollowing={isFollowing}
        relatedEvents={serializedRelatedEvents}
      />
      <MobileNavWrapper user={user} isAdmin={isAdmin(user?.email)} />
    </div>
  )
}
