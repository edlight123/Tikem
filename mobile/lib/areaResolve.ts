/**
 * "Use my current location", the pure half: a position → the browse area the
 * app already understands (country + metro), and the "2.4 km away" label.
 *
 * No React Native imports, so the root jest run tests it directly
 * (__tests__/current-area.test.ts). The device half (native module guard,
 * permission, one position) is lib/currentLocation.ts.
 *
 * MIRROR: the website runs the same table and rules in lib/location/nearestArea.ts.
 * The parity test fails if the two drift.
 *
 * Resolution, entirely ON THE DEVICE (no geocoder, no server call):
 *   1. the nearest metro whose centre is within its radius → that metro;
 *   2. else the nearest metro within COUNTRY_FALLBACK_KM → its country, all areas
 *      (Hinche browses Haiti, Philadelphia the United States);
 *   3. else → unsupported (Tikèm is not there yet), nothing is applied.
 *
 * PRIVACY: coordinates only ever live in memory. What the app keeps is the
 * resolved country and city, the same two fields a manual pick sets.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface AreaCentre {
  /** data/metros.ts id. */
  id: string;
  country: string;
  /** The metro's label: the value the app browses by (activeCity). */
  label: string;
  lat: number;
  lng: number;
  /** How far from the centre still counts as this metro. */
  radiusKm: number;
}

/**
 * Approximate centres of every metro in data/metros.ts. Radii follow how far
 * the metro's own satellite towns reach (Miami runs up to West Palm Beach).
 */
export const AREA_CENTRES: readonly AreaCentre[] = [
  // Haiti
  { id: 'ht-port-au-prince', country: 'HT', label: 'Port-au-Prince', lat: 18.5392, lng: -72.335, radiusKm: 30 },
  { id: 'ht-cap-haitien', country: 'HT', label: 'Cap-Haïtien', lat: 19.7578, lng: -72.2042, radiusKm: 30 },
  { id: 'ht-jacmel', country: 'HT', label: 'Jacmel', lat: 18.2342, lng: -72.535, radiusKm: 25 },
  { id: 'ht-les-cayes', country: 'HT', label: 'Les Cayes', lat: 18.1933, lng: -73.7461, radiusKm: 30 },
  { id: 'ht-gonaives', country: 'HT', label: 'Gonaïves', lat: 19.4475, lng: -72.6892, radiusKm: 28 },
  { id: 'ht-saint-marc', country: 'HT', label: 'Saint-Marc', lat: 19.1081, lng: -72.6939, radiusKm: 25 },
  { id: 'ht-port-de-paix', country: 'HT', label: 'Port-de-Paix', lat: 19.9392, lng: -72.8306, radiusKm: 30 },
  { id: 'ht-jeremie', country: 'HT', label: 'Jérémie', lat: 18.65, lng: -74.1167, radiusKm: 30 },
  { id: 'ht-fort-liberte', country: 'HT', label: 'Fort-Liberté', lat: 19.6631, lng: -71.8381, radiusKm: 30 },
  // United States
  { id: 'us-miami', country: 'US', label: 'Miami', lat: 25.7617, lng: -80.1918, radiusKm: 110 },
  { id: 'us-new-york', country: 'US', label: 'New York', lat: 40.7128, lng: -74.006, radiusKm: 60 },
  { id: 'us-boston', country: 'US', label: 'Boston', lat: 42.3601, lng: -71.0589, radiusKm: 45 },
  { id: 'us-atlanta', country: 'US', label: 'Atlanta', lat: 33.749, lng: -84.388, radiusKm: 50 },
  { id: 'us-orlando', country: 'US', label: 'Orlando', lat: 28.5384, lng: -81.3789, radiusKm: 45 },
  { id: 'us-tampa', country: 'US', label: 'Tampa', lat: 27.9506, lng: -82.4572, radiusKm: 45 },
  { id: 'us-chicago', country: 'US', label: 'Chicago', lat: 41.8781, lng: -87.6298, radiusKm: 50 },
  { id: 'us-houston', country: 'US', label: 'Houston', lat: 29.7604, lng: -95.3698, radiusKm: 60 },
  { id: 'us-los-angeles', country: 'US', label: 'Los Angeles', lat: 34.0522, lng: -118.2437, radiusKm: 60 },
  // Canada
  { id: 'ca-montreal', country: 'CA', label: 'Montreal', lat: 45.5019, lng: -73.5674, radiusKm: 50 },
  { id: 'ca-toronto', country: 'CA', label: 'Toronto', lat: 43.6532, lng: -79.3832, radiusKm: 50 },
  { id: 'ca-ottawa', country: 'CA', label: 'Ottawa', lat: 45.4215, lng: -75.6972, radiusKm: 40 },
  { id: 'ca-vancouver', country: 'CA', label: 'Vancouver', lat: 49.2827, lng: -123.1207, radiusKm: 45 },
  { id: 'ca-calgary', country: 'CA', label: 'Calgary', lat: 51.0447, lng: -114.0719, radiusKm: 40 },
  // France
  { id: 'fr-paris', country: 'FR', label: 'Paris', lat: 48.8566, lng: 2.3522, radiusKm: 50 },
  { id: 'fr-lyon', country: 'FR', label: 'Lyon', lat: 45.764, lng: 4.8357, radiusKm: 35 },
  { id: 'fr-marseille', country: 'FR', label: 'Marseille', lat: 43.2965, lng: 5.3698, radiusKm: 35 },
  { id: 'fr-nice', country: 'FR', label: 'Nice', lat: 43.7102, lng: 7.262, radiusKm: 30 },
  { id: 'fr-toulouse', country: 'FR', label: 'Toulouse', lat: 43.6047, lng: 1.4442, radiusKm: 35 },
  { id: 'fr-bordeaux', country: 'FR', label: 'Bordeaux', lat: 44.8378, lng: -0.5792, radiusKm: 35 },
  // Dominican Republic
  { id: 'do-santo-domingo', country: 'DO', label: 'Santo Domingo', lat: 18.4861, lng: -69.9312, radiusKm: 40 },
  { id: 'do-santiago', country: 'DO', label: 'Santiago', lat: 19.4517, lng: -70.697, radiusKm: 35 },
  { id: 'do-punta-cana', country: 'DO', label: 'Punta Cana', lat: 18.5601, lng: -68.3725, radiusKm: 40 },
  { id: 'do-la-romana', country: 'DO', label: 'La Romana', lat: 18.4273, lng: -68.9728, radiusKm: 30 },
  { id: 'do-puerto-plata', country: 'DO', label: 'Puerto Plata', lat: 19.7934, lng: -70.6884, radiusKm: 35 },
];

