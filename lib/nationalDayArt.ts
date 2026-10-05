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
}

export function nationalDayArt(day: NationalDay): NationalDayArt {
  const key = nationalDayArtKey(day, (k) => k in NATIONAL_DAY_ART)
  return NATIONAL_DAY_ART[key] ?? NATIONAL_DAY_ART.vertieres
}
