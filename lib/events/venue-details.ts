/**
 * Venue details: the practical facts people ask before they come. Parking,
 * step-free access, accessible washrooms, coat check, indoor or outdoor, an
 * age policy and a dress code. All optional; an event that says nothing
 * shows nothing.
 *
 * Stored on the event doc, set by both composers:
 *   amenities:      string[]  subset of VENUE_AMENITIES
 *   venue_setting:  'indoor' | 'outdoor' | 'mixed' | null
 *   age_policy:     '18+' | '21+' | null   (null = no age limit stated)
 *   dress_code:     string (<= 60 chars) | null
 *
 * firestore.rules (validVenueDetails) refuses any other shape, so a client
 * cannot write junk the event page would render. mobile/lib/venueDetails.ts
 * mirrors this file; __tests__/venue-details.test.ts keeps the two in step.
 */

export const VENUE_AMENITIES = ['parking', 'step_free', 'accessible_washrooms', 'coat_check'] as const
export type VenueAmenity = (typeof VENUE_AMENITIES)[number]

export const VENUE_SETTINGS = ['indoor', 'outdoor', 'mixed'] as const
export type VenueSetting = (typeof VENUE_SETTINGS)[number]

export const AGE_POLICIES = ['18+', '21+'] as const
export type AgePolicy = (typeof AGE_POLICIES)[number]

export const DRESS_CODE_MAX = 60

export interface VenueDetails {
  amenities: VenueAmenity[]
  venue_setting: VenueSetting | null
  age_policy: AgePolicy | null
  dress_code: string | null
}

export const EMPTY_VENUE_DETAILS: VenueDetails = { amenities: [], venue_setting: null, age_policy: null, dress_code: null }

/** The event's venue details, with anything malformed dropped (legacy docs, other clients). */
export function venueDetailsOf(e: unknown): VenueDetails {
  const raw = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
  const list = Array.isArray(raw.amenities) ? raw.amenities.map((x) => String(x)) : []
  const setting = String(raw.venue_setting ?? '')
  const age = String(raw.age_policy ?? '')
  const dress = typeof raw.dress_code === 'string' ? raw.dress_code.replace(/\s+/g, ' ').trim().slice(0, DRESS_CODE_MAX) : ''
  return {
    amenities: VENUE_AMENITIES.filter((k) => list.includes(k)),
    venue_setting: (VENUE_SETTINGS as readonly string[]).includes(setting) ? (setting as VenueSetting) : null,
    age_policy: (AGE_POLICIES as readonly string[]).includes(age) ? (age as AgePolicy) : null,
    dress_code: dress || null,
  }
}

/**
 * The fields a composer writes. An online event has no venue, so it writes
 * the empty set (an event moved online drops what its old venue offered);
 * the age policy and dress code still apply to who may join.
 */
export function venueDetailsFields(d: VenueDetails, isOnline: boolean): VenueDetails {
  const clean = venueDetailsOf(d)
  return isOnline ? { ...clean, amenities: [], venue_setting: null } : clean
}

export function hasVenueDetails(d: VenueDetails): boolean {
  return d.amenities.length > 0 || !!d.venue_setting || !!d.age_policy || !!d.dress_code
}

/** Discover's "Step-free" filter. */
export function isStepFree(e: unknown): boolean {
  return venueDetailsOf(e).amenities.includes('step_free')
}

/** Icon names (lucide) per line, shared by the web and app event pages. */
export const VENUE_DETAIL_ICONS = {
  parking: 'SquareParking',
  step_free: 'Accessibility',
  accessible_washrooms: 'Toilet',
  coat_check: 'Luggage',
  indoor: 'House',
  outdoor: 'Trees',
  mixed: 'Tent',
  age: 'IdCard',
  dress: 'Shirt',
} as const
export type VenueDetailIcon = keyof typeof VENUE_DETAIL_ICONS

/**
 * The event page's lines, in a fixed order: access first (what decides
 * whether someone can come), then the setting, then the rules. `key` is an
 * i18n key under `venue_details.*`; `value` is filled in for the dress code.
 */
export function venueDetailLines(d: VenueDetails): Array<{ icon: VenueDetailIcon; key: string; value?: string }> {
  const out: Array<{ icon: VenueDetailIcon; key: string; value?: string }> = []
  if (d.amenities.includes('step_free')) out.push({ icon: 'step_free', key: 'step_free' })
  if (d.amenities.includes('accessible_washrooms')) out.push({ icon: 'accessible_washrooms', key: 'accessible_washrooms' })
  if (d.amenities.includes('parking')) out.push({ icon: 'parking', key: 'parking' })
  if (d.amenities.includes('coat_check')) out.push({ icon: 'coat_check', key: 'coat_check' })
  if (d.venue_setting) out.push({ icon: d.venue_setting, key: d.venue_setting })
  if (d.age_policy) out.push({ icon: 'age', key: d.age_policy === '21+' ? 'age_21' : 'age_18' })
  if (d.dress_code) out.push({ icon: 'dress', key: 'dress_code', value: d.dress_code })
  return out
}
