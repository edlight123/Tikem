/**
 * MINIMUM PAID TICKET PRICE: mobile mirror of the web lib/min-paid-price.ts
 * (parity-tested in __tests__/min-paid-price.test.ts; keep the two in lockstep).
 *
 * US/CA: a paid tier costs at least 2.00 (USD/CAD); FR: at least 1.00 EUR, so
 * an absorbed fixed fee ($0.99, C$0.99, €0.50) can never exceed the price.
 * Free (0) is always allowed; Haiti has no minimum. The server enforces the
 * same rule at publish.
 */

import { normalizeSupportedCountry } from './countrySupport';

export const MIN_PAID_PRICE_MAJOR: Readonly<Record<'US' | 'CA' | 'FR', number>> = {
  US: 2,
  CA: 2,
  FR: 1,
};

/** Minimum paid price in major units of the event's currency, or null (Haiti, unknown). */
export function minPaidPriceFor(country: unknown): number | null {
  const code = normalizeSupportedCountry(country);
  if (code === 'US' || code === 'CA' || code === 'FR') return MIN_PAID_PRICE_MAJOR[code];
  return null;
}

/** True when `price` (major units) is a paid price below the country's minimum. Free (0) never is. */
export function isBelowMinPaidPrice(price: unknown, country: unknown): boolean {
  const min = minPaidPriceFor(country);
  if (min == null) return false;
  const n = typeof price === 'number' ? price : Number(String(price ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return false;
  return Math.round(n * 100) < Math.round(min * 100);
}
