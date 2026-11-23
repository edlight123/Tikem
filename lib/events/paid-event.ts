/**
 * "Does this event take money through Tikem?": a positive event price or any
 * tier priced above 0. Pay-at-the-door tiers are price 0 (the door amount is
 * door_price), so a door event is never paid: no Stripe gate, no payout setup.
 * Used by the publish route's paid gate.
 */
export function isPaidEvent(eventData: any, tiers: any[]): boolean {
  if ((eventData?.ticket_price || 0) > 0) return true
  return tiers.some((t: any) => (t?.price || 0) > 0)
}
