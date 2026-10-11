import { normalizeCountryCode } from '@/lib/payment-provider'

export type EventCurrency = 'USD' | 'CAD' | 'HTG' | 'EUR'

/**
 * Currencies an event may be priced in, per country. Mirrors
 * `isCurrencyAllowedForCountry` in firestore.rules exactly (which already
 * accepted FR → EUR before this module did) and the `currencies` column of
 * lib/country-support.ts:
 *
 *   HT → USD or HTG   (HTG is charged as USD at the Stripe/Sogepay rate)
 *   US → USD
 *   CA → CAD
 *   FR → EUR
 *   anything else → USD
 *
 * Haiti keeps USD first so `normalizeEventCurrencyForCountry('HT', junk)` still
 * falls back to USD, as it always has; the composer picks HTG as the Haiti
 * DEFAULT separately (country-support's `defaultCurrency`).
 */
export function getAllowedEventCurrencies(country: unknown): EventCurrency[] {
  const code = normalizeCountryCode(country)
  if (code === 'CA') return ['CAD']
  if (code === 'US') return ['USD']
  if (code === 'FR') return ['EUR']
  if (code === 'HT') return ['USD', 'HTG']
  return ['USD']
}

export function normalizeEventCurrencyForCountry(country: unknown, currency: unknown): EventCurrency {
  const allowed = getAllowedEventCurrencies(country)
  const upper = String(currency || '').trim().toUpperCase() as EventCurrency
  if (allowed.includes(upper)) return upper
  return allowed[0]
}

export function isEventCurrencyAllowedForCountry(country: unknown, currency: unknown): boolean {
  const allowed = getAllowedEventCurrencies(country)
  const upper = String(currency || '').trim().toUpperCase() as EventCurrency
  return allowed.includes(upper)
}
