/**
 * The fee rates currently in force, readable from anywhere — including
 * the pure pricing functions and the client components that call them.
 *
 * The problem this solves: the rate is admin-editable and
 * live in Firestore, which only the server can await. Display surfaces therefore
 * used to fall back to the compiled-in defaults, so an admin changing the rate
 * would leave every advertised price quoting the old figure while checkout charged
 * the new one. The server was right and the page was wrong — a total-price problem,
 * which is the one thing the pricing work exists to prevent.
 *
 * So the resolved config is seeded ONCE per render tree (see FeeConfigProvider,
 * rendered by the root layout) and read from here by `feeConfigForCountry`. Nothing
 * at a call site changes.
 *
 * WHY A MODULE-LEVEL VALUE IS SAFE HERE: these settings are platform-wide, not
 * per-user and not per-request, so one process holding one copy cannot leak
 * anything between requests — every request would write the same value. Anything
 * that must be authoritative (the API routes that actually charge a card) still
 * reads Firestore itself and passes the config explicitly rather than trusting
 * this.
 */

import {
  DEFAULT_MARKET_FEES,
  DEFAULT_PLATFORM_SETTINGS,
  FEE_MARKETS,
  type FeeMarket,
  type LocationFeeConfig,
} from '@/types/platform-settings'

export interface PlatformFeeConfig {
  haiti: LocationFeeConfig
  usCanada: LocationFeeConfig
  /** Per-country terms (US/CA/FR). Optional on input; always filled once seeded. */
  markets?: Partial<Record<FeeMarket, LocationFeeConfig>>
}

const DEFAULTS: PlatformFeeConfig = {
  haiti: DEFAULT_PLATFORM_SETTINGS.haiti,
  usCanada: DEFAULT_PLATFORM_SETTINGS.usCanada,
  markets: DEFAULT_MARKET_FEES,
}

let current: PlatformFeeConfig = DEFAULTS

/**
 * Keep only the fee fields, and only when they are usable numbers. A stored
 * `platformFeeCapMinorByCurrency` is dropped: the per-ticket cap is retired
 * (owner decision, 2026-10-05) and must never reach a price.
 */
function sanitize(raw: unknown, fallback: LocationFeeConfig): LocationFeeConfig {
  const input = (raw || {}) as Partial<LocationFeeConfig>
  const percentage = Number(input.platformFeePercentage)
  const { platformFeeCapMinorByCurrency: _retiredCap, ...base } = fallback

  return {
    ...base,
    // A rate outside 0-100% is a corrupt setting, not an aggressive one: keep the
    // default rather than pricing every ticket from a bad number.
    platformFeePercentage:
      Number.isFinite(percentage) && percentage >= 0 && percentage < 1
        ? percentage
        : fallback.platformFeePercentage,
    fixedFeeMinorPerTicket: sanitizeFixed(input.fixedFeeMinorPerTicket, fallback.fixedFeeMinorPerTicket),
  }
}

/**
 * Per-currency fixed fees: whole, non-negative minor units only. A stored table
 * that is not an object keeps the default; a junk entry is dropped (so that
 * currency adds nothing) rather than priced.
 */
function sanitizeFixed(
  raw: unknown,
  fallback: Record<string, number> | undefined
): Record<string, number> | undefined {
  if (raw === undefined) return fallback
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback
  const out: Record<string, number> = {}
  for (const [currency, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value)
    if (Number.isFinite(n) && n >= 0 && n < 100_000) out[currency.toUpperCase()] = Math.round(n)
  }
  return out
}

function sanitizeMarkets(raw: unknown): Record<FeeMarket, LocationFeeConfig> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<FeeMarket, unknown>>
  const out = {} as Record<FeeMarket, LocationFeeConfig>
  for (const market of FEE_MARKETS) {
    out[market] = input[market] ? sanitize(input[market], DEFAULT_MARKET_FEES[market]) : DEFAULT_MARKET_FEES[market]
  }
  return out
}

/** Seed the config in force. Called by FeeConfigProvider; safe to call repeatedly. */
export function setPlatformFeeConfig(config: Partial<PlatformFeeConfig> | null | undefined): void {
  if (!config) {
    current = DEFAULTS
    return
  }
  current = {
    haiti: sanitize(config.haiti, DEFAULTS.haiti),
    usCanada: sanitize(config.usCanada, DEFAULTS.usCanada),
    markets: sanitizeMarkets(config.markets),
  }
}

/** The config in force — the seeded settings, or the compiled-in defaults. */
export function getPlatformFeeConfig(): PlatformFeeConfig {
  return current
}

/** Restore the compiled-in defaults. For tests. */
export function resetPlatformFeeConfig(): void {
  current = DEFAULTS
}
