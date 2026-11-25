import { providerForCountry } from '@/lib/country-support'

export type PaymentProvider = 'sogepay' | 'stripe_connect' | 'stripe'

export function normalizeCountryCode(raw: unknown): string {
  const value = String(raw || '').trim()
  if (!value) return ''

  const upper = value.toUpperCase()
  if (upper === 'HT' || upper === 'HAITI') return 'HT'
  if (upper === 'US' || upper === 'USA' || upper === 'UNITED STATES' || upper === 'UNITED_STATES') return 'US'
  if (upper === 'CA' || upper === 'CAN' || upper === 'CANADA') return 'CA'
  if (upper === 'FR' || upper === 'FRA' || upper === 'FRANCE') return 'FR'

  return upper
}

export function getPaymentProviderForEventCountry(country: unknown): PaymentProvider {
  const code = normalizeCountryCode(country)
  // Haiti uses Sogepay for card checkout (country-support models the payout rail
  // as MonCash; the card entry point is Sogepay).
  if (code === 'HT') return 'sogepay'
  // Every Stripe Connect market (US/CA/FR) resolves to destination charges.
  // Delegate the decision to the single source of truth so new Connect
  // countries don't need to be re-listed here.
  if (providerForCountry(code) === 'stripe_connect') return 'stripe_connect'
  return 'stripe'
}

/**
 * How a CARD sale on an event in this country is charged through Stripe.
 *
 *  - 'stripe_connect'  US/CA/FR: a destination charge to the organizer's own
 *                      connected account.
 *  - 'stripe_platform' Haiti: Haitian organizers cannot hold Stripe accounts, so
 *                      the card (an international Visa/Mastercard) is charged as
 *                      a plain platform charge in USD. Tikèm holds the money and
 *                      pays the organizer over the Haiti rails (MonCash, bank).
 *  - 'stripe'          anything else: a platform charge, as before.
 *
 * Separate from getPaymentProviderForEventCountry, which still names Sogepay
 * for Haiti (the Sogepay routes key on it).
 */
export type CardChargeRail = 'stripe_connect' | 'stripe_platform' | 'stripe'

export function cardChargeRailForEventCountry(country: unknown): CardChargeRail {
  const code = normalizeCountryCode(country)
  if (code === 'HT') return 'stripe_platform'
  if (providerForCountry(code) === 'stripe_connect') return 'stripe_connect'
  return 'stripe'
}

/**
 * Haiti card checkout is OFF until the owner turns it on: HAITI_CARD_ENABLED=true
 * on the server (Vercel env, then redeploy) after a real test payment. Until then
 * every Haiti card intent is refused with code 'haiti_card_unavailable'.
 * The buttons have their own build-time flags (NEXT_PUBLIC_HAITI_CARD_ENABLED on
 * the web, EXPO_PUBLIC_HAITI_CARD_ENABLED in the app). MonCash is unaffected.
 */
export function haitiCardEnabled(): boolean {
  return String(process.env.HAITI_CARD_ENABLED || '').toLowerCase() === 'true'
}

/** Default Haiti card minimum, USD. */
export const HAITI_CARD_DEFAULT_MIN_USD = 5

/**
 * The smallest Haiti card order, USD cents: HAITI_CARD_MIN_USD, default 5. The
 * Canadian platform's card fees (~2.9% + C$0.30, +0.8% intl, +2% FX) would eat
 * Tikèm's 10% on a smaller order.
 */
export function haitiCardMinUsdCents(): number {
  const raw = Number(process.env.HAITI_CARD_MIN_USD)
  const usd = Number.isFinite(raw) && raw >= 0 ? raw : HAITI_CARD_DEFAULT_MIN_USD
  return Math.round(usd * 100)
}

/**
 * The smallest HTG order a card can pay: the USD minimum at the rate charged
 * (HTG per USD), rounded UP to a whole 50 HTG so the figure shown is enough.
 */
export function haitiCardMinimumHtg(minUsdCents: number, htgPerUsd: number): number {
  return Math.ceil(((minUsdCents / 100) * htgPerUsd) / 50) * 50
}
