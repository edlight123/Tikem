import { normalizeEventCurrencyForCountry } from '@/lib/currency-policy'

/**
 * An event EDIT payload with the money-defining fields taken from the STORED
 * event (web composer; mobile/lib/api/events.ts mirrors the sold-event rule).
 *
 * - country: always the stored one. The web composer cannot choose a country,
 *   and it used to stamp 'HT' over US/CA events on every save.
 * - currency: the stored one once the event has sold (tickets_sold, the
 *   server's counter) — firestore.rules refuses a change then, and payouts
 *   value each sale in the currency it was sold in. Before any sale the
 *   organizer's choice stands, normalised for the stored country.
 *
 * A field missing on the stored doc is left out of the payload (unchanged).
 */
export function withStoredMoneyFields(data: Record<string, any>, stored: any): Record<string, any> {
  const out: Record<string, any> = { ...data }
  const hasCountry = stored && stored.country !== undefined && stored.country !== null
  if (hasCountry) out.country = stored.country
  else delete out.country
  if (Number(stored?.tickets_sold || 0) > 0) {
    if (stored?.currency !== undefined && stored?.currency !== null) out.currency = stored.currency
    else delete out.currency
  } else if (out.currency !== undefined) {
    out.currency = normalizeEventCurrencyForCountry(hasCountry ? stored.country : 'HT', out.currency)
  }
  return out
}
