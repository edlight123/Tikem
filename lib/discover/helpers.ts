/**
 * Helper utilities for the Discover page
 */

import { addDays, format, isSameDay, isSameWeek, parseISO } from 'date-fns'
import { wallClock } from '@/lib/home/format'
import type { Database } from '@/types/database'
import { isBudgetFriendlyTicketPrice } from '@/lib/pricing'
import { resolveEventPricing, type EventPricingLike } from '@/lib/ticketPricing'
import { priceOrder } from '@/lib/checkout/buyer-pricing'
import { dateLocaleFor } from '@/lib/dateLocale'

type Event = Database['public']['Tables']['events']['Row']

/**
 * Format event date/time for display
 */
/**
 * Coerce any stored event date shape — ISO string, Firestore Timestamp
 * ({toDate}), plain {seconds}, or Date — to a Date, or null when invalid.
 * The field-type drift is documented: legacy docs carry Timestamps where
 * newer ones carry ISO strings, and type-sensitive comparisons silently
 * drop one shape or the other. Route every date read through this.
 */
export function coerceEventDate(v: any): Date | null {
  if (!v) return null
  let d: Date
  if (typeof v?.toDate === 'function') d = v.toDate()
  else if (typeof v?.seconds === 'number') d = new Date(v.seconds * 1000)
  else if (v instanceof Date) d = v
  else d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * A translator compatible with react-i18next's `t` — passed in by client
 * components so these pure helpers can speak the reader's language without
 * this module importing i18n (it is used from server components too).
 * Omitting it keeps the original English output.
 */
export type Translate = (key: string, opts?: Record<string, any>) => string

/**
 * "Today at 8:00 PM" / "Friday at 8:00 PM" / "Oct 10 at 8:00 PM".
 *
 * Pass `zone` (lib/home/feed eventZone) to read the time, and "today", in the
 * event's zone: that is what the event page prints, and it renders the same
 * on the server and in the browser. Without it the runtime's zone is used.
 */
export function formatEventDate(datetime: string, t?: Translate, lng?: string, zone?: string): string {
  const date = zone ? wallClock(datetime, zone) : parseISO(datetime)
  const now = zone ? wallClock(Date.now(), zone) : new Date()
  const locale = dateLocaleFor(lng)
  const time = format(date, 'h:mm a', { locale })
  const isToday = (d: Date) => isSameDay(d, now)
  const isTomorrow = (d: Date) => isSameDay(d, addDays(now, 1))
  const isThisWeek = (d: Date) => isSameWeek(d, now)

  if (isToday(date)) {
    return t ? t('events.card_today_at', { time, defaultValue: `Today at ${time}` }) : `Today at ${time}`
  }

  if (isTomorrow(date)) {
    return t
      ? t('events.card_tomorrow_at', { time, defaultValue: `Tomorrow at ${time}` })
      : `Tomorrow at ${time}`
  }

  if (isThisWeek(date)) {
    const day = format(date, 'EEEE', { locale })
    return t ? t('events.card_day_at', { day, time, defaultValue: `${day} at ${time}` }) : `${day} at ${time}`
  }

  const day = format(date, 'MMM d', { locale })
  return t ? t('events.card_date_at', { day, time, defaultValue: `${day} at ${time}` }) : `${day} at ${time}`
}

/**
 * Get price label from a bare price.
 *
 * ⚠️ Prefer `getCardPriceDisplay` / `getEventPriceLabel` when you have the whole
 * event: a lone price CANNOT tell free from mixed, because `ticket_price` is the
 * LOWEST tier price and is therefore 0 for an event that offers a free tier next
 * to paid ones — this function would call that event "Free".
 */
export function getPriceLabel(price: number, currency?: string): string {
  const curr = currency || 'HTG'
  if (!price || price === 0) return 'Free'
  const formattedPrice = price.toLocaleString()
  if (price <= 500) return `From ${formattedPrice} ${curr}`
  return `From ${formattedPrice} ${curr}`
}

/**
 * How a card should present an event's price, decided from the TIER SET rather
 * than the denormalized `ticket_price`. See lib/ticketPricing.ts.
 *
 *  - `free`    every way in is free → "Free"
 *  - `from`    everything costs money → "From X"
 *  - `range`   free AND paid tiers, and we know the cheapest paid one → "Free – X"
 *  - `unknown` at least one tier costs money, but this projection doesn't carry the
 *              tier set so the cheapest PAID price is unknowable. Render a
 *              price-free label. Never fall back to `ticket_price` here: it is 0
 *              for exactly this case, which is how a paid event came to advertise
 *              itself as free.
 */
export type CardPriceDisplay =
  | { kind: 'free' }
  | { kind: 'from'; price: number }
  | { kind: 'range'; price: number }
  | { kind: 'unknown' }

export function getCardPriceDisplay(event: EventPricingLike | null | undefined): CardPriceDisplay {
  const pricing = resolveEventPricing(event)
  if (pricing.isFreeOnly) return { kind: 'free' }

  // `lowestPaidPrice` is only known when the tier set travelled with the event.
  // Otherwise fall back to `ticket_price` ONLY when it is positive — a positive
  // lowest-tier price means every tier costs at least that much.
  const legacyPrice = Number(event?.ticket_price ?? 0)
  const price = pricing.lowestPaidPrice ?? (legacyPrice > 0 ? legacyPrice : null)
  if (price == null) return { kind: 'unknown' }

  // A card ADVERTISES a price, so in fee-on-top markets (US/CA/FR) it must show
  // what the buyer will actually pay — quoting the face value here and revealing
  // the fee at checkout is precisely the drip-pricing the US total-price rule for
  // live-event tickets forbids. In Haiti the fee comes out of the organizer's
  // share, so `total` equals the face value and this is a no-op.
  // The fee is priced per order, and the smallest order is one ticket.
  const advertised = priceOrder(price, event).total

  return pricing.hasFreeTier
    ? { kind: 'range', price: advertised }
    : { kind: 'from', price: advertised }
}

/**
 * An advertised amount: whole numbers stay whole ("2,500"), anything with
 * cents shows both digits ("49.50", never "49.5" — the fee gross-up makes
 * odd cents common). Pinned to en-US so the server render and the hydrating
 * client agree whatever the reader's browser locale.
 */
function formatCardAmount(n: number): string {
  const cents = Math.round(n * 100) % 100 !== 0
  return n.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: 2,
  })
}

