/**
 * May an event appear in anything social: a friend-activity rail, a "friends
 * going" count, a push to an organizer's followers? Only if it is publicly
 * listed. A password-protected or unlisted event is shared by link on purpose;
 * surfacing it to people who were not given the link would defeat that.
 *
 * Pure (no Firestore), shared by lib/social/friend-activity.ts and the
 * publish route's follower push.
 */
import { isPubliclyListed } from '@/lib/home/new-on-tikem'
import { guestlistVisibilityFrom } from '@/lib/guestlistVisibility'

/**
 * TODO(unlisted): an explicit "Unlisted" event field is arriving in a separate
 * PR. Until then every shape that could mean it is read defensively here, so
 * whichever name lands is already honoured; tighten to the real field after.
 */
export function isUnlistedOrPrivate(e: Record<string, any> | null | undefined): boolean {
  if (!e) return true
  if (e.is_password_protected === true) return true
  if (e.unlisted === true || e.is_unlisted === true || e.is_private === true) return true
  const v = String(e.visibility || e.listing || '').toLowerCase()
  return v === 'unlisted' || v === 'private' || v === 'link' || v === 'hidden'
}

/** Publicly listed AND not shared-by-link-only. */
export function isSociallyVisibleEvent(e: Record<string, any> | null | undefined): boolean {
  return !!e && isPubliclyListed(e) && !isUnlistedOrPrivate(e)
}

/**
 * Showing WHO is going additionally needs the organizer's permission: the
 * guest list set to show faces (not "count only" or "hidden").
 */
export function eventShowsAttendees(e: Record<string, any> | null | undefined): boolean {
  return isSociallyVisibleEvent(e) && guestlistVisibilityFrom(e || {}) === 'faces'
}
