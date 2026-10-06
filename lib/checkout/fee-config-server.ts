/**
 * SERVER-SIDE read of the fee rates in force, for seeding the pricing
 * layer (see FeeConfigProvider, rendered by the root layout).
 *
 * Cached, because the root layout renders on EVERY page: an uncached read would
 * add a Firestore round trip to every request for a value that changes perhaps
 * twice a year. In-flight requests share one promise so a cold cache under load
 * still makes exactly one read.
 *
 * The TTL is the invalidation story. Serverless instances do not share memory, so
 * an admin editing the rate cannot reach into every warm process — instead each
 * picks the change up within CACHE_TTL_MS. Anything that must be exact at the
 * moment of charging (the payment routes) reads Firestore directly rather than
 * relying on this.
 */

import { getPlatformSettings } from '@/lib/admin/platform-settings'
import type { PlatformFeeConfig } from '@/lib/checkout/fee-config-store'

const CACHE_TTL_MS = 60_000

let cached: { at: number; value: PlatformFeeConfig } | null = null
let inFlight: Promise<PlatformFeeConfig> | null = null

/**
 * The fee configuration to seed into display pricing. Never throws: a settings
 * read failing must not take a page down, and `getPlatformSettings` already falls
 * back to the compiled-in defaults on error.
 */
export async function getPlatformFeeSettings(): Promise<PlatformFeeConfig | null> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const settings = await getPlatformSettings()
      const value: PlatformFeeConfig = { haiti: settings.haiti, usCanada: settings.usCanada }
      cached = { at: Date.now(), value }
      return value
    } catch {
      // Keep whatever we last had rather than thrashing to defaults mid-session.
      return cached?.value ?? (null as unknown as PlatformFeeConfig)
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/** Drop the cache so the next read is fresh. Called after an admin edit. */
export function invalidatePlatformFeeSettings(): void {
  cached = null
}
