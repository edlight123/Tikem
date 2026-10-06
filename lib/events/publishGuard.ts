// Which events an organizer may (re)publish.
//
// The publish route used to run its only gate when `is_published === true` and then
// write `status` by truthiness, so any truthy non-boolean skipped the gate and a
// cancelled, rejected, frozen or auto-hidden event could be put back on sale by its
// owner (un-cancelling it after the refunds went out). These are the states only an
// admin may lift. Pure so the matrix is unit-tested.

export type PublishBlockCode =
  | 'event_cancelled'
  | 'event_rejected'
  | 'event_hidden_pending_review'
  | 'payouts_frozen'
  | 'organizer_banned'

/** True when the organizer's account is banned or barred from creating events. */
export function isOrganizerBanned(organizer: Record<string, any> | null | undefined): boolean {
  if (!organizer) return false
  return String(organizer.status || '').toLowerCase() === 'banned' || organizer.can_create_events === false
}

export function isEventCancelled(event: Record<string, any> | null | undefined): boolean {
  return String(event?.status || '').toLowerCase() === 'cancelled' || Boolean(event?.cancelled_at)
}

/**
 * Why this event may not be published by its organizer, or null when it may.
 * Admins bypass it (the route decides who is an admin).
 */
export function publishBlockReason(
  event: Record<string, any>,
  organizer: Record<string, any> | null | undefined
): PublishBlockCode | null {
  if (isEventCancelled(event)) return 'event_cancelled'
  if (event.rejected === true || String(event.status || '').toLowerCase() === 'rejected') return 'event_rejected'
  if (event.hidden_pending_review === true) return 'event_hidden_pending_review'
  if (event.payouts_frozen === true) return 'payouts_frozen'
  if (isOrganizerBanned(organizer)) return 'organizer_banned'
  return null
}

export const PUBLISH_BLOCK_MESSAGES: Record<PublishBlockCode, string> = {
  event_cancelled: 'This event was cancelled and cannot be republished. Contact support.',
  event_rejected: 'This event was rejected by moderation and cannot be republished. Contact support.',
  event_hidden_pending_review: 'This event is under review after reports and cannot be republished yet.',
  payouts_frozen: 'This event is frozen pending review and cannot be republished. Contact support.',
  organizer_banned: 'Your account cannot publish events. Contact support.',
}
