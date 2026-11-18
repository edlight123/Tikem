/**
 * When an event page may print how many people are going.
 *
 * A small number reads as "nobody's going" and talks people out of an event,
 * so the count only shows once at least half of the capacity is taken (the
 * owner's rule, 2026-10-25, the way POSH does it). Below that, and on events
 * with no capacity set, the section shows faces and "Freddy and others are
 * going" with no number. Mirrored in mobile/lib/socialProof.ts.
 */
export const GOING_COUNT_MIN_SHARE = 0.5

/**
 * `always`: the organizer turned on "Show how many are going" in the event
 * editor (event.show_going_count, owner 2026-11-18). Then any count prints,
 * whatever the capacity: an invite-only social with an "unlimited" capacity
 * never reaches half full, yet 88 going is the proof the night is real.
 */
export function shouldShowGoingCount(
  totalGoing: number,
  capacity: number | null | undefined,
  always: boolean = false
): boolean {
  if (totalGoing <= 0) return false
  if (always) return true
  const cap = Number(capacity) || 0
  if (cap <= 0) return false
  return totalGoing / cap >= GOING_COUNT_MIN_SHARE
}