/**
 * Price label for an event, honest about mixed free/paid tier sets. Pass a
 * translator (client components) to render it in the reader's language;
 * without one it stays English.
 */
export function getEventPriceLabel(
  event: (EventPricingLike & { currency?: string | null }) | null | undefined,
  t?: Translate
): string {
  const curr = event?.currency || 'HTG'
  const display = getCardPriceDisplay(event)
  switch (display.kind) {
    case 'free':
      return t ? t('common.free_label', { defaultValue: 'Free' }) : 'Free'
    case 'from': {
      const price = `${formatCardAmount(display.price)} ${curr}`
      return t ? t('events.card_price_from', { price, defaultValue: `From ${price}` }) : `From ${price}`
    }
    case 'range': {
      const price = `${formatCardAmount(display.price)} ${curr}`
      return t ? t('events.card_price_range', { price, defaultValue: `Free – ${price}` }) : `Free – ${price}`
    }
    default:
      return t ? t('events.card_see_tickets', { defaultValue: 'See tickets' }) : 'See tickets'
  }
}

/**
 * Get location summary (City • Subarea)
 */
export function getLocationSummary(city: string, commune?: string): string {
  if (commune && commune !== city) {
    return `${city} • ${commune}`
  }
  return city
}

/**
 * Check if event is online based on venue name
 */
export function isOnlineEvent(venueName: string): boolean {
  const onlineKeywords = ['online', 'virtual', 'zoom', 'livestream', 'webinar', 'remote']
  return onlineKeywords.some(keyword => 
    venueName.toLowerCase().includes(keyword)
  )
}

/**
 * Get event cue/badge (Popular, Few tickets left, etc.)
 */
export function getEventCue(
  event: Event,
  t?: Translate
): { label: string; variant: 'popular' | 'warning' | 'verified' } | null {
  // Popular: More than 50% tickets sold and at least 20 tickets
  if (event.tickets_sold && event.total_tickets) {
    const soldPercentage = (event.tickets_sold / event.total_tickets) * 100

    if (soldPercentage >= 90) {
      return {
        label: t ? t('events.cue_few_left', { defaultValue: 'Few tickets left' }) : 'Few tickets left',
        variant: 'warning',
      }
    }

    if (event.tickets_sold >= 20 && soldPercentage >= 50) {
      return {
        label: t ? t('events.cue_popular', { defaultValue: 'Popular' }) : 'Popular',
        variant: 'popular',
      }
    }
  }
  
  // Verified organizer (if users relation is included)
  // Note: This would require the event to have users relation loaded
  // For now, we'll skip this and let the component handle it
  
  return null
}

/**
 * Bookmark storage utilities (localStorage)
 */
