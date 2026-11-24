/**
 * Real photographs for everything that is NOT an organizer's own poster: the
 * places (Home / Discover empty feeds), the national days (the Home banner,
 * the day's event list, the login backdrop) and the big empty states.
 *
 * 2026-11-16, owner: "for the placeholder images for national days, events
 * and important cities in Haiti, aim for actual pictures instead of made up
 * ones." The screenprint illustrations in lib/artLibrary stay for the flyer
 * picker (an organizer choosing a poster) and as the fallback.
 *
 * PEOPLE ONLY since 2026-11-24 (owner: "we want pictures of people, not
 * objects"): the landmark, scenery, statue and food photos were removed.
 *
 * Every photo is a real picture of what its caption says. Sources: Unsplash
 * (Unsplash License) and Wikimedia Commons (public domain, CC BY, CC BY-SA).
 * Authors and licenses live in lib/photoCredits.ts (same keys) and are shown
 * on Profile → Photo credits, which CC BY / BY-SA requires. Adding or swapping
 * a photo means a row there too.
 *
 * Files are 900x1200 (3:4) progressive JPEGs in assets/photos/{places,days,
 * worlds}. Keys start with "photo-", so artByKey() can tell them from art.
 * Kept out of ART on purpose so a stock photo never becomes an event flyer.
 */
import type { ArtPiece, WorldKey } from './artLibrary';

// prettier-ignore
const PHOTO_LIST: ArtPiece[] = [
  { key: "photo-montreal", source: require('../assets/photos/places/montreal.jpg'), alt: "Tabou Combo on stage at the Nuits d'Afrique festival in Montréal", worlds: [], place: "Nuits d'Afrique · Montréal" },
  { key: "photo-flag-crowd", source: require('../assets/photos/places/flag-crowd.jpg'), alt: "A Haitian flag held up in a festival crowd", worlds: [] },
  { key: "photo-nwel", source: require('../assets/photos/days/nwel.jpg'), alt: "A family laughing together in front of a Christmas tree", worlds: [], place: "Nwèl" },
  { key: "photo-mizik-tabou", source: require('../assets/photos/worlds/mizik-tabou.jpg'), alt: "Tabou Combo performing in white suits on a festival stage", worlds: ['mizik'] },
  { key: "photo-mizik-flag", source: require('../assets/photos/worlds/mizik-flag.jpg'), alt: "A saxophonist playing among Haitian flags", worlds: ['mizik'] },
  { key: "photo-mizik-sax", source: require('../assets/photos/worlds/mizik-sax.jpg'), alt: "A saxophonist in a straw hat playing at the kanaval", worlds: ['mizik'] },
  { key: "photo-lavi-crowd", source: require('../assets/photos/worlds/lavi-crowd.jpg'), alt: "A crowd cheering at a packed concert", worlds: ['lavi-lannwit'] },
  { key: "photo-lavi-confetti", source: require('../assets/photos/worlds/lavi-confetti.jpg'), alt: "Friends celebrating under confetti at a party", worlds: ['lavi-lannwit'] },
  { key: "photo-lavi-friends", source: require('../assets/photos/worlds/lavi-friends.jpg'), alt: "Four friends laughing together in front of a mural", worlds: ['lavi-lannwit', 'eksperyans'] },
  { key: "photo-kilti-parade", source: require('../assets/photos/worlds/kilti-parade.jpg'), alt: "Dancers in ruffled dresses leading a kanaval parade", worlds: ['kilti'] },
  { key: "photo-kilti-pap", source: require('../assets/photos/worlds/kilti-pap.jpg'), alt: "Dancers in yellow at the Port-au-Prince carnival", worlds: ['kilti'] },
  { key: "photo-kilti-fire", source: require('../assets/photos/worlds/kilti-fire.jpg'), alt: "A fire-breather at a carnival parade", worlds: ['kilti'] },
  { key: "photo-kilti-drum", source: require('../assets/photos/worlds/kilti-drum.jpg'), alt: "A drummer in a straw hat playing at the carnival", worlds: ['kilti'] },
  { key: "photo-kilti-dancers", source: require('../assets/photos/worlds/kilti-dancers.jpg'), alt: "Local dancers in bright costumes performing in Labadee", worlds: ['kilti'] },
  { key: "photo-espo-sand", source: require('../assets/photos/worlds/espo-sand.jpg'), alt: "Young men playing football on a sand pitch", worlds: ['espo'] },
  { key: "photo-espo-night", source: require('../assets/photos/worlds/espo-night.jpg'), alt: "A pickup basketball game under the lights at night", worlds: ['espo'] },
  { key: "photo-espo-beach", source: require('../assets/photos/worlds/espo-beach.jpg'), alt: "People playing football on a tropical beach", worlds: ['espo', 'eksperyans'] },
  { key: "photo-espo-match", source: require('../assets/photos/worlds/espo-match.jpg'), alt: "Footballers competing for the ball in a stadium match", worlds: ['espo'] },
  { key: "photo-gastronomi-grill", source: require('../assets/photos/worlds/gastronomi-grill.jpg'), alt: "A cook pouring sauce over shredded meat at a street-food stall", worlds: ['gastronomi'] },
  { key: "photo-biznis-panel", source: require('../assets/photos/worlds/biznis-panel.jpg'), alt: "An audience watching a panel discussion on stage", worlds: ['biznis'] },
  { key: "photo-biznis-applause", source: require('../assets/photos/worlds/biznis-applause.jpg'), alt: "People applauding at a business conference", worlds: ['biznis'] },
  { key: "photo-biznis-talk", source: require('../assets/photos/worlds/biznis-talk.jpg'), alt: "Two professionals talking at a reception", worlds: ['biznis'] },
  { key: "photo-biznis-stage", source: require('../assets/photos/worlds/biznis-stage.jpg'), alt: "A speaker on a dark stage", worlds: ['biznis'] },
  { key: "photo-fanmi-shoulders", source: require('../assets/photos/worlds/fanmi-shoulders.jpg'), alt: "A family in a garden, a little girl up on a man's shoulders", worlds: ['fanmi'] },
  { key: "photo-fanmi-kids", source: require('../assets/photos/worlds/fanmi-kids.jpg'), alt: "A smiling girl with her arms raised among other children", worlds: ['fanmi'] },
  { key: "photo-fanmi-school", source: require('../assets/photos/worlds/fanmi-school.jpg'), alt: "Schoolgirls in uniform laughing together in Port-au-Prince", worlds: ['fanmi'] },
];

