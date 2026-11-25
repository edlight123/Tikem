import { isPublicHttpsUrl } from '@/lib/import/url'
import { hasAddOns } from '@/lib/addons/addOns'

/**
 * Tickets are sold somewhere else, not through Tikèm: a copy of an Eventbrite
 * event kept in sync by lib/import/eventbrite-sync (`eb_<id>`), with its
 * ticket link (`external_url`) and no Tikèm ticket tiers. Its price is only
 * shown on the card ("from $15"); Tikèm never takes the money.
 *
 * Only a SERVER-written copy counts: `imported` and `external_url` are
 * client-immutable in firestore.rules, so a client cannot dress up its own
 * event as "sold elsewhere" to skip the paid gates or point buyers at an
 * outside link. A user-typed link alone never qualifies.
 */
export function sellsTicketsElsewhere(eventData: any, tiers: any[] | null | undefined): boolean {
  if ((tiers || []).length > 0) return false
  if (eventData?.imported?.source !== 'eventbrite') return false
  return isPublicHttpsUrl(String(eventData?.external_url || ''))
}

/**
 * "Does this event take money through Tikèm?": a positive event price or any
 * tier priced above 0. Pay-at-the-door tiers are price 0 (the door amount is
 * door_price), so a door event is never paid: no Stripe gate, no payout setup.
 * An event that sells elsewhere (sellsTicketsElsewhere) is never paid here
 * either: a synced Eventbrite copy the organizer paused and put back used to
 * hit the Stripe and minimum-price gates for money it never collects.
 * Used by the publish route's paid gate.
 */
export function isPaidEvent(eventData: any, tiers: any[]): boolean {
  if (sellsTicketsElsewhere(eventData, tiers)) return false
  if ((eventData?.ticket_price || 0) > 0) return true
  // Add-ons are paid items (lib/addons/addOns.ts): an event selling them takes
  // money even when its tickets are free, so it passes the same paid gate.
  if (hasAddOns(eventData)) return true
  return tiers.some((t: any) => (t?.price || 0) > 0)
}
