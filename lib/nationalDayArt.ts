// The web's copy of the art the national-day banner can show. The pieces are
// the mobile art library's own JPEGs (mobile/lib/artLibrary.ts), copied into
// public/art/national-days/; `alt` and `place` match that manifest so both
// apps caption a piece the same way. A day whose art is missing here falls
// back through nationalDayArtKey, then to the Vertières piece.

import { nationalDayArtKey, type NationalDay } from '@/lib/nationalDays'

export interface NationalDayArt {
  src: string
  alt: string
  place?: string
  /** A bright lower third: the text needs a heavier scrim. */
  scrim?: 'strong'
}

// prettier-ignore
export const NATIONAL_DAY_ART: Record<string, NationalDayArt> = {
  vertieres:     { src: '/art/national-days/vertieres.jpg',     alt: 'Capois-La-Mort charging up the hill at the Battle of Vertières', place: 'Vertières · 18 Nov 1803' },
  toussaint:     { src: '/art/national-days/toussaint.jpg',     alt: 'Toussaint Louverture on his grey horse above the army camp at dusk', place: 'Toussaint Louverture' },
  dessalines:    { src: '/art/national-days/dessalines.jpg',    alt: 'The proclamation of independence at Gonaïves at sunrise, 1 January 1804', place: 'Gonaïves · 1 Jan 1804' },
  catherineflon: { src: '/art/national-days/catherineflon.jpg', alt: 'Catherine Flon sewing the first blue and red flag by lamplight at Arcahaie', place: 'Catherine Flon · Arcahaie, 18 May 1803' },
  christophe:    { src: '/art/national-days/christophe.jpg',    alt: 'Henri Christophe on the ramparts of the Citadelle at dusk', place: 'Henri Christophe · Citadelle' },
  kanaval:       { src: '/art/national-days/kanaval.jpg',       alt: 'Kanaval dancers in horned masks and feathered wings on a Jacmel street' },
  saintpierre:   { src: '/art/national-days/saintpierre.jpg',   alt: 'Église Saint-Pierre on Place Saint-Pierre at night, with a flower vendor', place: 'Église Saint-Pierre · Pétion-Ville' },
  lakou:         { src: '/art/national-days/lakou.jpg',         alt: 'A lakou at night with a tap-tap, string lights and the Haitian flag' },
  mache:         { src: '/art/national-days/mache.jpg',         alt: "An artisans' market and community workshop" },
  labadeenight:  { src: '/art/national-days/labadeenight.jpg',  alt: 'The cove at Labadee under a full moon', place: 'Labadee' },
  kap:           { src: '/art/national-days/kap.jpg',           alt: 'Families flying handmade kap kites on a hillside at Easter', place: 'Monte kap · Pak', scrim: 'strong' },
  konbit:        { src: '/art/national-days/konbit.jpg',        alt: 'A konbit: neighbours working a hillside field together to the drum and the lanbi', place: 'Konbit' },
  kanavalchar:   { src: '/art/national-days/kanavalchar.jpg',   alt: 'A kanaval float with a konpa band, masks and a lanse kòd at night', place: 'Kanaval' },
  tontonnwel:    { src: '/art/national-days/tontonnwel.jpg',    alt: 'Tonton Nwèl handing out gifts on a porch as children carry glowing fanals', place: 'Tonton Nwèl' },
}


// Real photographs per day (mirrors mobile/lib/photoLibrary NATIONAL_DAY_PHOTOS,
// owner 2026-11-16: "actual pictures instead of made up ones"). Credits live in
// mobile/lib/photoCredits.ts. A day without one keeps its illustration.
// prettier-ignore
export const NATIONAL_DAY_PHOTOS: Record<string, NationalDayArt> = {
  independence: { src: '/art/national-days/photos/independence.jpg', alt: "A bowl of soup joumou", place: "Soup joumou", scrim: 'strong' },
  ancestors: { src: '/art/national-days/photos/ancestors.jpg', alt: "The Nèg Mawon statue blowing a conch on the Champ de Mars", place: "Nèg Mawon · Champ de Mars", scrim: 'strong' },
  kanaval: { src: '/art/national-days/photos/kanaval.jpg', alt: "A horned papier-mâché mask at the Jacmel kanaval", place: "Kanaval · Jacmel" },
  easter: { src: '/art/national-days/photos/easter.jpg', alt: "A bright kite flying over a green hillside", place: "Monte kap · Pak", scrim: 'strong' },
  toussaint: { src: '/art/national-days/photos/toussaint.jpg', alt: "The statue of Toussaint Louverture in Allada", place: "Toussaint Louverture · Allada", scrim: 'strong' },
  labour: { src: '/art/national-days/photos/labour.jpg', alt: "Farmers bringing in the rice harvest in the fields of Les Cayes", place: "Les Cayes", scrim: 'strong' },
  flag: { src: '/art/national-days/photos/flag.jpg', alt: "A Haitian flag held up in a festival crowd" },
  assumption: { src: '/art/national-days/photos/assumption.jpg', alt: "The white cathedral of Notre-Dame de l'Assomption in Les Cayes", place: "Cathédrale · Les Cayes", scrim: 'strong' },
  dessalines: { src: '/art/national-days/photos/dessalines.jpg', alt: "The equestrian statue of Jean-Jacques Dessalines on the Champ de Mars", place: "Dessalines · Champ de Mars", scrim: 'strong' },
  allsaints: { src: '/art/national-days/photos/allsaints.jpg', alt: "The cathedral dome of Cap-Haïtien seen down Rue 17", place: "Cathédrale · Cap-Haïtien" },
  morts: { src: '/art/national-days/photos/morts.jpg', alt: "The cathedral dome of Cap-Haïtien seen down Rue 17", place: "Cathédrale · Cap-Haïtien" },
  vertieres: { src: '/art/national-days/photos/vertieres.jpg', alt: "The monument to the heroes of Vertières, outside Cap-Haïtien", place: "Vertières · Cap-Haïtien", scrim: 'strong' },
  discovery: { src: '/art/national-days/photos/discovery.jpg', alt: "Boats moored in the turquoise bay at Labadee", place: "Labadee" },
  noel: { src: '/art/national-days/photos/noel.jpg', alt: "A family laughing together in front of a Christmas tree", place: "Nwèl" },
}

export function nationalDayArt(day: NationalDay): NationalDayArt {
  const photo = NATIONAL_DAY_PHOTOS[day.key]
  if (photo) return photo
  const key = nationalDayArtKey(day, (k) => k in NATIONAL_DAY_ART)
  return NATIONAL_DAY_ART[key] ?? NATIONAL_DAY_ART.vertieres
}
