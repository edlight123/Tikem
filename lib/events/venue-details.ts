/**
 * Venue details: the practical facts people ask before they come. What the
 * place has (parking, backup power, AC, security, tables, food, bar, coat
 * check), whether people can get in and take part (step-free, wheelchair,
 * elevator, accessible washrooms and parking, seating, sign language,
 * captions, a quiet room, service animals), indoor or outdoor, an age policy
 * and a dress code. All optional; an event that says nothing shows nothing.
 *
 * Stored on the event doc, set by both composers:
 *   amenities:      string[]  subset of VENUE_AMENITIES (facilities + accessibility)
 *   venue_setting:  'indoor' | 'outdoor' | 'mixed' | null
 *   age_policy:     '18+' | '21+' | null   (null = no age limit stated)
 *   dress_code:     string (<= 60 chars) | null
 *
 * One `amenities` array holds both groups, so events written before the
 * wider set (parking, step_free, accessible_washrooms, coat_check) read the
 * same. firestore.rules (validVenueDetails) refuses any other shape, so a
 * client cannot write junk the event page would render.
 * mobile/lib/venueDetails.ts mirrors this file; __tests__/venue-details.test.ts
 * keeps the two in step.
 */

/** What the place has: Haiti and nightlife facts first (power, cool air, security). */
export const VENUE_FACILITIES = [
  'parking',
  'backup_power',
  'air_conditioning',
  'security',
  'table_service',
  'food',
  'bar',
  'coat_check',
] as const
export type VenueFacility = (typeof VENUE_FACILITIES)[number]

/** Whether someone can get in and take part: access first, then the room, then support. */
export const VENUE_ACCESSIBILITY = [
  'step_free',
  'wheelchair',
  'elevator',
  'accessible_washrooms',
  'accessible_parking',
  'seating',
  'sign_language',
  'captions',
  'quiet_room',
  'service_animals',
] as const
export type VenueAccessibility = (typeof VENUE_ACCESSIBILITY)[number]

/** Every key the `amenities` array may hold (facilities, then accessibility). */
export const VENUE_AMENITIES = [...VENUE_FACILITIES, ...VENUE_ACCESSIBILITY] as const
export type VenueAmenity = VenueFacility | VenueAccessibility

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

export const isFacilityKey = (k: string): k is VenueFacility => (VENUE_FACILITIES as readonly string[]).includes(k)
export const isAccessibilityKey = (k: string): k is VenueAccessibility => (VENUE_ACCESSIBILITY as readonly string[]).includes(k)

/** Known amenity keys from a list or a comma string, de-duplicated, in display order. */
export function amenityKeysOf(raw: unknown): VenueAmenity[] {
  const list = Array.isArray(raw)
    ? raw.map((x) => String(x).trim())
    : typeof raw === 'string'
      ? raw.split(',').map((x) => x.trim())
      : []
  return VENUE_AMENITIES.filter((k) => list.includes(k))
}

/** The event's venue details, with anything malformed dropped (legacy docs, other clients). */
export function venueDetailsOf(e: unknown): VenueDetails {
  const raw = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
  const setting = String(raw.venue_setting ?? '')
  const age = String(raw.age_policy ?? '')
  const dress = typeof raw.dress_code === 'string' ? raw.dress_code.replace(/\s+/g, ' ').trim().slice(0, DRESS_CODE_MAX) : ''
  return {
    amenities: Array.isArray(raw.amenities) ? amenityKeysOf(raw.amenities) : [],
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

/** How many answers the composer's collapsed "Venue details" row reports. */
export function venueDetailsCount(d: VenueDetails): number {
  return d.amenities.length + (d.venue_setting ? 1 : 0) + (d.age_policy ? 1 : 0) + (d.dress_code ? 1 : 0)
}

/** Discover's "Step-free" filter (`?stepFree=1`, kept for shared links). */
export function isStepFree(e: unknown): boolean {
  return venueDetailsOf(e).amenities.includes('step_free')
}

/**
 * Discover's venue filters: the event has EVERY chosen key. Events that say
 * nothing are left out; an empty choice keeps everything.
 */
export function hasAllAmenities(e: unknown, wanted: readonly string[]): boolean {
  const keys = amenityKeysOf(wanted as unknown[])
  if (!keys.length) return true
  const have = venueDetailsOf(e).amenities
  return keys.every((k) => have.includes(k))
}

/**
 * The chosen venue filter keys from a filters object: `amenities` plus the
 * older `stepFree` flag, so saved and shared Step-free filters keep working.
 */
export function wantedAmenities(f: { amenities?: readonly string[] | null; stepFree?: boolean | null }): VenueAmenity[] {
  return amenityKeysOf([...(f.amenities || []), ...(f.stepFree ? ['step_free'] : [])])
}

/** Icon names (lucide) per line, shared by the web and app event pages. One per key. */
export const VENUE_DETAIL_ICONS = {
  parking: 'SquareParking',
  backup_power: 'PlugZap',
  air_conditioning: 'AirVent',
  security: 'ShieldCheck',
  table_service: 'Sofa',
  food: 'Utensils',
  bar: 'Martini',
  coat_check: 'Luggage',
  step_free: 'DoorOpen',
  wheelchair: 'Accessibility',
  elevator: 'ArrowUpDown',
  accessible_washrooms: 'Toilet',
  accessible_parking: 'CircleParking',
  seating: 'Armchair',
  sign_language: 'Hand',
  captions: 'Captions',
  quiet_room: 'VolumeOff',
  service_animals: 'Dog',
  indoor: 'House',
  outdoor: 'Trees',
  mixed: 'Tent',
  age: 'IdCard',
  dress: 'Shirt',
} as const
export type VenueDetailIcon = keyof typeof VENUE_DETAIL_ICONS

export type VenueDetailLine = { icon: VenueDetailIcon; key: string; value?: string }

/**
 * "Good to know" lines, in a fixed order: what the place has, then the
 * setting, then the rules. Accessibility has its own lines
 * (venueAccessLines). `key` is an i18n key under `venue_details.*`; `value`
 * is filled in for the dress code.
 */
export function venueDetailLines(d: VenueDetails): VenueDetailLine[] {
  const out: VenueDetailLine[] = d.amenities.filter(isFacilityKey).map((k) => ({ icon: k, key: k }))
  if (d.venue_setting) out.push({ icon: d.venue_setting, key: d.venue_setting })
  if (d.age_policy) out.push({ icon: 'age', key: d.age_policy === '21+' ? 'age_21' : 'age_18' })
  if (d.dress_code) out.push({ icon: 'dress', key: 'dress_code', value: d.dress_code })
  return out
}

/** The "accessibility" sub-section's lines, in VENUE_ACCESSIBILITY order. */
export function venueAccessLines(d: VenueDetails): VenueDetailLine[] {
  return d.amenities.filter(isAccessibilityKey).map((k) => ({ icon: k, key: k }))
}