const PHOTOS: Record<string, ArtPiece> = Object.fromEntries(PHOTO_LIST.map((p) => [p.key, p]));

/** One photo by key ("photo-…"), or undefined. */
export function photoByKey(key: string | null | undefined): ArtPiece | undefined {
  return key ? PHOTOS[key] : undefined;
}

/** Every photo, in manifest order. */
export function allPhotos(): ArtPiece[] {
  return PHOTO_LIST.slice();
}

/** The photo for each national day (lib/nationalDays keys). */
// prettier-ignore
const NATIONAL_DAY_PHOTOS: Record<string, string> = {
  // People only (owner 2026-11-24): no statues, monuments, food or objects.
  independence: 'photo-mizik-flag',    // music among Haitian flags
  ancestors:    'photo-kilti-drum',
  kanaval:      'photo-kilti-parade',
  easter:       'photo-fanmi-kids',
  toussaint:    'photo-flag-crowd',
  labour:       'photo-gastronomi-grill', // a cook at work
  flag:         'photo-flag-crowd',      // the bicolour, held up in a crowd
  assumption:   'photo-fanmi-shoulders',
  dessalines:   'photo-mizik-flag',
  allsaints:    'photo-kilti-drum',
  morts:        'photo-kilti-drum',
  vertieres:    'photo-flag-crowd',
  discovery:    'photo-kilti-dancers',
  noel:         'photo-nwel',
};

/** The day's photo, or undefined when it has none (it keeps its illustration). */
export function nationalDayPhoto(dayKey: string | null | undefined): ArtPiece | undefined {
  return dayKey ? photoByKey(NATIONAL_DAY_PHOTOS[dayKey]) : undefined;
}

/**
 * Photos per world for placeholders (the big empty states, an empty curated
 * feed). The world's own tile photo (WORLD_PHOTOS) joins them in artForWorld.
 */
// prettier-ignore
const PLACEHOLDER_PHOTOS: Record<WorldKey, string[]> = {
  'mizik':        ['photo-mizik-tabou', 'photo-mizik-flag', 'photo-mizik-sax'],
  'lavi-lannwit': ['photo-lavi-crowd', 'photo-lavi-confetti', 'photo-lavi-friends'],
  'kilti':        ['photo-kilti-parade', 'photo-kilti-pap', 'photo-kilti-fire', 'photo-kilti-drum', 'photo-kilti-dancers'],
  'espo':         ['photo-espo-sand', 'photo-espo-night', 'photo-espo-beach', 'photo-espo-match'],
  'gastronomi':   ['photo-gastronomi-grill'],
  'biznis':       ['photo-biznis-panel', 'photo-biznis-applause', 'photo-biznis-talk', 'photo-biznis-stage'],
  'fanmi':        ['photo-fanmi-shoulders', 'photo-fanmi-kids', 'photo-fanmi-school'],
  'eksperyans':   ['photo-espo-beach', 'photo-lavi-friends'],
};

/** A world's placeholder photos; empty for an unknown world (or none). */
export function placeholderPhotos(world: string | null | undefined): ArtPiece[] {
  const keys = (world && PLACEHOLDER_PHOTOS[world as WorldKey]) || [];
  return keys.map((k) => PHOTOS[k]).filter(Boolean);
}

/** Every placeholder photo, for a seed with no world. Never empty. */
export function generalPhotos(): ArtPiece[] {
  return Object.values(PLACEHOLDER_PHOTOS)
    .flat()
    .map((k) => PHOTOS[k])
    .filter(Boolean);
}
