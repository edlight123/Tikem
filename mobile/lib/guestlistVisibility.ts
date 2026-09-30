/**
 * How much of the guest list an event shows the public.
 *
 * Mirror of the web's lib/guestlistVisibility.ts, and it has to stay one: both
 * apps read and write the same event doc. The field used to be one boolean,
 * `show_guestlist`; the web replaced it with three states and mobile kept
 * writing only the boolean. Because the web resolver lets `guestlist_visibility`
 * win whenever it is present, an event created on the web and then switched
 * "off" on mobile kept showing its faces on the web page — mobile's write was
 * shadowed. Writing both fields from here closes that.
 */

export type GuestlistVisibility = 'faces' | 'count' | 'hidden';

export const GUESTLIST_VISIBILITIES: readonly GuestlistVisibility[] = ['faces', 'count', 'hidden'];

/**
 * Resolve the mode for an event document. The new field wins when present,
 * then the legacy boolean (`false` means 'hidden', never 'count' — an organizer
 * who switched it off asked for nothing), then the default.
 */
export function guestlistVisibilityFrom(data: {
  guestlist_visibility?: unknown;
  show_guestlist?: unknown;
} | null | undefined): GuestlistVisibility {
  const v = data?.guestlist_visibility;
  if (v === 'faces' || v === 'count' || v === 'hidden') return v;
  if (data?.show_guestlist === false) return 'hidden';
  return 'faces';
}

/** The legacy boolean to write alongside a mode, so old readers stay correct. */
export const showGuestlistFor = (v: GuestlistVisibility) => v !== 'hidden';

/** faces -> count -> hidden -> faces. */
export const nextGuestlistVisibility = (v: GuestlistVisibility): GuestlistVisibility =>
  GUESTLIST_VISIBILITIES[(GUESTLIST_VISIBILITIES.indexOf(v) + 1) % GUESTLIST_VISIBILITIES.length];
