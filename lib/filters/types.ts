/**
 * Filter types for event listing
 */

export type DateFilter = 
  | 'any' 
  | 'today' 
  | 'tomorrow' 
  | 'this-week' 
  | 'this-weekend' 
  | 'pick-date'

/**
 * A custom price range drawn by the modal's dual-thumb slider, in the country's
 * own currency (see `getPriceSliderConfig` in ./config).
 *
 *   range:0-2500     0 → 2,500 inclusive
 *   range:2500-max   2,500 "and up" — the top thumb is parked at the slider's
 *                    ceiling, so NO upper bound is imposed on the events. The
 *                    literal `max` keeps the ceiling out of the URL, so a shared
 *                    link means the same thing to a reader whose country (and
 *                    therefore ceiling) differs.
 */
export type PriceRangeFilter =
  | `range:${number}-${number}`
  | `range:${number}-max`

/**
 * The four legacy values are kept verbatim so shared/bookmarked URLs
 * (?price=free, ?price=<=500, ?price=>500) keep resolving exactly as they did.
 * Their names are historical — '<=500' / '>500' really mean "at or below" and
 * "above" the CURRENT country's budgetThreshold, resolved per event currency by
 * lib/pricing.ts, not literally 500.
 */
export type PriceFilter =
  | 'any'
  | 'free'
  | '<=500'
  | '>500'
  | PriceRangeFilter

export type EventTypeFilter = 'all' | 'in-person' | 'online'

export type SortOption = 'relevance' | 'date'

export interface EventFilters {
  // Date
  date: DateFilter
  pickedDate?: string // ISO date string when date === 'pick-date'
  
  // Location
  city: string
  commune?: string // Populated based on city selection
  
  // Category (support multi-select in future)
  categories: string[]
  
  // Price
  price: PriceFilter
  
  // Event type
  eventType: EventTypeFilter

  /**
   * Older Step-free switch (`?stepFree=1`). Still honoured so shared links
   * and saved state keep working; the modal now writes `amenities`.
   */
  stepFree?: boolean

  /**
   * Venue facts the event must have, ALL of them (lib/events/venue-details
   * keys: facilities and accessibility). `?amenities=parking,step_free`.
   */
  amenities?: string[]

  /**
   * The language the event is held in (lib/event-languages code), one at a
   * time; absent = any language. `?language=ht`.
   */
  language?: string
  
  // Sort
  sortBy: SortOption
}

export const DEFAULT_FILTERS: EventFilters = {
  date: 'any',
  city: '',
  categories: [],
  price: 'any',
  eventType: 'all',
  sortBy: 'relevance'
}

export interface FilterState {
  // Draft filters (in-progress edits in panel)
  draft: EventFilters
  
  // Applied filters (what's actually filtering the list)
  applied: EventFilters
  
  // UI state
  isOpen: boolean
}
