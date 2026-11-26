/**
 * Utility functions for event filters
 */

import { EventFilters, DEFAULT_FILTERS, DateFilter, PriceFilter } from './types'
import { PRICE_FILTERS } from './config'
import { amenityKeysOf, wantedAmenities } from '@/lib/events/venue-details'
import { parseLanguageParam } from '@/lib/event-languages'

/** The legacy discrete price values, which URLs in the wild still carry. */
const LEGACY_PRICE_VALUES = ['any', 'free', '<=500', '>500'] as const

/** `range:MIN-MAX` / `range:MIN-max` — see PriceRangeFilter in ./types. */
const PRICE_RANGE_PATTERN = /^range:(\d+(?:\.\d+)?)-(max|\d+(?:\.\d+)?)$/

/**
 * Parse a custom price range. Returns `null` for the legacy values and for
 * anything malformed, so callers can fall through to the old behaviour.
 * A `max` of `undefined` means the range is open at the top ("and up").
 */
export function parsePriceRange(
  priceFilter: string | null | undefined
): { min: number; max?: number } | null {
  const match = PRICE_RANGE_PATTERN.exec(String(priceFilter ?? ''))
  if (!match) return null

  const min = Number(match[1])
  if (!Number.isFinite(min)) return null
  if (match[2] === 'max') return { min }

  const max = Number(match[2])
  if (!Number.isFinite(max)) return null
  // A reversed range in a hand-edited URL reads as the range the user meant.
  return max < min ? { min: max, max: min } : { min, max }
}

/**
 * Build the filter value for a pair of slider thumbs. A range that constrains
 * nothing (bottom on the floor, top parked on the ceiling) collapses to 'any'
 * so it never counts as an active filter or lands in the URL.
 */
export function buildPriceRangeFilter(min: number, max: number, ceiling: number): PriceFilter {
  const lo = Math.max(0, Math.min(min, max))
  const hi = Math.max(min, max)
  const openTop = hi >= ceiling

  if (lo <= 0 && openTop) return 'any'
  // Cast: TS widens a number in a template expression to `string`.
  if (openTop) return `range:${lo}-max` as PriceFilter
  return `range:${lo}-${hi}` as PriceFilter
}

/**
 * Coerce an arbitrary `?price=` value to something meaningful. Legacy values
 * pass through untouched; ranges are re-emitted in canonical form; junk becomes
 * the default.
 */
export function normalizePriceFilter(raw: string | null | undefined): PriceFilter {
  const value = String(raw ?? '')
  if ((LEGACY_PRICE_VALUES as readonly string[]).includes(value)) return value as PriceFilter

  const range = parsePriceRange(value)
  if (!range) return DEFAULT_FILTERS.price
  if (range.max === undefined) return buildPriceRangeFilter(range.min, Infinity, Infinity)
  return buildPriceRangeFilter(range.min, range.max, Infinity)
}

/**
 * Is this price value equivalent to "no price filter"? True for 'any' and for a
 * range that constrains nothing (a hand-written `?price=range:0-max`).
 */
export function isDefaultPriceFilter(price: string): boolean {
  if (price === DEFAULT_FILTERS.price) return true
  const range = parsePriceRange(price)
  return range !== null && range.min <= 0 && range.max === undefined
}

/**
 * Calculate date range for a date filter option
 */
export function getDateRange(filter: DateFilter, pickedDate?: string): { start?: Date; end?: Date } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  
  switch (filter) {
    case 'any':
      return {}
    
    case 'today':
      const endOfToday = new Date(today)
      endOfToday.setHours(23, 59, 59, 999)
      return { start: today, end: endOfToday }
    
    case 'tomorrow':
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)
      const endOfTomorrow = new Date(tomorrow)
      endOfTomorrow.setHours(23, 59, 59, 999)
      return { start: tomorrow, end: endOfTomorrow }
    
    case 'this-week':
      const weekEnd = new Date(today)
      weekEnd.setDate(today.getDate() + 7)
      // End at start of day 7 days from today (prevents returning an 8-day span)
      weekEnd.setHours(0, 0, 0, 0)
      return { start: today, end: weekEnd }
    
    case 'this-weekend':
      // Find next Saturday and Sunday
      const dayOfWeek = now.getDay()
      const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7 // If today is Saturday, get next Saturday
      const saturday = new Date(today)
      saturday.setDate(today.getDate() + daysUntilSaturday)
      
      const sunday = new Date(saturday)
      sunday.setDate(saturday.getDate() + 1)
      // End at start of Sunday to match tests (calendar-day boundary)
      sunday.setHours(0, 0, 0, 0)
      
      return { start: saturday, end: sunday }
    
    case 'pick-date':
      if (!pickedDate) return {}
      // Parse the date string (YYYY-MM-DD format from input[type="date"])
      // Create date at midnight and end of day in local timezone
      const [year, month, day] = pickedDate.split('-').map(Number)
      const picked = new Date(year, month - 1, day, 0, 0, 0, 0)
      const endOfPicked = new Date(year, month - 1, day, 23, 59, 59, 999)
      return { start: picked, end: endOfPicked }
    
    default:
      return {}
  }
}

