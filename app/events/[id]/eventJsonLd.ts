/**
 * schema.org Event structured data for the event page (Google's event rich
 * results). Pure: page.tsx hands it the event it already loaded.
 *
 * Dates carry the event zone's offset (lib/home/format isoWithOffset): a bare
 * UTC "Z" string is valid but makes crawlers display the UTC wall time.
 */

import { eventZone } from '@/lib/home/feed'
import { isoWithOffset } from '@/lib/home/format'

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function validDate(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(v as any)
  return Number.isNaN(d.getTime()) ? null : d
}

export function buildEventJsonLd(event: any, siteUrl: string): Record<string, unknown> | null {
  const start = validDate(event?.start_datetime)
  if (!event?.id || !str(event?.title) || !start) return null

  const zone = eventZone(event)
  const end = validDate(event?.end_datetime)
  const url = `${siteUrl.replace(/\/$/, '')}/events/${event.id}`
  const currency = str(event?.currency) || 'HTG'

  const venue = str(event?.venue_name)
  const city = str(event?.city)
  const isOnline = !venue && !city

  const prices: number[] = (Array.isArray(event?.ticket_tiers) ? event.ticket_tiers : [])
    .map((t: any) => Number(t?.price))
    .filter((n: number) => Number.isFinite(n) && n >= 0)
  if (prices.length === 0 && Number.isFinite(Number(event?.ticket_price))) {
    prices.push(Number(event.ticket_price) || 0)
  }

  const total = Number(event?.total_tickets) || 0
  const sold = Number(event?.tickets_sold) || 0
  const availability =
    total > 0 && sold >= total ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock'

  let offers: Record<string, unknown> | undefined
  if (prices.length > 0) {
    const low = Math.min(...prices)
    const high = Math.max(...prices)
    offers =
      low === high
        ? { '@type': 'Offer', price: low, priceCurrency: currency, availability, url }
        : {
            '@type': 'AggregateOffer',
            lowPrice: low,
            highPrice: high,
            priceCurrency: currency,
            availability,
            url,
            offerCount: prices.length,
          }
  }

  const organizerName =
    str(event?.users?.organization_name) || str(event?.users?.full_name) || 'Event Organizer'

  const image = str(event?.banner_image_url) || str(event?.image_url)
  const description = str(event?.description)
  const status = str(event?.status).toLowerCase()

  const country = str(event?.country).toUpperCase() || 'HT'

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: str(event.title),
    ...(description ? { description: description.slice(0, 5000) } : {}),
    startDate: isoWithOffset(start, zone),
    ...(end && end.getTime() > start.getTime() ? { endDate: isoWithOffset(end, zone) } : {}),
    eventStatus:
      status === 'cancelled' || status === 'canceled'
        ? 'https://schema.org/EventCancelled'
        : status === 'postponed'
          ? 'https://schema.org/EventPostponed'
          : 'https://schema.org/EventScheduled',
    eventAttendanceMode: isOnline
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : 'https://schema.org/OfflineEventAttendanceMode',
    location: isOnline
      ? { '@type': 'VirtualLocation', url }
      : {
          '@type': 'Place',
          name: venue || city,
          address: {
            '@type': 'PostalAddress',
            ...(str(event?.address) ? { streetAddress: str(event.address) } : {}),
            ...(city ? { addressLocality: city } : {}),
            ...(str(event?.commune) && str(event.commune) !== city
              ? { addressRegion: str(event.commune) }
              : {}),
            // ISO 3166-1 alpha-2, which is what the app stores.
            addressCountry: country,
          },
        },
    ...(image ? { image: [image] } : {}),
    ...(offers ? { offers } : {}),
    organizer: {
      '@type': 'Organization',
      name: organizerName,
      ...(event?.organizer_id
        ? { url: `${siteUrl.replace(/\/$/, '')}/profile/organizer/${event.organizer_id}` }
        : {}),
    },
    url,
  }
}

/**
 * The JSON for an inline <script type="application/ld+json">. `<` is escaped
 * so organizer-written text containing "</script>" cannot close the tag.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
