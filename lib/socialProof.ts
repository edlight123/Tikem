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

export function shouldShowGoingCount(totalGoing: number, capacity: number | null | undefined): boolean {
  const cap = Number(capacity) || 0
  if (cap <= 0 || totalGoing <= 0) return false
  return totalGoing / cap >= GOING_COUNT_MIN_SHARE
}
