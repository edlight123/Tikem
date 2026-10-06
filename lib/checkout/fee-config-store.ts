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
  DEFAULT_PLATFORM_SETTINGS,
  type LocationFeeConfig,
} from '@/types/platform-settings'

export interface PlatformFeeConfig {
  haiti: LocationFeeConfig
  usCanada: LocationFeeConfig
}

const DEFAULTS: PlatformFeeConfig = {
  haiti: DEFAULT_PLATFORM_SETTINGS.haiti,
  usCanada: DEFAULT_PLATFORM_SETTINGS.usCanada,
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
  }
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
