/**
 * MINIMUM PAID TICKET PRICE (owner decision, 2026-10-12)
 *
 * US, Canada and France charge a fixed platform fee per paid ticket ($0.99,
 * C$0.99, €0.50). An organizer who absorbs the fee on a $0.50 ticket would owe
 * more than the ticket earns. So a PAID tier there must cost at least:
 *   US / CA: 2.00 in its currency (USD / CAD)
 *   FR:      1.00 EUR
 * Free (0) is always allowed. Haiti (and any other country) has no minimum.
 *
 * Mirrored by mobile/lib/minPaidPrice.ts (parity-tested).
 */

import { normalizeSupportedCountry } from '@/lib/country-support'

/** Minimum price of a paid tier, MAJOR units of the market's currency. */
export const MIN_PAID_PRICE_MAJOR: Readonly<Record<'US' | 'CA' | 'FR', number>> = {
  US: 2,
  CA: 2,
  FR: 1,
}

/**
 * The minimum paid price for an event in `country`, in major units of its
 * currency, or null when the country has none (Haiti, unknown).
 */
export function minPaidPriceFor(country: unknown): number | null {
  const code = normalizeSupportedCountry(country)
  if (code === 'US' || code === 'CA' || code === 'FR') return MIN_PAID_PRICE_MAJOR[code]
  return null
}

/** True when `price` (major units) is a paid price below the country's minimum. Free (0) never is. */
export function isBelowMinPaidPrice(price: unknown, country: unknown): boolean {
  const min = minPaidPriceFor(country)
  if (min == null) return false
  const n = typeof price === 'number' ? price : Number(String(price ?? '').replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return false
  // Compare in minor units so 1.999999 vs 2 float noise can't slip through or block.
  return Math.round(n * 100) < Math.round(min * 100)
}

/** The first tier whose paid price is below the minimum, or null. Prices in MAJOR units. */
export function firstTierBelowMinPaidPrice<T extends { price?: unknown; name?: unknown }>(
  tiers: readonly T[] | null | undefined,
  country: unknown
): T | null {
  for (const tier of tiers || []) {
    if (isBelowMinPaidPrice(tier?.price, country)) return tier
  }
  return null
}

/** Server error code when a publish/save carries a paid price below the minimum. */
export const MIN_PAID_PRICE_ERROR_CODE = 'tier_price_below_minimum' as const

/**
 * Server-side check at publish: the first SELLABLE price (an active,
 * non-archived tier, or the event-level ticket_price when it has no tiers)
 * below the country's minimum, or null. Tier prices are stored in MAJOR units.
 */
export function publishPriceBelowMinimum(
  eventData: { ticket_price?: unknown } | null | undefined,
  tiers: ReadonlyArray<{ price?: unknown; name?: unknown; is_active?: unknown; archived?: unknown }> | null | undefined,
  country: unknown
): { price: number; tierName: string | null; minimum: number } | null {
  const minimum = minPaidPriceFor(country)
  if (minimum == null) return null
  const sellable = (tiers || []).filter((t) => t && t.is_active !== false && t.archived !== true)
  if (sellable.length > 0) {
    const tier = firstTierBelowMinPaidPrice(sellable, country)
    return tier ? { price: Number(tier.price), tierName: tier.name ? String(tier.name) : null, minimum } : null
  }
  if ((tiers || []).length === 0 && isBelowMinPaidPrice(eventData?.ticket_price, country)) {
    return { price: Number(eventData?.ticket_price), tierName: null, minimum }
  }
  return null
}
