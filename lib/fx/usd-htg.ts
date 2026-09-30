type CachedRate = {
  baseRate: number
  fetchedAt: number
  expiresAt: number
  provider: string
}

let cache: CachedRate | null = null

function roundMoney(value: number): number {
  // Keep 2 decimals for display + downstream consistency.
  // (MonCash payloads in this codebase use `toFixed(2)`.)
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Total a list of already-rounded money amounts.
 *
 * Summing 2-decimal values reintroduces float drift — seven tickets at 3903.67
 * add up to 27325.690000000002 — and that raw Number is what a gateway payload
 * carries. Round the total, once, at the end.
 */
export function sumMoney(parts: number[]): number {
  return roundMoney(parts.reduce((total, part) => total + part, 0))
}

export type UsdToHtgRateResult = {
  baseRate: number
  effectiveRate: number
  spreadPercent: number
  provider: string
  fetchedAtIso: string
}

export async function getUsdToHtgRateWithSpread(options?: {
  spreadPercent?: number
  ttlMs?: number
  fetchUrl?: string
}): Promise<UsdToHtgRateResult> {
  const spreadPercent = typeof options?.spreadPercent === 'number' ? options.spreadPercent : 0.05
  const ttlMs = typeof options?.ttlMs === 'number' ? options.ttlMs : 10 * 60 * 1000

  const now = Date.now()
  if (cache && cache.expiresAt > now && Number.isFinite(cache.baseRate) && cache.baseRate > 0) {
    const effectiveRate = cache.baseRate * (1 + spreadPercent)
    return {
      baseRate: cache.baseRate,
      effectiveRate,
      spreadPercent,
      provider: cache.provider,
      fetchedAtIso: new Date(cache.fetchedAt).toISOString(),
    }
  }

  // NOTE: We do NOT scrape Google. Use a proper rate endpoint.
  // Default: open ER API (no key) which returns a JSON map of rates.
  const url =
    options?.fetchUrl ||
    process.env.FX_USD_HTG_URL ||
    'https://open.er-api.com/v6/latest/USD'

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    // Best-effort caching on the fetch layer too.
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`FX rate fetch failed: ${response.status} ${response.statusText}`)
  }

  const data: any = await response.json()

  // Expected shapes:
  // - open.er-api.com: { result: 'success', base_code: 'USD', rates: { HTG: 132.12 } }
  // - some APIs: { base: 'USD', rates: { HTG: ... } }
  const base = String(data?.base_code || data?.base || data?.baseCode || 'USD').toUpperCase()
  const htg = data?.rates?.HTG

  if (base !== 'USD' || typeof htg !== 'number' || !Number.isFinite(htg) || htg <= 0) {
    throw new Error('FX rate fetch returned unexpected payload (missing USD->HTG)')
  }

  const baseRate = htg
  cache = {
    baseRate,
    fetchedAt: now,
    expiresAt: now + ttlMs,
    provider: url,
  }

  const effectiveRate = baseRate * (1 + spreadPercent)

  return {
    baseRate,
    effectiveRate,
    spreadPercent,
    provider: url,
    fetchedAtIso: new Date(now).toISOString(),
  }
}

export function convertUsdToHtgAmount(usdAmount: number, effectiveRate: number): number {
  if (!Number.isFinite(usdAmount) || !Number.isFinite(effectiveRate) || effectiveRate <= 0) {
    throw new Error('Invalid conversion inputs')
  }
  return roundMoney(usdAmount * effectiveRate)
}
