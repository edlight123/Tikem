/**
 * Platform Settings Configuration
 * 
 * Defines configurable platform-wide settings including fees and settlement times
 */

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
  const normalized = countryCode.toUpperCase().trim()
  if (normalized === 'HT' || normalized === 'HAITI') {
    return 'haiti'
  }
  return 'us-canada'
}
