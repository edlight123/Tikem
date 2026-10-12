/**
 * Per-market fee terms as the admin edits them (US, CA, FR).
 *
 * Since 2026-10-11 every event in these countries is priced from
 * `platform_settings.markets[market]` (types/platform-settings.ts
 * locationFeesForCountry), not from the legacy `usCanada` rate, so this is what
 * the admin settings form writes. The fixed fee is stored only under the
 * market's own currency, in minor units, so it can never be applied in the
 * wrong unit (lib/checkout/fee-config-store.ts sanitizeMarkets reads the same
 * shape).
 */

import { FEE_MARKETS, type FeeMarket, type LocationFeeConfig } from '@/types/platform-settings'

/** The currency each fee market prices in — the unit of its fixed fee. */
export const FEE_MARKET_CURRENCY: Record<FeeMarket, 'USD' | 'CAD' | 'EUR'> = {
  US: 'USD',
  CA: 'CAD',
  FR: 'EUR',
}

export const MAX_HOLD_DAYS = 365
/** A fixed fee above this (minor units) is a typo, not a price: 100.00. */
export const MAX_FIXED_FEE_MINOR = 10_000

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

function parseMarket(market: FeeMarket, raw: unknown): ParseResult<LocationFeeConfig> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `${market} must be an object` }
  }
  const obj = raw as Record<string, unknown>
  const allowed = new Set(['platformFeePercentage', 'settlementHoldDays', 'fixedFeeMinorPerTicket'])
  const extra = Object.keys(obj).filter((k) => !allowed.has(k))
  if (extra.length) return { ok: false, error: `${market}: unknown field(s) ${extra.join(', ')}` }

  const fee = obj.platformFeePercentage
  if (typeof fee !== 'number' || !Number.isFinite(fee) || fee < 0 || fee >= 1) {
    return { ok: false, error: `Invalid ${market} platform fee percentage (must be at least 0 and below 1)` }
  }
  const hold = obj.settlementHoldDays
  if (typeof hold !== 'number' || !Number.isInteger(hold) || hold < 0 || hold > MAX_HOLD_DAYS) {
    return { ok: false, error: `Invalid ${market} settlement hold days (integer 0-${MAX_HOLD_DAYS})` }
  }

  const currency = FEE_MARKET_CURRENCY[market]
  const fixedRaw = obj.fixedFeeMinorPerTicket
  if (!fixedRaw || typeof fixedRaw !== 'object' || Array.isArray(fixedRaw)) {
    return { ok: false, error: `${market}: fixedFeeMinorPerTicket must be an object keyed by ${currency}` }
  }
  const fixedKeys = Object.keys(fixedRaw as object)
  if (fixedKeys.length !== 1 || fixedKeys[0] !== currency) {
    return { ok: false, error: `${market}: the fixed fee must be in ${currency} only` }
  }
  const fixed = (fixedRaw as Record<string, unknown>)[currency]
  if (typeof fixed !== 'number' || !Number.isInteger(fixed) || fixed < 0 || fixed > MAX_FIXED_FEE_MINOR) {
    return { ok: false, error: `Invalid ${market} fixed fee (whole ${currency} minor units, 0-${MAX_FIXED_FEE_MINOR})` }
  }

  return {
    ok: true,
    value: { platformFeePercentage: fee, settlementHoldDays: hold, fixedFeeMinorPerTicket: { [currency]: fixed } },
  }
}

/**
 * Validate a `markets` patch. Every market present must be complete; markets
 * absent are left as stored. Unknown markets are refused.
 */
export function parseMarketsInput(raw: unknown): ParseResult<Partial<Record<FeeMarket, LocationFeeConfig>>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'markets must be an object' }
  }
  const obj = raw as Record<string, unknown>
  const unknown = Object.keys(obj).filter((k) => !(FEE_MARKETS as readonly string[]).includes(k))
  if (unknown.length) return { ok: false, error: `Unknown market(s): ${unknown.join(', ')}` }

  const out: Partial<Record<FeeMarket, LocationFeeConfig>> = {}
  for (const market of FEE_MARKETS) {
    if (obj[market] === undefined) continue
    const parsed = parseMarket(market, obj[market])
    if (!parsed.ok) return parsed
    out[market] = parsed.value
  }
  if (Object.keys(out).length === 0) return { ok: false, error: 'markets is empty' }
  return { ok: true, value: out }
}