/** Beyond every radius, still this close to a metro → its country, all areas. */
export const COUNTRY_FALLBACK_KM = 200;

export interface ResolvedArea {
  /** ISO alpha-2. */
  country: string;
  /** The metro label to browse, '' for the whole country. */
  city: string;
  /** What to show ("Port-au-Prince"); '' when the whole country. */
  label: string;
  /** Not near any market Tikèm serves: nothing should be applied. */
  unsupported?: boolean;
}

export function kmBetween(a: LatLng, b: LatLng): number {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const validPoint = (p: LatLng | null | undefined): p is LatLng =>
  !!p &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lng) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lng) <= 180;

/** The nearest area (and the unsupported case) for a position; null for a bad position. */
export function nearestArea(p: LatLng | null | undefined): ResolvedArea | null {
  if (!validPoint(p)) return null;
  let inside: { a: AreaCentre; km: number } | null = null;
  let nearest: { a: AreaCentre; km: number } | null = null;
  for (const a of AREA_CENTRES) {
    const km = kmBetween(p, a);
    if (!nearest || km < nearest.km) nearest = { a, km };
    if (km <= a.radiusKm && (!inside || km < inside.km)) inside = { a, km };
  }
  if (inside) return { country: inside.a.country, city: inside.a.label, label: inside.a.label };
  if (nearest && nearest.km <= COUNTRY_FALLBACK_KM) return { country: nearest.a.country, city: '', label: '' };
  return { country: '', city: '', label: '', unsupported: true };
}

/** Distances past this are not "near you" any more, so no label. */
export const MAX_DISTANCE_KM = 300;

/**
 * "2.4 km" / "12 mi" (the caller wraps it in "… away"). Miles in the US, km
 * elsewhere; a decimal comma in French and Kreyòl. '' when too far to matter.
 */
export function formatDistance(km: number, country: string, language = 'en'): string {
  if (!Number.isFinite(km) || km < 0 || km > MAX_DISTANCE_KM) return '';
  const miles = String(country || '').toUpperCase() === 'US';
  const v = miles ? km * 0.621371 : km;
  const unit = miles ? 'mi' : 'km';
  const n = v < 0.1 ? '0.1' : v < 10 ? v.toFixed(1) : String(Math.round(v));
  return `${language.startsWith('en') ? n : n.replace('.', ',')} ${unit}`;
}
