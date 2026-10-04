/**
 * The Tikèm art library — ONE manifest for every bundled screenprint piece.
 *
 * Used by: the composer's stock-flyer picker, the world (category) tiles and
 * hero, the login backdrop and the big empty states. Everything that shows a
 * piece of art asks this file, so a new piece lands everywhere at once.
 *
 * ADDING A PIECE is one line in ART below: drop the 800x1000 (4:5) JPEG in
 * assets/art/, then add `{ key, source: require(...), alt, worlds }`. The
 * worlds decide where it shows up; an empty list keeps it in the general pool
 * (login, empty states, the "all art" part of the flyer picker) only.
 *
 * Assets are `require`d, so Metro bundles them as files (not JS) and they ship
 * in OTA updates like any other image. Nothing here is fetched at runtime.
 */

/**
 * The eight cultural worlds — the mobile mirror of the web's
 * `lib/categories.ts` CULTURAL_CATEGORIES (same keys, same Kreyòl labels).
 * Mobile events still store canonical categories; `worldForCategory` maps them.
 */
export const WORLDS = [
  { key: 'mizik', label: 'mizik' },
  { key: 'lavi-lannwit', label: 'lavi lannwit' },
  { key: 'kilti', label: 'kilti' },
  { key: 'espo', label: 'espò' },
  { key: 'gastronomi', label: 'gastronomi' },
  { key: 'biznis', label: 'biznis' },
  { key: 'fanmi', label: 'fanmi' },
  { key: 'eksperyans', label: 'eksperyans' },
] as const;

export type WorldKey = (typeof WORLDS)[number]['key'];

export interface ArtPiece {
  /** Stable id. Never reuse one for a different image. */
  key: string;
  /** The bundled module (a number at runtime). */
  source: any;
  /** Short description, used as the accessibility label. */
  alt: string;
  /** Worlds this piece fits, best fit first. */
  worlds: WorldKey[];
  /** Part of the login rotation / general pool. Defaults to true. */
  general?: boolean;
}

// prettier-ignore
export const ART: ArtPiece[] = [
  { key: 'konpa',     source: require('../assets/art/konpa.jpg'),     alt: 'Couples dancing konpa on a terrace under string lights', worlds: ['mizik', 'lavi-lannwit'] },
  { key: 'twoubadou', source: require('../assets/art/twoubadou.jpg'), alt: 'Twoubadou musicians on a gingerbread-house porch under a full moon', worlds: ['mizik'] },
  { key: 'diaspora',  source: require('../assets/art/diaspora.jpg'),  alt: 'A crowd waving the Haitian flag at a concert by the Brooklyn Bridge', worlds: ['lavi-lannwit'] },
  { key: 'kanaval',   source: require('../assets/art/kanaval.jpg'),   alt: 'Kanaval dancers in horned masks and feathered wings on a Jacmel street', worlds: ['kilti'] },
  { key: 'rara',      source: require('../assets/art/rara.jpg'),      alt: 'A rara band with vaksen horns and drums on a country road at dusk', worlds: ['kilti'] },
  { key: 'table',     source: require('../assets/art/table.jpg'),     alt: 'Family and friends at a long table under a mango tree and lanterns', worlds: ['gastronomi'] },
  { key: 'labadee',   source: require('../assets/art/labadee.jpg'),   alt: 'A beach party with a DJ under the palms at sunset', worlds: ['eksperyans'] },
  { key: 'citadelle', source: require('../assets/art/citadelle.jpg'), alt: 'The Citadelle Laferrière above the clouds', worlds: ['eksperyans'] },
  { key: 'espo',       source: require('../assets/art/espo.jpg'),       alt: 'A night football match under stadium lights', worlds: ['espo'] },
  { key: 'biznis',     source: require('../assets/art/biznis.jpg'),     alt: 'Rooftop networking around a speaker at dusk', worlds: ['biznis'] },
  { key: 'fanmi',      source: require('../assets/art/fanmi.jpg'),      alt: 'A family flying kites on a hill by the sea', worlds: ['fanmi'] },
  { key: 'galri',      source: require('../assets/art/galri.jpg'),      alt: 'A gallery opening hung with Haitian paintings', worlds: ['kilti'] },
  { key: 'bassinbleu', source: require('../assets/art/bassinbleu.jpg'), alt: 'The turquoise waterfall pools of Bassin Bleu', worlds: ['eksperyans'] },
  { key: 'mache',      source: require('../assets/art/mache.jpg'),      alt: "An artisans' market and community workshop", worlds: ['biznis', 'fanmi'] },
  // The original login pieces: general pool only, no world.
  { key: 'art1', source: require('../assets/art/art1.jpg'), alt: 'Jacmel steps at sunset', worlds: [] },
  { key: 'art2', source: require('../assets/art/art2.jpg'), alt: 'A tap-tap at sunset', worlds: [] },
  { key: 'art3', source: require('../assets/art/art3.jpg'), alt: 'A moonlit fishing village', worlds: [] },
  { key: 'art4', source: require('../assets/art/art4.jpg'), alt: 'A night market', worlds: [] },
  { key: 'art5', source: require('../assets/art/art5.jpg'), alt: 'Konpa on the beach', worlds: [] },
  { key: 'art6', source: require('../assets/art/art6.jpg'), alt: 'A band on the beach', worlds: [] },
];

