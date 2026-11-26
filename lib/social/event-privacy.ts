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
import { isUnlisted } from '@/lib/events/visibility'

/**
 * Shared by link on purpose: password-protected, or Unlisted
 * (lib/events/visibility: show_on_explore false).
 */
export function isUnlistedOrPrivate(e: Record<string, any> | null | undefined): boolean {
  if (!e) return true
  if (e.is_password_protected === true) return true
  return isUnlisted(e)
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
