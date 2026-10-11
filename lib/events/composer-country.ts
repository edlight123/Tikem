/**
 * Country rules for the WEB event composer (app/organizer/events/EventComposer.tsx).
 *
 * Pure, framework-free and cheap to import (the composer keeps its bundle
 * light on purpose). Every rule here defers to an existing source of truth:
 *   - which countries / default currency / fee default → lib/country-support.ts
 *   - which currencies a country may be priced in     → lib/currency-policy.ts
 *     (mirrors firestore.rules `isCurrencyAllowedForCountry`)
 *   - which timezone an event is in                   → lib/home/feed.ts eventZone
 *   - whether a paid event may publish                → the server, via
 *     /api/organizer/publish-eligibility (lib/events/publish-gate.ts). The
 *     helpers below only translate its verdict into UI; they never re-decide it.
 */
import {
  countrySupport,
  defaultCurrencyForCountry,
  feeIncidenceForCountry,
  isComingSoon,
  normalizeSupportedCountry,
} from '@/lib/country-support'
import { getAllowedEventCurrencies, normalizeEventCurrencyForCountry, type EventCurrency } from '@/lib/currency-policy'
import { LOCATION_CONFIG } from '@/lib/filters/config'
import { eventZone } from '@/lib/home/feed'

/**
 * Countries an organizer can create an event in from the web composer, in
 * display order. Dominican Republic is deliberately absent: it is a
 * coming-soon, free-only market and the web composer has never offered it.
 */
export const COMPOSER_COUNTRIES = ['HT', 'US', 'CA', 'FR'] as const
export type ComposerCountry = (typeof COMPOSER_COUNTRIES)[number]

export function isComposerCountry(code: unknown): code is ComposerCountry {
  return (COMPOSER_COUNTRIES as readonly string[]).includes(String(code))
}

/** Any stored/typed country value → a composer country, or `fallback`. */
export function resolveComposerCountry(raw: unknown, fallback: ComposerCountry = 'HT'): ComposerCountry {
  const code = normalizeSupportedCountry(raw)
  return isComposerCountry(code) ? code : fallback
}

/** First non-empty candidate that resolves to a composer country, else HT. */
export function pickDefaultComposerCountry(...candidates: unknown[]): ComposerCountry {
  for (const c of candidates) {
    const code = normalizeSupportedCountry(c)
    if (isComposerCountry(code)) return code
  }
  return 'HT'
}

/** Currencies offered for a country (HT: USD + HTG; US: USD; CA: CAD; FR: EUR). */
export function composerCurrencyOptions(country: unknown): EventCurrency[] {
  return getAllowedEventCurrencies(country)
}

/** The currency a NEW event in this country starts in (HT → HTG, US → USD, CA → CAD, FR → EUR). */
export function defaultComposerCurrency(country: unknown): EventCurrency {
  return normalizeEventCurrencyForCountry(country, defaultCurrencyForCountry(country))
}

/**
 * Keep the organizer's currency when the new country allows it, else move to
 * the new country's default — a stale HTG can never ride along to a US event.
 */
export function currencyAfterCountryChange(country: unknown, current: unknown): EventCurrency {
  const allowed = getAllowedEventCurrencies(country)
  const upper = String(current || '').toUpperCase() as EventCurrency
  return allowed.includes(upper) ? upper : defaultComposerCurrency(country)
}

/** Whether the fee is passed on to the buyer BY DEFAULT in this country. */
export function defaultPassFeesToBuyer(country: unknown): boolean {
  return feeIncidenceForCountry(country) === 'buyer'
}

/**
 * The city a NEW event starts with. Only Haiti gets a prefilled city (the
 * long-standing Port-au-Prince default); everywhere else the field starts
 * empty with a local example as its placeholder.
 */
export function defaultCityForCountry(country: unknown): string {
  return resolveComposerCountry(country) === 'HT' ? 'Port-au-Prince' : ''
}

/** A local example city for the placeholder ("New York" for US, "Paris" for FR). */
export function exampleCityForCountry(country: unknown): string {
  const code = resolveComposerCountry(country)
  const cities = LOCATION_CONFIG[code]?.cities || {}
  const first = Object.keys(cities)[0]
  return (first && (cities as any)[first]?.name) || first || ''
}

/**
 * Whether `city` is just some country's untouched default (so switching
 * country may replace it) rather than something the organizer typed.
 */
export function isDefaultCity(city: string): boolean {
  const c = city.trim()
  return c === '' || COMPOSER_COUNTRIES.some((code) => defaultCityForCountry(code) === c)
}

/** IANA zone the event happens in, by city then country (same rule the event page reads). */
export function timezoneForEvent(country: unknown, city: unknown): string {
  return eventZone({ country: resolveComposerCountry(country), city })
}

export function countryDisplayName(country: unknown): string {
  return countrySupport(country)?.name || String(country || '')
}

/**
 * Haiti is "verify at the money, not at the door": a paid event may publish
 * with no identity verification (withdrawals enforce it). Stripe Connect
 * markets keep the full pre-publish gate — the server decides it, the editor
 * only mirrors the verdict.
 */
export function publishRequiresServerGate(country: unknown): boolean {
  return countrySupport(country)?.requiredProfile === 'stripe_connect'
}

/** The publish-eligibility endpoint's verdict (GET /api/organizer/publish-eligibility). */
export type PublishEligibility =
  | { allowed: true; warnings?: unknown[] }
  | { allowed: false; code?: string; reason?: string; retryable?: boolean }

export type PublishStep = 'identity' | 'stripe_connect' | 'stripe_onboarding' | 'stripe_reconnect'

/**
 * The step a blocked verdict is waiting on, or null when the block is not
 * something the organizer can act on (Stripe unreachable — retry) or unknown.
 */
export function missingPublishStep(verdict: PublishEligibility | null | undefined): PublishStep | null {
  if (!verdict || verdict.allowed) return null
  switch (verdict.code) {
    case 'verification_required':
      return 'identity'
    case 'stripe_connect_required':
      return 'stripe_connect'
    case 'stripe_onboarding_incomplete':
      return 'stripe_onboarding'
    case 'stripe_account_unavailable':
      return 'stripe_reconnect'
    default:
      return null
  }
}

/**
 * Whether the editor should disable "Publish event" for a paid event. Only a
 * definite, actionable server "no" blocks — a pending check, a network failure
 * or a retryable Stripe outage leaves the button to the publish route, which
 * is the real gate and answers with its own message.
 */
export function editorBlocksPaidPublish(params: {
  country: unknown
  isPaid: boolean
  verdict: PublishEligibility | null | undefined
}): boolean {
  if (!params.isPaid) return false
  // Haiti has no publish-time gate at all — never block it in the editor.
  if (!publishRequiresServerGate(params.country) && !isComingSoon(params.country)) return false
  const v = params.verdict
  if (!v || v.allowed) return false
  if (v.retryable) return false
  return missingPublishStep(v) !== null || v.code === 'coming_soon'
}
