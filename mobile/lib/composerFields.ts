/**
 * Pure helpers the mobile event composer uses to read an event back into the
 * editor and to stamp fields the web composer also writes. Kept out of the
 * screen so they can be tested next to their web counterparts
 * (__tests__/mobile-composer-fields.test.ts).
 */

/**
 * IANA zone per market, and the cities whose zone differs from it. Mirrors
 * lib/home/feed.ts (ZONE_BY_COUNTRY / ZONE_BY_CITY / eventZone): the web event
 * page, the discover cards and the reminder emails print an event's times in
 * its stored `timezone`, so the zone mobile stamps must be the one the web
 * would have derived for the same place.
 */
const ZONE_BY_COUNTRY: Record<string, string> = {
  HT: 'America/Port-au-Prince',
  US: 'America/New_York',
  CA: 'America/Toronto',
  FR: 'Europe/Paris',
  DO: 'America/Santo_Domingo',
};
const DEFAULT_ZONE = ZONE_BY_COUNTRY.HT;

const ZONE_BY_CITY: Record<string, string> = {
  'los angeles': 'America/Los_Angeles',
  houston: 'America/Chicago',
  chicago: 'America/Chicago',
  vancouver: 'America/Vancouver',
  calgary: 'America/Edmonton',
};

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const fold = (v: unknown) =>
  str(v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
const stripRegion = (city: string) => city.replace(/,\s*[A-Z]{2}$/, '').trim();

/** The zone an event at this place happens in: its city's, else its country's. */
export function zoneForPlace(country: unknown, city: unknown): string {
  const byCity = ZONE_BY_CITY[fold(stripRegion(str(city)))];
  return byCity || ZONE_BY_COUNTRY[str(country).toUpperCase()] || DEFAULT_ZONE;
}

/**
 * The `timezone` to save. The composer used to stamp 'America/Port-au-Prince'
 * on every event, so a Paris event's times printed six hours early on the web
 * page and in reminder emails, and a mobile edit overwrote the zone the web
 * composer had stored. Now the zone follows the place: a stored zone is kept
 * only while the event is still in the same country and city it was stored
 * for (the web may have stamped an organizer's chosen default zone there), and
 * never when it is that old blanket Haiti value on a non-Haiti event.
 */
export function resolveEventTimezone(params: {
  stored?: unknown;
  storedCountry?: unknown;
  storedCity?: unknown;
  country: unknown;
  city: unknown;
}): string {
  const country = str(params.country).toUpperCase() || 'HT';
  const stored = str(params.stored).trim();
  const samePlace =
    !!stored &&
    (str(params.storedCountry).toUpperCase() || 'HT') === country &&
    fold(params.storedCity) === fold(params.city);
  const legacyBlanket = stored === DEFAULT_ZONE && country !== 'HT';
  if (samePlace && !legacyBlanket && isIanaZone(stored)) return stored;
  return zoneForPlace(country, params.city);
}

function isIanaZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a stored event is an RSVP event. `is_rsvp` decides when present
 * (mobile has always written it; the web does now); older web RSVPs only carry
 * `ticket_name: 'RSVP'`. Mirrors lib/tickets/rsvp-tier.ts isRsvpEvent. Reading
 * only `is_rsvp` opened a web RSVP in the tickets editor with a made-up
 * 100-seat General Admission tier, which a save then wrote back.
 */
export function isRsvpEvent(event: { is_rsvp?: unknown; ticket_name?: unknown } | null | undefined): boolean {
  if (typeof event?.is_rsvp === 'boolean') return event.is_rsvp;
  return event?.ticket_name === 'RSVP';
}

/**
 * The attendance cap an RSVP event loads into the editor, as the string the
 * capacity field holds. The RSVP tier's own cap wins (unlimited reads back as
 * the sentinel); without a tier (a web RSVP, which has none) the event-level
 * total decides, and 0 / missing there means unlimited — not the "0" that
 * failed validation and forced the organizer to invent a cap.
 */
export function rsvpCapacityFrom(
  event: { total_tickets?: unknown; capacity?: unknown } | null | undefined,
  rsvpTier: { unlimited?: unknown; total_quantity?: unknown; quantity?: unknown } | null | undefined,
  sentinel: string
): string {
  if (rsvpTier) {
    const q = Number(rsvpTier.total_quantity ?? rsvpTier.quantity ?? 0);
    if (rsvpTier.unlimited === true || !(q > 0) || q >= Number(sentinel)) return sentinel;
    return String(Math.floor(q));
  }
  const total = Number(event?.total_tickets ?? event?.capacity ?? 0);
  if (!(total > 0) || total >= Number(sentinel)) return sentinel;
  return String(Math.floor(total));
}

/**
 * A tier's blurb as the editor should show it. Mobile used to save the tier
 * NAME as its description when none was typed, so every such tier read back
 * (and showed at checkout) as "VIP — VIP". A description equal to the name is
 * that placeholder, not something the organizer wrote.
 */
export function tierDescriptionFrom(tier: { name?: unknown; description?: unknown } | null | undefined): string {
  const description = str(tier?.description).trim();
  if (!description) return '';
  return description === str(tier?.name).trim() ? '' : description;
}