/**
 * Get price range for a price filter
 */
export function getPriceRange(priceFilter: string): { min?: number; max?: number } {
  if (priceFilter === 'any') {
    return {}
  }

  if (priceFilter === 'free') {
    return { min: 0, max: 0 }
  }

  // Custom slider range. An open top ("and up") returns no `max` at all, so the
  // ceiling never excludes the expensive events above it.
  const custom = parsePriceRange(priceFilter)
  if (custom) {
    return custom.max === undefined ? { min: custom.min } : { min: custom.min, max: custom.max }
  }

  const config = PRICE_FILTERS.find(p => p.value === priceFilter)
  
  if (!config) {
    return {}
  }
  
  // Type guard to check if config has min/max properties
  if ('min' in config && 'max' in config) {
    return {
      min: config.min,
      max: config.max === Infinity ? undefined : config.max
    }
  }
  
  return {}
}

/**
 * Count active filters (excluding defaults)
 */
export function countActiveFilters(filters: EventFilters): number {
  let count = 0
  
  // Date filter
  if (filters.date !== DEFAULT_FILTERS.date) count++
  
  // Location filters
  if (filters.city) count++
  if (filters.commune) count++
  
  // Categories
  if (filters.categories.length > 0) count++
  
  // Price — a custom range counts as one filter unless it constrains nothing
  if (!isDefaultPriceFilter(filters.price)) count++
  
  // Event type
  if (filters.eventType !== DEFAULT_FILTERS.eventType) count++

  // One per chosen venue fact (and the older Step-free switch).
  count += wantedAmenities(filters).length

  // The event's language.
  if (parseLanguageParam(filters.language)) count++
  
  return count
}

/**
 * Check if filters have changed from defaults
 */
export function hasActiveFilters(filters: EventFilters): boolean {
  return countActiveFilters(filters) > 0
}

/**
 * Serialize filters to URL query string
 */
export function serializeFilters(filters: EventFilters): URLSearchParams {
  const params = new URLSearchParams()
  
  // Date
  if (filters.date !== 'any') {
    params.set('date', filters.date)
    if (filters.date === 'pick-date' && filters.pickedDate) {
      params.set('pickedDate', filters.pickedDate)
    }
  }
  
  // Location
  if (filters.city) {
    params.set('city', filters.city)
    if (filters.commune) {
      params.set('commune', filters.commune)
    }
  }
  
  // Categories
  if (filters.categories.length > 0) {
    filters.categories.forEach(cat => params.append('category', cat))
  }
  
  // Price — legacy values and `range:MIN-MAX` alike travel as one param
  if (!isDefaultPriceFilter(filters.price)) {
    params.set('price', filters.price)
  }
  
  // Event type
  if (filters.eventType !== 'all') {
    params.set('eventType', filters.eventType)
  }

  // Venue facts, the older Step-free switch folded in.
  const amenities = wantedAmenities(filters)
  if (amenities.length) params.set('amenities', amenities.join(','))

  // The language it is held in.
  const language = parseLanguageParam(filters.language)
  if (language) params.set('language', language)
  
  // Sort
  if (filters.sortBy !== 'relevance') {
    params.set('sort', filters.sortBy)
  }
  
  return params
}

/**
 * Parse filters from URL query string
 */
type SearchParamsLike = {
  get(name: string): string | null
  getAll(name: string): string[]
}

export function parseFiltersFromURL(searchParams?: SearchParamsLike | null): EventFilters {
  const params = searchParams ?? new URLSearchParams()

  return {
    date: (params.get('date') as DateFilter) || DEFAULT_FILTERS.date,
    pickedDate: params.get('pickedDate') || undefined,
    city: params.get('city') || '',
    commune: params.get('commune') || undefined,
    categories: params.getAll('category'),
    price: normalizePriceFilter(params.get('price')),
    eventType: params.get('eventType') || DEFAULT_FILTERS.eventType,
    // `?stepFree=1` (older links) reads as the step_free venue fact.
    ...(() => {
      const amenities = amenityKeysOf([
        ...amenityKeysOf(params.get('amenities') || ''),
        ...(params.get('stepFree') === '1' ? ['step_free'] : []),
      ])
      return amenities.length ? { amenities } : {}
    })(),
    ...(parseLanguageParam(params.get('language')) ? { language: parseLanguageParam(params.get('language')) } : {}),
    sortBy: params.get('sort') || DEFAULT_FILTERS.sortBy,
  } as EventFilters
}

/**
 * Check if two filter sets are equal
 */
export function filtersEqual(a: EventFilters, b: EventFilters): boolean {
  return (
    a.date === b.date &&
    a.pickedDate === b.pickedDate &&
    a.city === b.city &&
    a.commune === b.commune &&
    a.categories.join(',') === b.categories.join(',') &&
    a.price === b.price &&
    a.eventType === b.eventType &&
    wantedAmenities(a).join(',') === wantedAmenities(b).join(',') &&
    parseLanguageParam(a.language) === parseLanguageParam(b.language) &&
    a.sortBy === b.sortBy
  )
}

/**
 * Reset filters to defaults
 */
export function resetFilters(): EventFilters {
  return { ...DEFAULT_FILTERS }
}
