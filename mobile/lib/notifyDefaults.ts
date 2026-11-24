/**
 * What an unset notification switch means, as the server reads it
 * (lib/notifications/userPreferences.ts readUserNotifyPref; keep in step).
 *
 * Unset is on, except "events near you", the weekend digest and the organizer
 * season nudge for people in Canada or France: promotional messages there need
 * an express yes (CASL, CNIL), so those start off until the person turns them
 * on. An explicit true/false on the user doc always wins.
 */
export const CONSENT_MARKETS: ReadonlySet<string> = new Set(['CA', 'FR']);

export const CONSENT_MARKET_OPT_IN_FIELDS: ReadonlySet<string> = new Set([
  'notify_discovery',
  'notify_weekend_digest',
  'notify_organizer_season',
]);

export function inConsentMarket(data: Record<string, any> | null | undefined): boolean {
  return [data?.default_country, data?.defaultCountry, data?.last_seen_country].some((c) =>
    CONSENT_MARKETS.has(String(c || '').trim().toUpperCase()),
  );
}

/** The switch's value on this user doc, with the server's default when unset. */
export function readNotifyPref(data: Record<string, any> | null | undefined, field: string): boolean {
  const v = data?.[field];
  if (typeof v === 'boolean') return v;
  return !(CONSENT_MARKET_OPT_IN_FIELDS.has(field) && inConsentMarket(data));
}
