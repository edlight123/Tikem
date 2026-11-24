/**
 * Filter types for event listing - matching web PWA
 */

export type DateFilter = 
  | 'any' 
  | 'today' 
  | 'tomorrow' 
  | 'this-week' 
  | 'this-weekend' 
  | 'pick-date'

export type PriceFilter = 
  | 'any' 
  | 'free' 
  | '<=500' 
  | '>500'
  | 'custom'

export type EventTypeFilter = 'all' | 'in-person' | 'online'

export type SortOption = 'relevance' | 'date'

export interface EventFilters {
  // Date
  date: DateFilter
  pickedDate?: string // ISO date string when date === 'pick-date'
  
  // Location
  country?: string // Country code (HT, US, CA, FR, DO)
  city: string
  commune?: string // Populated based on city selection
  
  // Category (support multi-select)
  categories: string[]
  
  // Price
  price: PriceFilter
  customPriceRange?: { min: number; max: number }
  
  // Event type
  eventType: EventTypeFilter

  /** Older Step-free switch, still honoured; the sheet now writes `amenities`. */
  stepFree?: boolean

  /** Venue facts the event must have, ALL of them (lib/venueDetails keys). */
  amenities?: string[]
  
  // Sort
  sortBy: SortOption
}

export const DEFAULT_FILTERS: EventFilters = {
  date: 'any',
  country: 'HT',
  city: '',
  categories: [],
  price: 'any',
  eventType: 'all',
  sortBy: 'relevance'
}

// All available categories
export const CATEGORIES = [
  'Music',
  'Sports',
  'Arts & Culture',
  'Business',
  'Food & Drink',
  'Education',
  'Technology',
  'Health & Wellness',
  'Party',
  'Religious',
  'Other'
]

// Countries
export const COUNTRIES = [
  { code: 'HT', name: 'Haiti' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'FR', name: 'France' },
  { code: 'DO', name: 'Dominican Republic' }
]

// Cities by country
export const CITIES_BY_COUNTRY: Record<string, string[]> = {
  'HT': [
    'Port-au-Prince',
    'Cap-Haïtien',
    'Jacmel',
    'Gonaïves',
    'Les Cayes',
    'Saint-Marc',
    'Pétion-Ville',
    'Delmas',
    'Carrefour',
    'Port-de-Paix',
    'Jérémie',
    'Fort-Liberté'
  ],
  'US': [
    'New York, NY',
    'Los Angeles, CA',
    'Miami, FL',
    'Houston, TX',
    'Chicago, IL',
    'Atlanta, GA',
    'Boston, MA',
    'Orlando, FL'
  ],
  'CA': [
    'Toronto, ON',
    'Montreal, QC',
    'Vancouver, BC',
    'Calgary, AB',
    'Ottawa, ON'
  ],
  'FR': [
    'Paris',
    'Lyon',
    'Marseille',
    'Nice',
    'Toulouse',
    'Bordeaux'
  ],
  'DO': [
    'Santo Domingo',
    'Santiago',
    'Punta Cana',
    'La Romana',
    'Puerto Plata'
  ]
}

// Backward compatibility: Haiti cities as default
export const CITIES = CITIES_BY_COUNTRY['HT']

// Get cities for a specific country
export function getCitiesForCountry(countryCode: string): string[] {
  return CITIES_BY_COUNTRY[countryCode] || CITIES_BY_COUNTRY['HT']
}

// ---------------------------------------------------------------------------
// Featured locations for quick browsing.
// Location — not category — is how people actually discover nearby events
// (someone in Pétion-Ville mostly wants events in Pétion-Ville). So we surface
// the main towns per country and prioritise the user's own country first.
// These names must match the `city` values stored on events.
// ---------------------------------------------------------------------------
export const FEATURED_CITIES_BY_COUNTRY: Record<string, string[]> = {
  'HT': [
    'Pétion-Ville',
    'Port-au-Prince',
    'Cap-Haïtien',
    'Jacmel',
    'Les Cayes',
    'Gonaïves',
  ],
  'US': [
    'Miami, FL',
    'New York, NY',
    'Boston, MA',
    'Atlanta, GA',
    'Orlando, FL',
  ],
  'CA': [
    'Montreal, QC',
    'Toronto, ON',
    'Ottawa, ON',
  ],
  'FR': [
    'Paris',
    'Lyon',
    'Marseille',
  ],
  'DO': [
    'Santo Domingo',
    'Santiago',
    'Punta Cana',
  ],
}

