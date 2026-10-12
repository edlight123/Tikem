/**
 * Platform Settings Configuration
 * 
 * Defines configurable platform-wide settings including fees and settlement times
 */

import { normalizeSupportedCountry } from '@/lib/country-support'

/**
 * Location-based fee configuration
 */
export interface LocationFeeConfig {
  /**
   * Platform fee percentage (e.g., 0.10 for 10%)
   */
  platformFeePercentage: number

  /**
   * Settlement hold days after event before funds are available
   */
  settlementHoldDays: number

  /**
   * Fixed part of the platform fee, charged once per PAID ticket, in minor units
   * of the currency the ticket is priced in (EUR 50 = €0.50). Keyed by currency
   * so a fixed amount can never be applied in the wrong unit: a currency with no
   * entry adds nothing (Haiti, and an HTG/USD Haiti event, has none). Free
   * tickets never carry it.
   */
  fixedFeeMinorPerTicket?: Record<string, number>

  /**
   * RETIRED (owner decision, 2026-10-05): the platform fee is exactly
   * `platformFeePercentage` of the ticket price, with no per-ticket cap.
   *
   * Kept only so a stored platform_settings doc that still carries the field
   * type-checks. Nothing reads it: pricing, payouts and earnings ignore it, and
   * the sanitizers drop it. Sales made while a cap existed are priced for
   * payouts by lib/fees.ts platformFeeForSale, from its own compiled-in table.
   *
   * @deprecated never applied
   */
  platformFeeCapMinorByCurrency?: Record<string, number>
}


/**
 * Payout release configuration — the knobs behind lib/payouts/release-rules.ts.
 * Admin-editable so thresholds can be tuned from the dashboard rather than a
 * deploy, and per-organizer overrides can sit on top (see PayoutReleaseOverride).
 */
export interface PayoutReleaseConfig {
  /** Hold after event end for organizers who are still new, in hours. */
  newHoldHours: number
  /** Hold after event end once established, in hours. */
  establishedHoldHours: number
  /** Clean events needed to become established. */
  establishedAfterEvents: number
  /** …or lifetime gross (minor units) needed, whichever comes first. */
  establishedAfterGrossMinor: number
  /** Lifetime gross (minor units) that makes pre-event release admin-grantable. */
  preEventEligibleGrossMinor: number
  /** Per-event gross (minor units) above which a new organizer goes to review. */
  reviewAboveGrossMinor: number
  /** Check-in ratios that route a payout to review. */
  manualCheckInReviewRatio: number
  lowAttendanceReviewRatio: number
  /**
   * Currency the MONEY thresholds above are expressed in. They are compared
   * against amounts converted into this currency, so one threshold means one
   * economic amount for every organizer — a US account and a Haitian one are
   * judged by the same bar rather than by the same raw number.
   */
  thresholdCurrency: string
  /**
   * Minor units of `thresholdCurrency` per 1 minor unit of each account currency
   * (HTG centimes → US cents), used ONLY to compare against thresholds. Payout
   * amounts are never converted: money is always paid out in the account's own
   * currency.
   *
   * The daily snapshot stores USD-per-unit, which is the same number only because
   * every supported currency has two decimal places. A zero-decimal currency
   * (JPY) would need the exponent applied before it could be added here.
   *
   * Deliberately a stored table rather than a live FX call: a rate lookup that
   * fails mid-run would change who gets paid. An admin maintains these, and the
   * value used is auditable after the fact.
   */
  referenceRates: Record<string, number>
}

/**
 * Per-organizer overrides. Any field left undefined falls through to the
 * platform PayoutReleaseConfig. Stored on the organizer document so an admin can
 * hand-tune one promoter without touching everyone.
 */
export interface PayoutReleaseOverride {
  newHoldHours?: number
  establishedHoldHours?: number
  reviewAboveGrossMinor?: number
  /** Explicit admin grant allowing payout BEFORE the event ends. */
  preEventReleaseApproved?: boolean
  /** Force every payout through review regardless of tier. */
  highRisk?: boolean
  /** Treat as established regardless of history (known promoter). */
  forceEstablished?: boolean
  updatedAt?: string
  updatedBy?: string
  note?: string
}

export const DEFAULT_PAYOUT_RELEASE_CONFIG: PayoutReleaseConfig = {
  newHoldHours: 72,
  establishedHoldHours: 24,
  establishedAfterEvents: 3,
  establishedAfterGrossMinor: 100_000,
  preEventEligibleGrossMinor: 200_000,
  reviewAboveGrossMinor: 100_000,
  manualCheckInReviewRatio: 0.8,
  lowAttendanceReviewRatio: 0.2,
  thresholdCurrency: 'USD',
  referenceRates: {
    USD: 1,
    CAD: 0.73,
    EUR: 1.08,
    GBP: 1.27,
    HTG: 0.0076,
  },
}

/**
 * Platform settings stored in Firestore
 */
export interface PlatformSettings {
  id?: string
  
  /**
   * Fee configuration for Haiti events
   */
  haiti: LocationFeeConfig
  