const BY_KEY: Record<string, ArtPiece> = Object.fromEntries(ART.map((a) => [a.key, a]));

/** Every piece, in manifest order. */
export function allArt(): ArtPiece[] {
  return ART.slice();
}

/** The general pool: pieces flagged general (the default). Never empty. */
export function generalArt(): ArtPiece[] {
  const pool = ART.filter((a) => a.general !== false);
  return pool.length ? pool : ART.slice();
}

/** One piece by key, or undefined. */
export function artByKey(key: string): ArtPiece | undefined {
  return BY_KEY[key];
}

/** Pieces made for a world, best fit first. Empty when the world has none. */
export function artInWorld(world: string | null | undefined): ArtPiece[] {
  if (!world) return [];
  return ART.filter((a) => (a.worlds as string[]).includes(world));
}

/** Small, stable string hash (FNV-1a) so a seed always picks the same piece. */
export function hashSeed(seed: string | number | null | undefined): number {
  const s = String(seed ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The art for a world, picked deterministically by `seed` (an event id, a world
 * key…) so the same seed always gets the same piece. A world with no art, an
 * unknown world or no world at all falls back to the general pool. Always
 * returns a piece.
 */
export function artForWorld(world: string | null | undefined, seed?: string | number | null): ArtPiece {
  const own = artInWorld(world);
  const pool = own.length ? own : generalArt();
  return pool[hashSeed(seed ?? world ?? '') % pool.length];
}

/** True when the world has its own art (tiles use a dark neutral otherwise). */
export function worldHasArt(world: string | null | undefined): boolean {
  return artInWorld(world).length > 0;
}

/**
 * Map a stored event category (canonical web value, mobile composer value or a
 * legacy one) to its world. Mirrors the web's normalizeEventCategory +
 * culturalCategoryFor: anything unknown lands in `eksperyans`, like web's
 * 'Other', except the NO_WORLD categories, which return null.
 */
const CATEGORY_WORLD: Record<string, WorldKey> = {
  concert: 'mizik',
  music: 'mizik',
  party: 'lavi-lannwit',
  nightlife: 'lavi-lannwit',
  festival: 'kilti',
  theater: 'kilti',
  theatre: 'kilti',
  art: 'kilti',
  arts: 'kilti',
  'arts & culture': 'kilti',
  culture: 'kilti',
  cultural: 'kilti',
  sports: 'espo',
  sport: 'espo',
  'food & drink': 'gastronomi',
  food: 'gastronomi',
  conference: 'biznis',
  workshop: 'biznis',
  business: 'biznis',
  networking: 'biznis',
  education: 'biznis',
  technology: 'biznis',
  tech: 'biznis',
  family: 'fanmi',
  community: 'fanmi',
  kids: 'fanmi',
  other: 'eksperyans',
};

/**
 * Categories with no world on purpose: a religious service or a wellness class
 * under beach-party art would misrepresent it. They get the general pool for
 * flyers and keep their existing photo / a dark neutral on tiles.
 */
const NO_WORLD = new Set(['religious', 'health', 'health & wellness', 'wellness']);

export function worldForCategory(category: string | null | undefined): WorldKey | null {
  const key = String(category || '').trim().toLowerCase();
  if (NO_WORLD.has(key)) return null;
  return CATEGORY_WORLD[key] || 'eksperyans';
}

/** Shortcut: the art for an event's category, seeded by the event id. */
export function artForCategory(category: string | null | undefined, seed?: string | number | null): ArtPiece {
  return artForWorld(worldForCategory(category), seed ?? category ?? '');
}

/**
 * The art for a world TILE of this category, or null when its world has no art
 * (or it has no world), in which case the tile draws a dark neutral fill
 * instead of borrowing an unrelated piece. Seeded by the category, so a tile
 * never changes between renders, and sibling categories in one world
 * (Business / Technology / Education) can land on different pieces.
 */
export function tileArtForCategory(category: string | null | undefined): ArtPiece | null {
  const world = worldForCategory(category);
  if (!world || !worldHasArt(world)) return null;
  return artForWorld(world, String(category || '').trim().toLowerCase());
}

/** Dark neutral used behind a world tile that has no art (canvas → surface). */
export const NO_ART_FILL: readonly [string, string] = ['#1F1F1F', '#121212'];

/**
 * The whole library ordered for the flyer picker: the event's world first
 * (best fit first), then everything else in manifest order. No duplicates.
 */
export function artForPicker(category: string | null | undefined): ArtPiece[] {
  const own = artInWorld(worldForCategory(category));
  const ownKeys = new Set(own.map((a) => a.key));
  return [...own, ...ART.filter((a) => !ownKeys.has(a.key))];
}

// ---------------------------------------------------------------------------
// Art for a PLACE (the big "nothing here yet" empty states on Home / Discover)
// ---------------------------------------------------------------------------

/**
 * Which piece fits the active metro / city, so an empty Port-au-Prince feed no
 * longer wears the Citadelle (a Cap-Haïtien landmark). 2026-10-04 feedback:
 * "i like the citadelle - but that is more okap ... and so for each of the
 * cities".
 *
 * Keyed by metro id (data/metros.ts) first, then by a normalised town name
 * (accents stripped, lowercased, ", ST" suffix dropped) for aliases that are
 * not metro towns (Okap, Potoprens, Labadee…). A place we know but have no
 * landmark for gets PLACE_ART_GENERAL, which names no landmark, so it is never
 * wrong. No place at all keeps the old default (the Citadelle).
 *
 * STILL MISSING a dedicated landmark piece (add the art to ART, then change one
 * line below):
 * - Port-au-Prince: uses art2 (tap-tap at sunset). Wanted: the Marché en Fer /
 *   Iron Market, the Champ de Mars and the Palais, Pétion-Ville at night,
 *   the view from Boutilliers / Kenscoff.
 * - Les Cayes / Jérémie: uses art3 (moonlit fishing village). Wanted: Île-à-
 *   Vache, Pointe Sable, the Grand'Anse coast.
 * - Gonaïves, Saint-Marc, Port-de-Paix, Fort-Liberté: general. Wanted: the
 *   Place d'Armes of Gonaïves (Independence), the Saint-Marc bay.
 * - Miami: general. Wanted: the Little Haiti Cultural Complex, Little Haiti
 *   murals on NE 2nd Ave, a Miami Beach night.
 * - Boston, Atlanta, Orlando, Tampa, Chicago, Houston, Los Angeles: general.
 * - Montréal: general. Wanted: Saint-Michel / Rivière-des-Prairies, the Mount
 *   Royal tam-tams, Old Port in winter.
 * - Toronto, Ottawa, Vancouver, Calgary: general.
 * - Paris: general. Wanted: a Haitian night in Saint-Denis or the canal Saint-
 *   Martin, Sacré-Cœur steps.
 * - Dominican Republic metros: general. Wanted: the Malecón of Santo Domingo.
 * New York already has its own (diaspora: the Brooklyn Bridge).
 */
const PLACE_ART_DEFAULT = 'citadelle';
const PLACE_ART_GENERAL = 'konpa';

// prettier-ignore
const PLACE_ART_BY_METRO: Record<string, string> = {
  'ht-port-au-prince': 'art2',     // tap-tap at sunset
  'ht-cap-haitien':    'citadelle',
  'ht-jacmel':         'kanaval',  // Jacmel kanaval
  'ht-les-cayes':      'art3',     // moonlit fishing village
  'ht-jeremie':        'art3',
  'us-new-york':       'diaspora', // the Brooklyn Bridge
};

// Normalised town names and nicknames, for places outside the metro list.
// prettier-ignore
const PLACE_ART_BY_NAME: Record<string, string> = {
  'okap': 'citadelle', 'au cap': 'citadelle', 'le cap': 'citadelle', 'cap haitien': 'citadelle',
  'milot': 'citadelle', 'labadee': 'labadee', 'labadie': 'labadee',
  'jacmel': 'kanaval', 'jakmel': 'kanaval', 'bassin bleu': 'bassinbleu',
  'port au prince': 'art2', 'potoprens': 'art2', 'pap': 'art2',
  'petion ville': 'art2', 'petyonvil': 'art2', 'delmas': 'art2',
  'new york': 'diaspora', 'nyc': 'diaspora', 'brooklyn': 'diaspora', 'queens': 'diaspora',
};

const normPlace = (value: unknown): string =>
  fold(String(value ?? '').split(',')[0])
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * The art for the active place. Accepts a Metro (or anything with an `id`,
 * `label` and `cities`), a city string, or nothing. Always returns a piece.
 */
export function artForPlace(
  place: { id?: string; label?: string; cities?: string[] } | string | null | undefined,
  city?: string | null
): ArtPiece {
  const pick = (key: string | undefined) => (key ? BY_KEY[key] : undefined);

  const names: string[] = [];
  if (place && typeof place === 'object') {
    const byMetro = pick(place.id ? PLACE_ART_BY_METRO[place.id] : undefined);
    if (byMetro) return byMetro;
    if (place.label) names.push(place.label);
    if (Array.isArray(place.cities)) names.push(...place.cities);
  } else if (typeof place === 'string') {
    names.push(place);
  }
  if (city) names.unshift(city);

  const normalised = names.map(normPlace).filter(Boolean);
  for (const n of normalised) {
    const exact = pick(PLACE_ART_BY_NAME[n]);
    if (exact) return exact;
    // "Delmas 33", "Brooklyn NY": a known name followed by more words.
    for (const [name, key] of Object.entries(PLACE_ART_BY_NAME)) {
      if (n.startsWith(`${name} `)) return BY_KEY[key];
    }
  }

  if (!normalised.length) return BY_KEY[PLACE_ART_DEFAULT];
  return BY_KEY[PLACE_ART_GENERAL];
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** The Kreyòl label for a world key ('espo' → 'espò'). */
export function worldLabel(world: string | null | undefined): string {
  return WORLDS.find((w) => w.key === world)?.label || '';
}

/** Filter pieces by a free-text query over key, description and world names. */
export function searchArt(pieces: ArtPiece[], query: string): ArtPiece[] {
  const q = fold(query.trim());
  if (!q) return pieces;
  return pieces.filter((a) =>
    fold([a.key, a.alt, ...a.worlds, ...a.worlds.map(worldLabel)].join(' ')).includes(q)
  );
}
