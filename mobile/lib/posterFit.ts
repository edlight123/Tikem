/**
 * How an event poster sits in its frame (components/PosterImage).
 *
 * - Close to the frame's shape: fill it (`cover`).
 * - Landscape (wider than tall) in a portrait frame: a photo, fill it too.
 * - A square or Stories flyer: show it whole (`contain`) so a crop never cuts
 *   its date or venue; PosterImage puts a blurred copy behind it.
 */

// How far (relative) an image's shape may differ from the frame and still
// fill it. 12% loses a sliver at the edges, never a line of text.
const FILL_TOLERANCE = 0.12;
// Wider than this (width / height) reads as a photo: always fill.
const PHOTO_MIN_RATIO = 1.15;

/** `ratio` and `frameRatio` are width / height; undefined = not loaded yet. */
export function posterFit(ratio: number | undefined, frameRatio: number): 'cover' | 'contain' {
  if (ratio === undefined) return 'cover';
  if (Math.abs(ratio - frameRatio) / frameRatio <= FILL_TOLERANCE) return 'cover';
  if (ratio >= PHOTO_MIN_RATIO && frameRatio < PHOTO_MIN_RATIO) return 'cover';
  return 'contain';
}