const BOOKMARKS_KEY = 'tikem_bookmarks'

export function getBookmarkedEvents(): string[] {
  if (typeof window === 'undefined') return []
  
  try {
    const stored = localStorage.getItem(BOOKMARKS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

export function isEventBookmarked(eventId: string): boolean {
  return getBookmarkedEvents().includes(eventId)
}

export function toggleBookmark(eventId: string): boolean {
  const bookmarks = getBookmarkedEvents()
  const isBookmarked = bookmarks.includes(eventId)
  
  let updated: string[]
  if (isBookmarked) {
    updated = bookmarks.filter(id => id !== eventId)
  } else {
    updated = [...bookmarks, eventId]
  }
  
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(updated))
    return !isBookmarked
  } catch {
    return isBookmarked
  }
}

/**
 * Filter events by criteria
 */
export function filterEventsByPrice(events: Event[], maxPrice: number): Event[] {
  // Legacy API: used for the "Free & Budget Friendly" section.
  // Keep the callsite signature but interpret 500 as the "cheap" threshold:
  // HTG <= 500 OR USD <= 5 (and always include free).
  if (maxPrice === 500) {
    return events.filter((e: any) => isBudgetFriendlyTicketPrice(e?.ticket_price, e?.currency))
  }

  return events.filter(e => e.ticket_price <= maxPrice)
}

export function filterFreeEvents(events: Event[]): Event[] {
  return events.filter(e => e.ticket_price === 0)
}

export function filterOnlineEvents(events: Event[]): Event[] {
  return events.filter(e => isOnlineEvent(e.venue_name))
}

export function filterEventsByCountry(events: Event[], country: string): Event[] {
  return events.filter(e => e.country === country)
}

export function filterEventsByLocation(events: Event[], city: string, commune?: string): Event[] {
  let filtered = events.filter(e => e.city === city)
  if (commune) {
    filtered = filtered.filter(e => e.commune === commune)
  }
  return filtered
}

/**
 * Get upcoming events (happening soon)
 */
export function getUpcomingEvents(events: Event[], limit: number = 8): Event[] {
  const now = new Date()
  return events
    // Exclude events the organizer opted out of Explore/discovery.
    // Only `show_on_explore === false` hides an event; missing/undefined stays visible.
    .filter(e => (e as any).show_on_explore !== false)
    .filter(e => new Date(e.start_datetime) > now)
    .sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime())
    .slice(0, limit)
}

/**
 * Get featured events (most popular/highest tickets sold)
 */
export function getFeaturedEvents(events: Event[], limit: number = 6): Event[] {
  // Human curation leads (the admin Feature star writes `featured`; legacy
  // test data wrote `is_featured`), ticket sales fill the rest.
  const isPick = (e: Event) => ((e as any).featured === true || (e as any).is_featured === true ? 1 : 0)
  return events
    // Exclude events the organizer opted out of Explore/discovery.
    // Only `show_on_explore === false` hides an event; missing/undefined stays visible.
    .filter(e => (e as any).show_on_explore !== false)
    .filter(e => isPick(e) || (e.tickets_sold || 0) > 0)
    .sort((a, b) => isPick(b) - isPick(a) || (b.tickets_sold || 0) - (a.tickets_sold || 0))
    .slice(0, limit)
}

/**
 * Sort events with default Discover rules:
 * 1. Featured events (high ticket sales) first
 * 2. Then by soonest event date
 * 3. Then by newest created_at
 */
export function sortEventsDefault(events: Event[]): Event[] {
  return events.sort((a, b) => {
    // Featured first (>20 tickets sold or >50% sold)
    const aFeatured = (a.tickets_sold || 0) >= 20 || 
                      ((a.tickets_sold || 0) / a.total_tickets) >= 0.5
    const bFeatured = (b.tickets_sold || 0) >= 20 || 
                      ((b.tickets_sold || 0) / b.total_tickets) >= 0.5
    
    if (aFeatured && !bFeatured) return -1
    if (!aFeatured && bFeatured) return 1
    
    // Then by soonest event date
    const dateA = new Date(a.start_datetime).getTime()
    const dateB = new Date(b.start_datetime).getTime()
    if (dateA !== dateB) return dateA - dateB
    
    // Then by newest created
    const createdA = new Date(a.created_at).getTime()
    const createdB = new Date(b.created_at).getTime()
    return createdB - createdA
  })
}

/**
 * Sort events strictly by date ascending
 */
export function sortEventsByDate(events: Event[]): Event[] {
  return events.sort((a, b) => 
    new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
  )
}
