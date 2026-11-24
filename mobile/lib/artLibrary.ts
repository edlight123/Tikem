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
 *
 * Places, national days and placeholders now show real PHOTOGRAPHS
 * (lib/photoLibrary, 2026-11-16); the illustrations remain the flyer
 * picker's stock and the fallback where no photo exists.
 */

import { generalPhotos, photoByKey, placeholderPhotos } from './photoLibrary';

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

  // Heroes of the Revolution: scenes, never invented faces; 1803 flag where it
  // belongs. Out of the general pool so they stay special: they appear in the
  // kilti world, the flyer picker and on their own national days.
  { key: 'vertieres',     source: require('../assets/art/vertieres.jpg'),     alt: 'Capois-La-Mort charging up the hill at the Battle of Vertières', worlds: ['kilti'], general: false, place: 'Vertières · 18 Nov 1803' },
  { key: 'toussaint',     source: require('../assets/art/toussaint.jpg'),     alt: 'Toussaint Louverture on his grey horse above the army camp at dusk', worlds: ['kilti'], general: false, place: 'Toussaint Louverture' },
  { key: 'dessalines',    source: require('../assets/art/dessalines.jpg'),    alt: 'The proclamation of independence at Gonaïves at sunrise, 1 January 1804', worlds: ['kilti'], general: false, place: 'Gonaïves · 1 Jan 1804' },
  { key: 'catherineflon', source: require('../assets/art/catherineflon.jpg'), alt: 'Catherine Flon sewing the first blue and red flag by lamplight at Arcahaie', worlds: ['kilti'], general: false, place: 'Catherine Flon · Arcahaie, 18 May 1803' },
  { key: 'christophe',    source: require('../assets/art/christophe.jpg'),    alt: 'Henri Christophe on the ramparts of the Citadelle at dusk', worlds: ['kilti'], general: false, place: 'Henri Christophe · Citadelle' },

  // Holidays: shown on their national day, and in their worlds / the picker.
  { key: 'kap',         source: require('../assets/art/kap.jpg'),         alt: 'Families flying handmade kap kites on a hillside at Easter', worlds: ['fanmi'], general: false, place: 'Monte kap · Pak', scrim: 'strong' },
  { key: 'konbit',      source: require('../assets/art/konbit.jpg'),      alt: 'A konbit: neighbours working a hillside field together to the drum and the lanbi', worlds: ['kilti'], general: false, place: 'Konbit' },
  { key: 'kanavalchar', source: require('../assets/art/kanavalchar.jpg'), alt: 'A kanaval float with a konpa band, masks and a lanse kòd at night', worlds: ['kilti', 'lavi-lannwit'], general: false, place: 'Kanaval' },
  { key: 'tontonnwel',  source: require('../assets/art/tontonnwel.jpg'),  alt: 'Tonton Nwèl handing out gifts on a porch as children carry glowing fanals', worlds: ['fanmi'], general: false, place: 'Tonton Nwèl' },

  // Lavi chak jou: everyday Haitian life. Captioned with their Kreyòl name.
  { key: 'domino',      source: require('../assets/art/domino.jpg'),      alt: 'Men slamming dominoes under a mango tree at night', worlds: ['lavi-lannwit'], place: 'Domino' },
  { key: 'kafe',        source: require('../assets/art/kafe.jpg'),        alt: 'Kafe ak pen by a kerosene lamp on a porch before dawn', worlds: ['gastronomi'], place: 'Kafe ak pen' },
  { key: 'akasan',      source: require('../assets/art/akasan.jpg'),      alt: 'An akasan vendor serving workers from a steaming pot before dawn', worlds: ['gastronomi'], place: 'Akasan' },
  { key: 'tekemab',     source: require('../assets/art/tekemab.jpg'),     alt: 'Kids shooting marbles in the dirt at dusk', worlds: ['fanmi'], place: 'Teke mab', scrim: 'strong' },
  { key: 'woulesek',    source: require('../assets/art/woulesek.jpg'),    alt: 'Kids rolling bicycle rims down a cobbled lane toward the bay', worlds: ['fanmi'], place: 'Woule sèk' },
  { key: 'taptappenti', source: require('../assets/art/taptappenti.jpg'), alt: 'A painter hand-painting a portrait on the back of a tap-tap at night', worlds: ['kilti'], place: 'Pent tap-tap', scrim: 'strong' },
  { key: 'fresko',      source: require('../assets/art/fresko.jpg'),      alt: 'A fresco cart with glowing syrup bottles and kids lined up at dusk', worlds: ['gastronomi', 'fanmi'], place: 'Fresko' },
  { key: 'lavandye',    source: require('../assets/art/lavandye.jpg'),    alt: 'Two washerwomen crossing river stones at blue hour', worlds: ['kilti'], place: 'Lavandyè' },
  { key: 'banboch',     source: require('../assets/art/banboch.jpg'),     alt: 'A rooftop banbòch with a DJ, dancers and the city lights below', worlds: ['lavi-lannwit'], place: 'Banbòch' },
  { key: 'bolet',       source: require('../assets/art/bolet.jpg'),       alt: 'A painted bòlèt kiosk on a street at night', worlds: [], place: 'Bòlèt' },

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