  /**
   * Fee configuration for US/Canada events
   */
  usCanada: LocationFeeConfig

  /**
   * Per-country fee terms that take precedence over `usCanada` (owner decision,
   * 2026-10-11: US 6% + $0.99, CA 6% + C$0.99, FR 2.5% + €0.50 per paid ticket).
   * Optional so a stored settings doc written before markets existed keeps
   * working: a missing market falls back to DEFAULT_MARKET_FEES, never to the
   * old 10% `usCanada` rate.
   */
  markets?: Partial<Record<FeeMarket, LocationFeeConfig>>

  /**
   * Minimum payout amount in cents
   */
  minimumPayoutAmount: number

  /**
   * Payout release thresholds. Optional so existing settings docs keep working;
   * readers fall back to DEFAULT_PAYOUT_RELEASE_CONFIG.
   */
  payoutRelease?: PayoutReleaseConfig
  
  /**
   * Last updated timestamp
   */
  updatedAt?: Date | FirebaseFirestore.Timestamp
  
  /**
   * Admin who last updated
   */
  updatedBy?: string
}

/** Countries with their own fee terms. Haiti keeps `haiti`; anything else, `usCanada`. */
export type FeeMarket = 'US' | 'CA' | 'FR'

export const FEE_MARKETS: readonly FeeMarket[] = ['US', 'CA', 'FR']

/**
 * Per-market fee terms (owner decision, 2026-10-11), priced against Posh,
 * Eventbrite and DICE in North America and Bizouk/Shotgun in France. Card
 * processing is still Tikèm's cost in every market.
 *
 * FR is thin: the Stripe platform account is Canadian, so a EUR card sale pays
 * about 5.95% + €0.20 (2.9% + C$0.30, +0.8% international, +2% conversion,
 * ~0.25% Connect). 2.5% + €0.50 only covers that once French sales get EU card
 * pricing (on_behalf_of with French connected accounts, or an EU entity).
 */
export const DEFAULT_MARKET_FEES: Record<FeeMarket, LocationFeeConfig> = {
  US: { platformFeePercentage: 0.06, settlementHoldDays: 7, fixedFeeMinorPerTicket: { USD: 99 } },
  CA: { platformFeePercentage: 0.06, settlementHoldDays: 7, fixedFeeMinorPerTicket: { CAD: 99 } },
  FR: { platformFeePercentage: 0.025, settlementHoldDays: 7, fixedFeeMinorPerTicket: { EUR: 50 } },
}

/** The market whose fee terms apply to an event in this country, if it has its own. */
export function feeMarketForCountry(country: unknown): FeeMarket | null {
  // 'USA', 'United States', 'France', 'Canada'... resolve like everywhere else
  // (lib/country-support.ts): a full name must not fall to the catch-all rate.
  const code = normalizeSupportedCountry(country)
  return (FEE_MARKETS as readonly string[]).includes(code) ? (code as FeeMarket) : null
}

/**
 * The fee terms for an event in `country`, from a settings object: its market
 * entry (stored, else the market default), else `haiti`/`usCanada` by location.
 */
export function locationFeesForCountry(
  settings: Pick<PlatformSettings, 'haiti' | 'usCanada' | 'markets'>,
  country: unknown
): LocationFeeConfig {
  const market = feeMarketForCountry(country)
  if (market) return settings.markets?.[market] ?? DEFAULT_MARKET_FEES[market]
  return getEventLocation(String(country || '')) === 'haiti' ? settings.haiti : settings.usCanada
}

/** Fixed fee per paid ticket for a price in `currency`, in its minor units. 0 when none. */
export function fixedFeeMinorFor(config: Partial<LocationFeeConfig> | null | undefined, currency: unknown): number {
  const code = String(currency || '').toUpperCase().trim()
  const value = Number(config?.fixedFeeMinorPerTicket?.[code])
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/**
 * Default platform settings
 */
export const DEFAULT_PLATFORM_SETTINGS: Omit<PlatformSettings, 'id' | 'updatedAt' | 'updatedBy'> = {
  haiti: {
    platformFeePercentage: 0.10,  // 10% for Haiti events
    settlementHoldDays: 0,         // No hold for Haiti events
  },
  usCanada: {
    platformFeePercentage: 0.10,  // 10% for US/Canada events
    settlementHoldDays: 7,         // 7 days hold for US/Canada events
  },
  markets: DEFAULT_MARKET_FEES,
  minimumPayoutAmount: 5000,      // $50.00 in cents
  payoutRelease: DEFAULT_PAYOUT_RELEASE_CONFIG,
}

/**
 * Location type for fee calculations
 */
export type EventLocation = 'haiti' | 'us-canada'

/**
 * Determine event location from country code
 */
export function getEventLocation(countryCode: string): EventLocation {
  const normalized = String(countryCode || '').toUpperCase().trim()
  if (normalized === 'HT' || normalized === 'HAITI' || normalizeSupportedCountry(countryCode) === 'HT') {
    return 'haiti'
  }
  return 'us-canada'
}