// Curated featured cities for a country (falls back to Haiti's main towns).
export function getFeaturedCities(countryCode: string = 'HT'): string[] {
  return FEATURED_CITIES_BY_COUNTRY[countryCode] || FEATURED_CITIES_BY_COUNTRY['HT']
}


// Currency configuration by country
export const CURRENCY_BY_COUNTRY: Record<string, { code: string; symbol: string; budgetThreshold: number }> = {
  'HT': { code: 'HTG', symbol: 'HTG', budgetThreshold: 500 },
  'US': { code: 'USD', symbol: '$', budgetThreshold: 5 },
  'CA': { code: 'CAD', symbol: 'CA$', budgetThreshold: 5 },
  'FR': { code: 'EUR', symbol: '€', budgetThreshold: 5 },
  'DO': { code: 'DOP', symbol: 'RD$', budgetThreshold: 300 }
}

// Price filter configurations
export const PRICE_FILTERS = [
  { value: 'any' as const, labelKey: 'filters.priceOptions.any' },
  { value: 'free' as const, labelKey: 'filters.priceOptions.free' },
  { value: '<=500' as const, labelKey: 'filters.priceOptions.upto500', min: 0, max: 500 },
  { value: '>500' as const, labelKey: 'filters.priceOptions.over500', min: 500, max: Infinity },
  { value: 'custom' as const, labelKey: 'filters.priceOptions.custom' }
]

// Get price filters for a specific country (with dynamic labels)
export function getPriceFiltersForCountry(countryCode: string = 'HT') {
  const currency = CURRENCY_BY_COUNTRY[countryCode] || CURRENCY_BY_COUNTRY['HT']
  const threshold = currency.budgetThreshold
  const symbol = currency.symbol
  
  const formatLabel = (prefix: string, amount: number) => {
    if (symbol === 'HTG' || symbol === 'RD$') {
      return `${prefix} ${amount} ${symbol}`
    }
    return `${prefix} ${symbol}${amount}`
  }
  
  return [
    { value: 'any' as const, label: 'Any price', labelKey: 'filters.priceOptions.any' },
    { value: 'free' as const, label: 'Free', labelKey: 'filters.priceOptions.free' },
    { value: '<=500' as const, label: formatLabel('≤', threshold), labelKey: 'filters.priceOptions.upto500', min: 0, max: threshold },
    { value: '>500' as const, label: formatLabel('>', threshold), labelKey: 'filters.priceOptions.over500', min: threshold, max: Infinity },
    { value: 'custom' as const, label: 'Custom', labelKey: 'filters.priceOptions.custom' }
  ]
}

// Date filter options
export const DATE_OPTIONS: { value: DateFilter; labelKey: string }[] = [
  { value: 'any', labelKey: 'filters.dateOptions.any' },
  { value: 'today', labelKey: 'filters.dateOptions.today' },
  { value: 'tomorrow', labelKey: 'filters.dateOptions.tomorrow' },
  { value: 'this-week', labelKey: 'filters.dateOptions.thisWeek' },
  { value: 'this-weekend', labelKey: 'filters.dateOptions.thisWeekend' },
  { value: 'pick-date', labelKey: 'filters.dateOptions.pickDate' }
]

// Event type options
export const EVENT_TYPE_OPTIONS: { value: EventTypeFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'filters.eventTypeOptions.all' },
  { value: 'in-person', labelKey: 'filters.eventTypeOptions.inPerson' },
  { value: 'online', labelKey: 'filters.eventTypeOptions.online' }
]