/** One piece by key (an illustration, or a "photo-…" photograph), or undefined. */
export function artByKey(key: string): ArtPiece | undefined {
  return BY_KEY[key] || photoByKey(key);
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
 * The placeholder for a world, picked deterministically by `seed` (an event
 * id, a world key…) so the same seed always gets the same picture. Real
 * photos: the world's tile photo plus its placeholder photos
 * (lib/photoLibrary). An unknown world or no world at all draws from every
 * placeholder photo. Always returns a piece. (The flyer picker reads the
 * illustrations through artInWorld / artForPicker, not this.)
 */
export function artForWorld(world: string | null | undefined, seed?: string | number | null): ArtPiece {
  const tile = WORLD_PHOTOS[world as WorldKey];
  const own = placeholderPhotos(world);
  const pool = tile ? [tile, ...own] : own.length ? own : generalPhotos();
  return pool[hashSeed(seed ?? world ?? '') % pool.length];
}

/**
 * Real photographs for the eight worlds (2026-11-14 feedback: the illustrated
 * tiles "read very AI"; the owner asked for "actual pictures of black people
 * that read genuine"). These carry the world tiles, the world page heroes and
 * the org banner templates. Re-cut 2026-11-24 from the full-size Unsplash
 * originals at 1290px on the short side (mozjpeg) so they stay sharp on a 3x
 * screen. The illustrations stay for flyers and empty states.
 *
 * Source: Unsplash (Unsplash License: free to use, no attribution required).
 * Photo ids, for swapping one later: mizik UFlO384euRI, lavi-lannwit
 * b7IkZFcCRDI, kilti iVTwE98CslM, espo d-f7hjdjNjw, gastronomi iu5u3JrguHU,
 * biznis OsuDfn4vtLA, fanmi YFItC9nQK7o, eksperyans UygW_kIv2A4.
 * Kept OUT of ART on purpose so a stock photo never becomes an event flyer.
 */
// prettier-ignore
export const WORLD_PHOTOS: Record<WorldKey, ArtPiece> = {
  'mizik':        { key: 'photo-mizik',        source: require('../assets/photos/mizik.jpg'),        alt: 'A singer on stage with a trumpet player behind her', worlds: ['mizik'] },
  'lavi-lannwit': { key: 'photo-lavi-lannwit', source: require('../assets/photos/lavi-lannwit.jpg'), alt: 'Friends dancing at a crowded party', worlds: ['lavi-lannwit'] },
  'kilti':        { key: 'photo-kilti',        source: require('../assets/photos/kilti.jpg'),        alt: 'A carnival drummer in costume and paint', worlds: ['kilti'] },
  'espo':         { key: 'photo-espo',         source: require('../assets/photos/espo.jpg'),         alt: 'A young footballer dribbling on a pitch', worlds: ['espo'] },
  'gastronomi':   { key: 'photo-gastronomi',   source: require('../assets/photos/gastronomi.jpg'),   alt: 'Friends laughing over dinner and drinks', worlds: ['gastronomi'] },
  'biznis':       { key: 'photo-biznis',       source: require('../assets/photos/biznis.jpg'),       alt: 'People talking at a networking reception', worlds: ['biznis'] },
  'fanmi':        { key: 'photo-fanmi',        source: require('../assets/photos/fanmi.jpg'),        alt: 'A family in white holding their children on a bridge', worlds: ['fanmi'] },
  'eksperyans':   { key: 'photo-eksperyans',   source: require('../assets/photos/eksperyans.jpg'),   alt: 'A group of friends cheering on a dune under a blue sky', worlds: ['eksperyans'] },
};

/**
 * A world's page hero and home tile: its photograph. An unknown world (or
 * none) falls back to the seeded illustration, so this always returns a piece.
 */
export function heroArtForWorld(world: string | null | undefined): ArtPiece {
  return WORLD_PHOTOS[world as WorldKey] || artForWorld(world, world);
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
  if (!world) return null;
  return heroArtForWorld(world);
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
 * The picture for an empty Home / Discover feed. PEOPLE ONLY (owner,
 * 2026-11-24: "removing all the citadelle laferriere pics and all that, we
 * want pictures of people, not objects"). The landmark and scenery photos the
 * place map used to show (Citadelle, Sans-Souci, cathedrals, beaches,
 * skylines, statues) are gone; every place now gets a crowd, a stage, a
 * carnival or friends, rotating once a day and seeded by the place so two
 * cities do not show the same photo on the same day. Montréal keeps Tabou
 * Combo on its Nuits d'Afrique stage, the one place photo that is people.
 *
 * Uncaptioned on purpose: these photos are not OF the place, so they never
 * name one.
 */
// prettier-ignore
const PLACE_PEOPLE = [
  'photo-lavi-crowd', 'photo-flag-crowd', 'photo-kilti-parade', 'photo-mizik-tabou',
  'photo-lavi-confetti', 'photo-kilti-pap', 'photo-mizik-flag', 'photo-lavi-friends',
  'photo-kilti-drum', 'photo-espo-sand',
];
// prettier-ignore
const PLACE_ART_BY_METRO: Record<string, string> = {
  'ca-montreal': 'photo-montreal',
};

/** Today as a seed, so a rotating place changes once a day, not per render. */
const daySeed = () => new Date().toISOString().slice(0, 10);

/**
 * The photo for the active place. Accepts a Metro (or anything with an `id`
 * and `label`), a city string, or nothing. Always returns a piece of people.
 */
export function artForPlace(
  place: { id?: string; label?: string; cities?: string[]; country?: string } | string | null | undefined,
  city?: string | null,
  seed: string = daySeed()
): ArtPiece {
  const metroId = place && typeof place === 'object' ? place.id : undefined;
  const own = metroId ? PLACE_ART_BY_METRO[metroId] : undefined;
  if (own && !city) return artByKey(own)!;
  const placeName = city || (typeof place === 'string' ? place : place?.label || metroId || '');
  const key = PLACE_PEOPLE[hashSeed(`${seed}|${placeName}`) % PLACE_PEOPLE.length];
  // Drop any caption: the photo is not of this place.
  const piece = artByKey(key)!;
  return piece.place ? { ...piece, place: undefined } : piece;
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
