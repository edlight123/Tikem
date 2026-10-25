/**
 * Apply filters to event list
 */

import { EventFilters } from './types'
import { getDateRange, getPriceRange, parsePriceRange } from './utils'
import { normalizeEventCategory, getCityMatchGroup } from './config'
import { isBudgetFriendlyTicketPrice, isOverBudgetTicketPrice } from '@/lib/pricing'

// Use the actual database event type structure
type Event = any // Will match Database['public']['Tables']['events']['Row']

/**
 * Is this an online event? `is_online` is authoritative when it is set (both
 * composers write it). Events saved before the flag existed fall back to the
 * old guess from the venue name / commune.
 */
export function isOnlineEvent(event: any): boolean {
  if (typeof event?.is_online === 'boolean') return event.is_online
  if (event?.event_type === 'online') return true
  const venue = String(event?.venue_name || '').toLowerCase()
  return venue.includes('online') || venue.includes('virtual') || String(event?.commune || '').toLowerCase() === 'virtual'
}

/**
 * Filter events based on filter criteria
 */
export function filterEvents(events: Event[], filters: EventFilters): Event[] {
  let filtered = [...events]
  
  // Debug: Log all events being filtered
  if (process.env.NODE_ENV === 'development') {
    console.log('=== FILTER DEBUG ===')
    console.log('Total events to filter:', events.length)
    console.log('Filter settings:', filters)
    if (events.length > 0) {
      console.log('Sample event dates:', events.slice(0, 5).map(e => ({
        title: e.title,
        start_datetime: e.start_datetime
      })))
    }
  }
  
  // Date filter
  if (filters.date !== 'any') {
    const { start, end } = getDateRange(filters.date, filters.pickedDate)
    if (start || end) {
      filtered = filtered.filter(event => {
        const eventDate = new Date(event.start_datetime)
        
        // For single day filters (like pick-date), compare just the date parts
        if (start && end && filters.date === 'pick-date') {
          // Normalize both dates to YYYY-MM-DD strings for comparison to avoid timezone issues
          const eventDateStr = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`
          const filterDateStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
          
          // Debug logging
          if (process.env.NODE_ENV === 'development') {
            console.log('Date Filter Debug:', {
              eventTitle: event.title,
              eventStartDateTime: event.start_datetime,
              eventDateStr,
              filterDateStr,
              pickedDate: filters.pickedDate,
              match: eventDateStr === filterDateStr
            })
          }
          
          return eventDateStr === filterDateStr
        }
        
        // For other filters, use time-based comparison
        const eventTime = eventDate.getTime()
        if (start && eventTime < start.getTime()) return false
        if (end && eventTime > end.getTime()) return false
        return true
      })
    }
  }
  
  // City filter — metro-inclusive: a top-level city also matches its
  // subdivisions (e.g. Port-au-Prince includes Pétion-Ville, Delmas). Match on
  // either the event's city or its commune, since events store the neighborhood
  // in either field.
  if (filters.city) {
    const group = new Set(getCityMatchGroup(filters.city).map(s => s.toLowerCase()))
    filtered = filtered.filter(event =>
      group.has(String(event.city || '').toLowerCase()) ||
      group.has(String(event.commune || '').toLowerCase())
    )
  }
  
  // Commune filter
  if (filters.commune) {
    filtered = filtered.filter(event => event.commune === filters.commune)
  }
  
  // Category filter
  if (filters.categories.length > 0) {
    // Normalize both sides so legacy / mixed-case event categories still match
    // the canonical filter chips.
    const selected = new Set(filters.categories.map((c) => normalizeEventCategory(c)))
    filtered = filtered.filter((event) => selected.has(normalizeEventCategory(event.category)))
  }
  
  // Price filter
  //
  // Every branch below reads `ticket_price`, which is the LOWEST tier price and
  // is 0 whenever a free tier sits alongside paid ones (see lib/ticketPricing.ts).
  // So the price filter has always been a "cheapest way in" test, and the slider
  // keeps that meaning: a mixed free/paid event answers as 0 here, exactly as it
  // does for the legacy chips.
  if (filters.price !== 'any') {
    const customRange = parsePriceRange(filters.price)
    if (customRange) {
      // Custom slider range, inclusive of both ends. `max === undefined` is the
      // top thumb parked on the ceiling — "and up", so no upper bound.
      const { min, max } = customRange
      filtered = filtered.filter((event) => {
        const price = Number(event?.ticket_price) || 0
        if (price < min) return false
        if (max !== undefined && price > max) return false
        return true
      })
    } else if (filters.price === '<=500') {
      filtered = filtered.filter((event) => isBudgetFriendlyTicketPrice(event?.ticket_price, event?.currency))
    } else if (filters.price === '>500') {
      filtered = filtered.filter((event) => isOverBudgetTicketPrice(event?.ticket_price, event?.currency))
    } else {
      const { min, max } = getPriceRange(filters.price)
      filtered = filtered.filter(event => {
        const price = event.ticket_price || 0
        if (min !== undefined && price < min) return false
        if (max !== undefined && price > max) return false
        return true
      })
    }
  }
  
  // Event type filter: the composers (web + mobile) save `is_online`.
  if (filters.eventType !== 'all') {
    filtered = filtered.filter(event => {
      const online = isOnlineEvent(event)
      if (filters.eventType === 'online') return online
      if (filters.eventType === 'in-person') return !online
      return true
    })
  }
  
  return filtered
}

/**
 * Sort events based on sort option
 */
export function sortEvents(events: Event[], sortBy: EventFilters['sortBy']): Event[] {
  const sorted = [...events]
  
  if (sortBy === 'date') {
    // Sort by date ascending (soonest first)
    sorted.sort((a, b) => 
      new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
    )
  } else if (sortBy === 'relevance') {
    // Relevance: featured first, then soonest date, then newest created
    sorted.sort((a, b) => {
      // Featured events first — the admin Feature star writes `featured`;
      // `is_featured` is the legacy test-data field.
      const aFeatured = a.featured || a.is_featured ? 1 : 0
      const bFeatured = b.featured || b.is_featured ? 1 : 0
      if (aFeatured !== bFeatured) return bFeatured - aFeatured
      
      // Then by soonest event date
      const dateCompare = new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
      if (dateCompare !== 0) return dateCompare
      
      // Finally by newest created
      if (a.created_at && b.created_at) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
      
      return 0
    })
  }
  
  return sorted
}

/**
 * Apply filters and sort to events
 */
export function applyFiltersAndSort(events: Event[], filters: EventFilters): Event[] {
  const filtered = filterEvents(events, filters)
  return sortEvents(filtered, filters.sortBy)
}
