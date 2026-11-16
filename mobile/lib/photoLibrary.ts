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
  { key: "photo-citadelle", source: require('../assets/photos/places/citadelle.jpg'), alt: "The Citadelle Laferrière on its mountain ridge, seen from the air", worlds: [], place: "Citadelle Laferrière · Milot" },
  { key: "photo-sanssouci", source: require('../assets/photos/places/sanssouci.jpg'), alt: "The ruined staircase and arches of the Sans-Souci palace", worlds: [], place: "Palais Sans-Souci · Milot" },
  { key: "photo-cap-cathedral", source: require('../assets/photos/places/cap-cathedral.jpg'), alt: "The cathedral dome of Cap-Haïtien seen down Rue 17", worlds: [], place: "Cathédrale · Cap-Haïtien" },
  { key: "photo-cap-haitien", source: require('../assets/photos/places/cap-haitien.jpg'), alt: "Cap-Haïtien and its bay seen from the hills", worlds: [], place: "Cap-Haïtien" },
  { key: "photo-jacmel", source: require('../assets/photos/places/jacmel.jpg'), alt: "Jacmel rooftops running down to the bay", worlds: [], place: "Jacmel" },
  { key: "photo-bassinbleu", source: require('../assets/photos/places/bassinbleu.jpg'), alt: "The turquoise pool and rocks of Bassin Bleu", worlds: [], place: "Bassin Bleu · Jacmel" },
  { key: "photo-labadee", source: require('../assets/photos/places/labadee.jpg'), alt: "Boats moored in the turquoise bay at Labadee", worlds: [], place: "Labadee" },
  { key: "photo-labadee-coast", source: require('../assets/photos/places/labadee-coast.jpg'), alt: "Green hills over the sea at Labadee", worlds: [], place: "Labadee" },
  { key: "photo-negmawon", source: require('../assets/photos/places/negmawon.jpg'), alt: "The Nèg Mawon statue blowing a conch on the Champ de Mars", worlds: [], place: "Nèg Mawon · Champ de Mars", scrim: 'strong' },
  { key: "photo-dessalines", source: require('../assets/photos/places/dessalines.jpg'), alt: "The equestrian statue of Jean-Jacques Dessalines on the Champ de Mars", worlds: [], place: "Dessalines · Champ de Mars", scrim: 'strong' },
  { key: "photo-petionville", source: require('../assets/photos/places/petionville.jpg'), alt: "Pétion-Ville rooftops below the mountains", worlds: [], place: "Pétion-Ville" },
  { key: "photo-kenscoff", source: require('../assets/photos/places/kenscoff.jpg'), alt: "Green mountain ridges on the road up to Kenscoff", worlds: [], place: "Kenscoff" },
  { key: "photo-foretdespins", source: require('../assets/photos/places/foretdespins.jpg'), alt: "Tall pines in the Forêt des Pins", worlds: [], place: "Forêt des Pins" },
  { key: "photo-sautdeau", source: require('../assets/photos/places/sautdeau.jpg'), alt: "The Saut-d'Eau waterfall in the forest", worlds: [], place: "Saut-d'Eau · Ville-Bonheur" },
  { key: "photo-ileavache", source: require('../assets/photos/places/ileavache.jpg'), alt: "A wooden boat on the white sand of Abaka Bay", worlds: [], place: "Abaka Bay · Île-à-Vache" },
  { key: "photo-arcadins", source: require('../assets/photos/places/arcadins.jpg'), alt: "Swimmers in the calm water of a beach on the Côte des Arcadins", worlds: [], place: "Montrouis · Côte des Arcadins" },
  { key: "photo-wahoo", source: require('../assets/photos/places/wahoo.jpg'), alt: "A fishing boat crossing the clear water of Wahoo Bay", worlds: [], place: "Wahoo Bay · Côte des Arcadins" },
  { key: "photo-lescayes", source: require('../assets/photos/places/lescayes.jpg'), alt: "The white cathedral of Notre-Dame de l'Assomption in Les Cayes", worlds: [], place: "Cathédrale · Les Cayes", scrim: 'strong' },
  { key: "photo-haiti-coast", source: require('../assets/photos/places/haiti-coast.jpg'), alt: "A town at the foot of the mountains by the sea in Haiti", worlds: [] },
  { key: "photo-sud-beach", source: require('../assets/photos/places/sud-beach.jpg'), alt: "A painted fishing boat pulled up on a beach", worlds: [] },
  { key: "photo-miami", source: require('../assets/photos/places/miami.jpg'), alt: "The painted Caribbean Marketplace on NE 2nd Avenue in Little Haiti", worlds: [], place: "Little Haiti · Miami" },
  { key: "photo-flatbush", source: require('../assets/photos/places/flatbush.jpg'), alt: "The Little Haiti sign at Newkirk Avenue station in Flatbush", worlds: [], place: "Little Haiti · Flatbush" },
  { key: "photo-boston", source: require('../assets/photos/places/boston.jpg'), alt: "The Boston skyline lit up at night across the harbor", worlds: [], place: "Boston" },
  { key: "photo-montreal", source: require('../assets/photos/places/montreal.jpg'), alt: "Tabou Combo on stage at the Nuits d'Afrique festival in Montréal", worlds: [], place: "Nuits d'Afrique · Montréal" },
  { key: "photo-saintdenis", source: require('../assets/photos/places/saintdenis.jpg'), alt: "The west front of the Basilica of Saint-Denis", worlds: [], place: "Basilique · Saint-Denis", scrim: 'strong' },
  { key: "photo-flag-crowd", source: require('../assets/photos/places/flag-crowd.jpg'), alt: "A Haitian flag held up in a festival crowd", worlds: [] },
  { key: "photo-vertieres", source: require('../assets/photos/days/vertieres.jpg'), alt: "The monument to the heroes of Vertières, outside Cap-Haïtien", worlds: [], place: "Vertières · Cap-Haïtien", scrim: 'strong' },
  { key: "photo-soupjoumou", source: require('../assets/photos/days/soupjoumou.jpg'), alt: "A bowl of soup joumou", worlds: [], place: "Soup joumou", scrim: 'strong' },
  { key: "photo-kanaval-mask", source: require('../assets/photos/days/kanaval-mask.jpg'), alt: "A horned papier-mâché mask at the Jacmel kanaval", worlds: [], place: "Kanaval · Jacmel" },
  { key: "photo-kap", source: require('../assets/photos/days/kap.jpg'), alt: "A bright kite flying over a green hillside", worlds: [], place: "Monte kap · Pak", scrim: 'strong' },
  { key: "photo-toussaint", source: require('../assets/photos/days/toussaint.jpg'), alt: "The statue of Toussaint Louverture in Allada", worlds: [], place: "Toussaint Louverture · Allada", scrim: 'strong' },
  { key: "photo-diri", source: require('../assets/photos/days/diri.jpg'), alt: "Farmers bringing in the rice harvest in the fields of Les Cayes", worlds: [], place: "Les Cayes", scrim: 'strong' },
  { key: "photo-nwel", source: require('../assets/photos/days/nwel.jpg'), alt: "A family laughing together in front of a Christmas tree", worlds: [], place: "Nwèl" },
  { key: "photo-mizik-tabou", source: require('../assets/photos/worlds/mizik-tabou.jpg'), alt: "Tabou Combo performing in white suits on a festival stage", worlds: [] },
  { key: "photo-mizik-flag", source: require('../assets/photos/worlds/mizik-flag.jpg'), alt: "A saxophonist playing among Haitian flags", worlds: [] },
  { key: "photo-mizik-sax", source: require('../assets/photos/worlds/mizik-sax.jpg'), alt: "A saxophonist in a straw hat playing at the kanaval", worlds: [] },
  { key: "photo-lavi-crowd", source: require('../assets/photos/worlds/lavi-crowd.jpg'), alt: "A crowd cheering at a packed concert", worlds: [] },
  { key: "photo-lavi-confetti", source: require('../assets/photos/worlds/lavi-confetti.jpg'), alt: "Friends celebrating under confetti at a party", worlds: [] },
  { key: "photo-lavi-friends", source: require('../assets/photos/worlds/lavi-friends.jpg'), alt: "Four friends laughing together in front of a mural", worlds: [] },
  { key: "photo-kilti-parade", source: require('../assets/photos/worlds/kilti-parade.jpg'), alt: "Dancers in ruffled dresses leading a kanaval parade", worlds: [] },
  { key: "photo-kilti-pap", source: require('../assets/photos/worlds/kilti-pap.jpg'), alt: "Dancers in yellow at the Port-au-Prince carnival", worlds: [] },
  { key: "photo-kilti-fire", source: require('../assets/photos/worlds/kilti-fire.jpg'), alt: "A fire-breather at a carnival parade", worlds: [] },
  { key: "photo-kilti-drum", source: require('../assets/photos/worlds/kilti-drum.jpg'), alt: "A drummer in a straw hat playing at the carnival", worlds: [] },
  { key: "photo-kilti-dancers", source: require('../assets/photos/worlds/kilti-dancers.jpg'), alt: "Local dancers in bright costumes performing in Labadee", worlds: [] },
  { key: "photo-espo-sand", source: require('../assets/photos/worlds/espo-sand.jpg'), alt: "Young men playing football on a sand pitch", worlds: [] },
  { key: "photo-espo-night", source: require('../assets/photos/worlds/espo-night.jpg'), alt: "A pickup basketball game under the lights at night", worlds: [] },
  { key: "photo-espo-beach", source: require('../assets/photos/worlds/espo-beach.jpg'), alt: "People playing football on a tropical beach", worlds: [] },
  { key: "photo-espo-match", source: require('../assets/photos/worlds/espo-match.jpg'), alt: "Footballers competing for the ball in a stadium match", worlds: [] },
  { key: "photo-gastronomi-griot", source: require('../assets/photos/worlds/gastronomi-griot.jpg'), alt: "A plate of griot with fried plantains", worlds: [] },
  { key: "photo-gastronomi-poul", source: require('../assets/photos/worlds/gastronomi-poul.jpg'), alt: "Poul an sòs, Haitian chicken in sauce", worlds: [] },
  { key: "photo-gastronomi-night", source: require('../assets/photos/worlds/gastronomi-night.jpg'), alt: "People eating at a lively Caribbean restaurant at night", worlds: [] },
  { key: "photo-gastronomi-grill", source: require('../assets/photos/worlds/gastronomi-grill.jpg'), alt: "A cook pouring sauce over shredded meat at a street-food stall", worlds: [] },
  { key: "photo-biznis-panel", source: require('../assets/photos/worlds/biznis-panel.jpg'), alt: "An audience watching a panel discussion on stage", worlds: [] },
  { key: "photo-biznis-applause", source: require('../assets/photos/worlds/biznis-applause.jpg'), alt: "People applauding at a business conference", worlds: [] },
  { key: "photo-biznis-talk", source: require('../assets/photos/worlds/biznis-talk.jpg'), alt: "Two professionals talking at a reception", worlds: [] },
  { key: "photo-biznis-stage", source: require('../assets/photos/worlds/biznis-stage.jpg'), alt: "A speaker on a dark stage", worlds: [] },
  { key: "photo-fanmi-shoulders", source: require('../assets/photos/worlds/fanmi-shoulders.jpg'), alt: "A family in a garden, a little girl up on a man's shoulders", worlds: [] },
  { key: "photo-fanmi-kids", source: require('../assets/photos/worlds/fanmi-kids.jpg'), alt: "A smiling girl with her arms raised among other children", worlds: [] },
  { key: "photo-fanmi-school", source: require('../assets/photos/worlds/fanmi-school.jpg'), alt: "Schoolgirls in uniform laughing together in Port-au-Prince", worlds: [] },
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
  independence: 'photo-soupjoumou',    // soup joumou, eaten on 1 January
  ancestors:    'photo-negmawon',      // Nèg Mawon, the unknown maroon
  kanaval:      'photo-kanaval-mask',  // Jacmel kanaval
  easter:       'photo-kap',           // monte kap at Easter
  toussaint:    'photo-toussaint',     // his statue in Allada
  labour:       'photo-diri',          // the rice harvest, Les Cayes
  flag:         'photo-flag-crowd',    // the bicolour, held up in a crowd
  assumption:   'photo-lescayes',      // Notre-Dame de l'Assomption, Les Cayes
  dessalines:   'photo-dessalines',    // his statue on the Champ de Mars
  allsaints:    'photo-cap-cathedral',
  morts:        'photo-cap-cathedral',
  vertieres:    'photo-vertieres',     // the real monument (Wilmeus Tamar, CC BY-SA 4.0)
  discovery:    'photo-labadee',       // the north coast
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
  'gastronomi':   ['photo-gastronomi-griot', 'photo-gastronomi-poul', 'photo-gastronomi-night', 'photo-gastronomi-grill'],
  'biznis':       ['photo-biznis-panel', 'photo-biznis-applause', 'photo-biznis-talk', 'photo-biznis-stage'],
  'fanmi':        ['photo-fanmi-shoulders', 'photo-fanmi-kids', 'photo-fanmi-school'],
  'eksperyans':   ['photo-labadee', 'photo-wahoo', 'photo-ileavache', 'photo-arcadins', 'photo-bassinbleu'],
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
