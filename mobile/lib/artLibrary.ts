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
  /**
   * For a real landmark: the caption shown on the poster ("Fort Jacques ·
   * Kenscoff"), so every empty screen also names a place in Haiti.
   */
  place?: string;
  /** A bright lower third (a lit plaza, a bonfire): text needs a heavier scrim. */
  scrim?: 'strong';
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
  { key: 'citadelle', source: require('../assets/art/citadelle.jpg'), alt: 'The Citadelle Laferrière above the clouds', worlds: ['eksperyans'], place: 'Citadelle Laferrière · Milot' },
  { key: 'espo',       source: require('../assets/art/espo.jpg'),       alt: 'A night football match under stadium lights', worlds: ['espo'] },
  { key: 'biznis',     source: require('../assets/art/biznis.jpg'),     alt: 'Rooftop networking around a speaker at dusk', worlds: ['biznis'] },
  { key: 'fanmi',      source: require('../assets/art/fanmi.jpg'),      alt: 'A family flying kites on a hill by the sea', worlds: ['fanmi'] },
  { key: 'galri',      source: require('../assets/art/galri.jpg'),      alt: 'A gallery opening hung with Haitian paintings', worlds: ['kilti'] },
  { key: 'bassinbleu', source: require('../assets/art/bassinbleu.jpg'), alt: 'The turquoise waterfall pools of Bassin Bleu', worlds: ['eksperyans'] },
  { key: 'mache',      source: require('../assets/art/mache.jpg'),      alt: "An artisans' market and community workshop", worlds: ['biznis', 'fanmi'] },

  // Tikèm Landmarks (2026-10). Real places, researched before they were drawn,
  // all in the app's night palette. `place` is the caption on the poster.
  { key: 'champdemars',     source: require('../assets/art/champdemars.jpg'),     alt: 'The Nèg Mawon statue blowing a conch on the Champ de Mars at night', worlds: ['kilti'], place: 'Nèg Mawon · Champ de Mars' },
  { key: 'tour2004',        source: require('../assets/art/tour2004.jpg'),        alt: 'The Tour 2004 bicentennial monument lit up on the Champ de Mars', worlds: ['kilti'], place: 'Tour 2004 · Champ de Mars', scrim: 'strong' },
  { key: 'viaducdelmas',    source: require('../assets/art/viaducdelmas.jpg'),    alt: 'Tap-taps and vendors under the Delmas viaduct at night', worlds: ['lavi-lannwit'], place: 'Viaduc de Delmas' },
  { key: 'saintpierre',     source: require('../assets/art/saintpierre.jpg'),     alt: 'Église Saint-Pierre on Place Saint-Pierre at night, with a flower vendor', worlds: ['kilti'], place: 'Église Saint-Pierre · Pétion-Ville' },
  { key: 'fortjacques',     source: require('../assets/art/fortjacques.jpg'),     alt: 'Fort Jacques lit by lanterns on the pine ridge above the city', worlds: ['eksperyans'], place: 'Fort Jacques · Kenscoff' },
  { key: 'fortalexandre',   source: require('../assets/art/fortalexandre.jpg'),   alt: 'The ruined walls of Fort Alexandre on the ridge at night', worlds: ['eksperyans'], place: 'Fort Alexandre · Kenscoff' },
  { key: 'sautdeau',        source: require('../assets/art/sautdeau.jpg'),        alt: "Pilgrims in white with candles at the Saut d'Eau waterfall", worlds: ['eksperyans'], place: "Saut d'Eau · Ville-Bonheur" },
  { key: 'foretdespins',    source: require('../assets/art/foretdespins.jpg'),    alt: 'A campfire under tall pines in the Forêt des Pins at dusk', worlds: ['eksperyans'], place: 'Forêt des Pins' },
  { key: 'sanssouci',       source: require('../assets/art/sanssouci.jpg'),       alt: 'The grand staircase and arches of the Sans-Souci palace at dusk', worlds: ['kilti'], place: 'Palais Sans-Souci · Milot' },
  { key: 'jacmel',          source: require('../assets/art/jacmel.jpg'),          alt: 'Cast-iron gingerbread balconies down to the sea in Jacmel at night', worlds: ['kilti'], place: 'Jacmel' },
  { key: 'portsalut',       source: require('../assets/art/portsalut.jpg'),       alt: 'Fishing boats and a bonfire on the beach at Port-Salut at dusk', worlds: ['eksperyans'], place: 'Port-Salut', scrim: 'strong' },
  { key: 'labadeenight',    source: require('../assets/art/labadeenight.jpg'),    alt: 'The cove at Labadee under a full moon', worlds: ['eksperyans'], place: 'Labadee' },
  { key: 'bassinbleunight', source: require('../assets/art/bassinbleunight.jpg'), alt: 'The turquoise pools of Bassin Bleu glowing in the gorge at night', worlds: ['eksperyans'], place: 'Bassin Bleu · Jacmel' },
  { key: 'lakou',           source: require('../assets/art/lakou.jpg'),           alt: 'A lakou at night with a tap-tap, string lights and the Haitian flag', worlds: ['fanmi'] },

  // Diaspora landmarks: Haitian life in the cities where Tikèm sells abroad.
  { key: 'miami',    source: require('../assets/art/miami.jpg'),    alt: 'A konpa night at the Caribbean Marketplace in Little Haiti, Miami', worlds: ['lavi-lannwit'], place: 'Little Haiti · Miami' },
  { key: 'boston',   source: require('../assets/art/boston.jpg'),   alt: 'A Flag Day street party in Mattapan Square, Boston', worlds: ['lavi-lannwit'], place: 'Mattapan · Boston' },
  { key: 'montreal', source: require('../assets/art/montreal.jpg'), alt: 'A Haitian terrace night in Saint-Michel, Montréal, with the Olympic tower behind', worlds: ['lavi-lannwit'], place: 'Saint-Michel · Montréal' },
  { key: 'paris',    source: require('../assets/art/paris.jpg'),    alt: 'A konpa night in front of the Basilica of Saint-Denis', worlds: ['mizik'], place: 'Saint-Denis · Paris', scrim: 'strong' },
  { key: 'flatbush', source: require('../assets/art/flatbush.jpg'), alt: 'A rara band and a giant Haitian flag on Nostrand Avenue, Flatbush', worlds: ['kilti'], place: 'Flatbush · Brooklyn' },
  { key: 'dyaspora', source: require('../assets/art/dyaspora.jpg'), alt: 'A Haitian block party with a sound system, the flag and griot on the table', worlds: ['fanmi', 'lavi-lannwit'] },

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
 * Which piece fits the active metro / city, so an empty feed shows a landmark
 * of the place you are browsing (2026-10-04 feedback: "i like the citadelle -
 * but that is more okap ... and so for each of the cities").
 *
 * A town name (Pétion-Ville, Delmas, Kenscoff…) wins over its metro, so a
 * Pétion-Ville feed shows Saint-Pierre rather than downtown. A list rotates
 * once a day. A Haitian place with no landmark of its own gets the lakou; a
 * place elsewhere with none gets PLACE_ART_GENERAL, which names no landmark,
 * so it is never wrong. No place at all keeps the Citadelle.
 *
 * Anywhere abroad without its own piece gets the dyaspora block party.
 *
 * STILL WANTED (one line here once the art exists): Gonaïves (Place d'Armes),
 * Saint-Marc, Île-à-Vache, Santo Domingo (the Malecón), Toronto, Atlanta.
 */
const PLACE_ART_DEFAULT = 'citadelle';
const PLACE_ART_GENERAL = 'dyaspora';
const PLACE_ART_HAITI = 'lakou';

// prettier-ignore
const PLACE_ART_BY_METRO: Record<string, string | string[]> = {
  'ht-port-au-prince': ['champdemars', 'tour2004'],
  'ht-cap-haitien':    'citadelle',
  'ht-jacmel':         'jacmel',
  'ht-les-cayes':      'portsalut',
  'ht-jeremie':        'portsalut',
  'us-new-york':       ['diaspora', 'flatbush'],
  'us-miami':          'miami',
  'us-boston':         'boston',
  'ca-montreal':       'montreal',
  'fr-paris':          'paris',
};

// Normalised town names and nicknames. Checked before the metro.
// prettier-ignore
const PLACE_ART_BY_NAME: Record<string, string | string[]> = {
  'okap': 'citadelle', 'au cap': 'citadelle', 'le cap': 'citadelle', 'cap haitien': 'citadelle',
  'milot': 'sanssouci', 'labadee': 'labadeenight', 'labadie': 'labadeenight',
  'jacmel': 'jacmel', 'jakmel': 'jacmel', 'bassin bleu': 'bassinbleunight',
  'port au prince': ['champdemars', 'tour2004'], 'potoprens': ['champdemars', 'tour2004'], 'pap': ['champdemars', 'tour2004'],
  'champ de mars': 'champdemars',
  'petion ville': 'saintpierre', 'petionville': 'saintpierre', 'petyonvil': 'saintpierre',
  'delmas': 'viaducdelmas',
  'kenscoff': ['fortjacques', 'fortalexandre'], 'kenskof': ['fortjacques', 'fortalexandre'], 'fermathe': 'fortjacques',
  'saut d eau': 'sautdeau', 'sodo': 'sautdeau', 'ville bonheur': 'sautdeau', 'mirebalais': 'sautdeau',
  'foret des pins': 'foretdespins', 'fonds verrettes': 'foretdespins',
  'port salut': 'portsalut', 'ile a vache': 'portsalut', 'les cayes': 'portsalut', 'okay': 'portsalut',
  'new york': ['diaspora', 'flatbush'], 'nyc': ['diaspora', 'flatbush'], 'brooklyn': ['diaspora', 'flatbush'], 'queens': 'diaspora',
  'flatbush': 'flatbush', 'nostrand': 'flatbush',
  'miami': 'miami', 'little haiti': 'miami', 'north miami': 'miami',
  'boston': 'boston', 'mattapan': 'boston',
  'montreal': 'montreal', 'saint michel': 'montreal', 'st michel': 'montreal',
  'paris': 'paris', 'saint denis': 'paris',
};

/** Today as a seed, so a rotating place changes once a day, not per render. */
const daySeed = () => new Date().toISOString().slice(0, 10);

const normPlace = (value: unknown): string =>
  fold(String(value ?? '').split(',')[0])
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * The art for the active place. Accepts a Metro (or anything with an `id`,
 * `label` and `cities`), a city string, or nothing. Always returns a piece.
 */
export function artForPlace(
  place: { id?: string; label?: string; cities?: string[]; country?: string } | string | null | undefined,
  city?: string | null,
  seed: string = daySeed()
): ArtPiece {
  const pick = (entry: string | string[] | undefined): ArtPiece | undefined => {
    if (!entry) return undefined;
    const key = Array.isArray(entry) ? entry[hashSeed(seed) % entry.length] : entry;
    return BY_KEY[key];
  };
  const byName = (n: string): ArtPiece | undefined => {
    const exact = pick(PLACE_ART_BY_NAME[n]);
    if (exact) return exact;
    // "Delmas 33", "Brooklyn NY": a known name followed by more words.
    for (const [name, entry] of Object.entries(PLACE_ART_BY_NAME)) {
      if (n.startsWith(`${name} `)) return pick(entry);
    }
    return undefined;
  };

  // The town you picked beats the metro it belongs to.
  const town = city ? normPlace(city) : '';
  const byTown = town ? byName(town) : undefined;
  if (byTown) return byTown;

  const names: string[] = [];
  let haiti = false;
  if (place && typeof place === 'object') {
    const byMetro = pick(place.id ? PLACE_ART_BY_METRO[place.id] : undefined);
    if (byMetro) return byMetro;
    haiti = place.country === 'HT' || !!place.id?.startsWith('ht-');
    if (place.label) names.push(place.label);
    if (Array.isArray(place.cities)) names.push(...place.cities);
  } else if (typeof place === 'string') {
    names.push(place);
  }

  const normalised = names.map(normPlace).filter(Boolean);
  for (const n of normalised) {
    const found = byName(n);
    if (found) return found;
  }

  if (haiti) return BY_KEY[PLACE_ART_HAITI];
  if (!town && !normalised.length) return BY_KEY[PLACE_ART_DEFAULT];
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
