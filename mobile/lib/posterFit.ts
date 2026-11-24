/**
 * How an event poster sits in its frame (components/PosterImage). Same rule as
 * the website's components/ui/PosterImage.
 *
 * - Every poster fills the frame (`cover`): photos, square flyers, 2:3
 *   portraits (owner, 2026-11-23: "zoom the images so they fill the 4:5").
 * - Only a very tall Stories flyer (9:16), which would lose about a third of
 *   its height (usually the date), shows whole (`contain`); PosterImage puts a
 *   blurred copy behind it.
 */

// Narrower than this (width / height) is a Stories flyer: show it whole.
// 9:16 = 0.5625; a 2:3 portrait (0.667) still fills.
const STORIES_MAX_RATIO = 0.6;

/** `ratio` and `frameRatio` are width / height; undefined = not loaded yet. */
export function posterFit(ratio: number | undefined, frameRatio: number): 'cover' | 'contain' {
  if (ratio === undefined) return 'cover';
  if (ratio < STORIES_MAX_RATIO && frameRatio >= STORIES_MAX_RATIO) return 'contain';
  return 'cover';
}
