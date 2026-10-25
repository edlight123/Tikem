/**
 * Utility functions for filtering events based on EventFilters
 */

import { EventFilters, PriceFilter } from '../types/filters';
import { isBudgetFriendlyTicketPrice, isOverBudgetTicketPrice } from '../lib/pricing';
import { findMetro, isEventInMetro, normalizePlace } from '../data/metros';
import { 
  isToday, 
  isTomorrow, 
  isWithinInterval, 
  startOfWeek, 
  endOfWeek,
  addWeeks,
  parseISO
} from 'date-fns';

/**
 * Get date range for a date filter option
 */
export function getDateRange(filter: EventFilters['date'], pickedDate?: string): { start?: Date; end?: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  switch (filter) {
    case 'any':
      return {};
    
    case 'today':
      const endOfToday = new Date(today);
      endOfToday.setHours(23, 59, 59, 999);
      return { start: today, end: endOfToday };
    
    case 'tomorrow':
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const endOfTomorrow = new Date(tomorrow);
      endOfTomorrow.setHours(23, 59, 59, 999);
      return { start: tomorrow, end: endOfTomorrow };
    
    case 'this-week':
      const weekEnd = new Date(today);
      weekEnd.setDate(today.getDate() + 7);
      // End at start of day 7 days from today (prevents returning an 8-day span)
      weekEnd.setHours(0, 0, 0, 0);
      return { start: today, end: weekEnd };
    
    case 'this-weekend':
      // Find next Saturday and Sunday
      const dayOfWeek = now.getDay();
      const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;
      const saturday = new Date(today);
      saturday.setDate(today.getDate() + daysUntilSaturday);
      
      const sunday = new Date(saturday);
      sunday.setDate(saturday.getDate() + 1);
      // End at start of Sunday to match tests (calendar-day boundary)
      sunday.setHours(0, 0, 0, 0);
      
      return { start: saturday, end: sunday };
    
    case 'pick-date':
      if (!pickedDate) return {};
      const picked = parseISO(pickedDate);
      const endOfPicked = new Date(picked);
      endOfPicked.setHours(23, 59, 59, 999);
      return { start: picked, end: endOfPicked };
    
    default:
      return {};
  }
}

/**
 * Get price range for a price filter
 */
export function getPriceRange(priceFilter: PriceFilter, customRange?: { min: number; max: number }): { min?: number; max?: number } {
  switch (priceFilter) {
    case 'any':
      return {};
    case 'free':
      return { min: 0, max: 0 };
    case '<=500':
      return { min: 0, max: 500 };
    case '>500':
      return { min: 500, max: undefined };
    case 'custom':
      return customRange || {};
    default:
      return {};
  }
}

/**
 * Apply all filters to an array of events
 */
export function applyFilters(events: any[], filters: EventFilters): any[] {
  let filtered = events;

  // Country filter
  if (filters.country) {
    filtered = filtered.filter(event => (event.country || 'HT') === filters.country)
  }

  // Date filter
  if (filters.date !== 'any') {
    const { start, end } = getDateRange(filters.date, filters.pickedDate);
    if (start && end) {
      filtered = filtered.filter(event => {
        const eventDate = event.start_datetime;
        return eventDate >= start && eventDate <= end;
      });
    }
  }

  // Location: the chosen town scopes browsing to its METRO, not to an exact
  // string. Someone in Port-au-Prince sees Pétion-Ville; someone in Miami sees
  // Fort Lauderdale — and neither sees the other. A town we have no metro for
  // falls back to matching the town itself (never wider).
  if (filters.city) {
    const metro = findMetro(filters.city, filters.country);
    filtered = metro
      ? filtered.filter(event => isEventInMetro(event, metro))
      : filtered.filter(event => normalizePlace(event.city) === normalizePlace(filters.city));
  }

  // Commune filter
  if (filters.commune) {
    filtered = filtered.filter(event => 
      event.commune === filters.commune
    );
  }

  // Categories filter
  if (filters.categories.length > 0) {
    filtered = filtered.filter(event => 
      filters.categories.includes(event.category)
    );
  }

  // Price filter
  if (filters.price !== 'any') {
    if (filters.price === '<=500') {
      filtered = filtered.filter((event) =>
        isBudgetFriendlyTicketPrice(event?.ticket_price, event?.currency)
      );
    } else if (filters.price === '>500') {
      filtered = filtered.filter((event) =>
        isOverBudgetTicketPrice(event?.ticket_price, event?.currency)
      );
    } else {
      const { min, max } = getPriceRange(filters.price, filters.customPriceRange);
      filtered = filtered.filter(event => {
        const price = event.ticket_price || 0;
        if (min !== undefined && price < min) return false;
        if (max !== undefined && price > max) return false;
        return true;
      });
    }
  }

  // Event type filter
  // `is_online` (saved by both composers) is authoritative; legacy events
  // without it fall back to the old venue-name guess. Mirrors the web's
  // isOnlineEvent (lib/filters/apply.ts).
  if (filters.eventType !== 'all') {
    if (filters.eventType === 'online') {
      filtered = filtered.filter(event => isOnlineEvent(event));
    } else if (filters.eventType === 'in-person') {
      filtered = filtered.filter(event => !isOnlineEvent(event));
    }
  }

  // Sort
  if (filters.sortBy === 'date') {
    filtered.sort((a, b) => 
      a.start_datetime.getTime() - b.start_datetime.getTime()
    );
  } else {
    // Relevance: sort by tickets sold (popularity)
    filtered.sort((a, b) => 
      (b.tickets_sold || 0) - (a.tickets_sold || 0)
    );
  }

  return filtered;
}

/**
 * Count active filters (excluding defaults)
 */
export function countActiveFilters(filters: EventFilters): number {
  let count = 0;
  
  if (filters.date !== 'any') count++;
  // City is the browse location, not a filter — see FiltersContext.
  if (filters.categories.length > 0) count++;
  if (filters.price !== 'any') count++;
  if (filters.eventType !== 'all') count++;
  
  return count;
}

/** Is this an online event? See the filter above. */
export function isOnlineEvent(event: any): boolean {
  if (typeof event?.is_online === 'boolean') return event.is_online;
  if (event?.event_type === 'online') return true;
  const venue = String(event?.venue_name || '').toLowerCase();
  return venue.includes('online') || venue.includes('virtual') || String(event?.commune || '').toLowerCase() === 'virtual';
}
