/**
 * USD → HTG rate for converting a buyer's (or an organizer's) money.
 *
 * MonCash settles in HTG, so a USD-priced Haiti event is converted at checkout
 * and USD earnings are converted at withdrawal. Both used to trust whatever one
 * provider said: no timeout, no fallback, and the only check was `rate > 0` (the
 * withdrawal side went further and silently used a hardcoded 131.58).
 *
 * The rate is now resolved in one place, under the owner's rules (2026-10-12):
 *
 *  1. LIVE. The provider is asked, with a ~3 s timeout. Its answer is accepted
 *     only inside an absolute 80–250 HTG/USD band AND, when daily snapshots
 *     exist, within ±15% of the median of the last 14 days of them. Anything
 *     else is treated as a failure, not a market move.
 *  2. SNAPSHOT FALLBACK. On failure, the HIGHEST base rate among the daily
 *     `fx_snapshots/{YYYY-MM-DD}` docs (written by /api/cron/fx-snapshot) of the
 *     past 14 days. Highest is the conservative side for Tikèm: a buyer pays a
 *     little more HTG, never less.
 *  3. Otherwise REFUSE (`FxRateUnavailableError`). Callers turn that into a
 *     clear, translated message — never a raw "FX rate fetch failed".
 *
 * The 5% spread is a pricing device for buyers' money and is applied ONCE, on
 * top of whichever base rate won. Withdrawals use the base rate, no spread.
 */

type CachedRate = {
  baseRate: number
  /** Provider (or snapshot) timestamp, ISO. */
  fetchedAtIso: string
  expiresAt: number
  provider: string
  source: UsdHtgRateSource
  /** Set on a fallback entry: a charge's highest pick must never serve a payout. */
  fallbackMode?: 'highest' | 'lowest'
}

let cache: CachedRate | null = null

/** Test hook: forget the in-memory rate. */
export function __resetUsdHtgRateCacheForTests() {
  cache = null
}

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

/** Where the base rate came from, recorded on the order/withdrawal. */
export type UsdHtgRateSource = 'live' | 'snapshot_fallback'

/** Absolute band a USD→HTG base rate must sit in to be believed at all. */
export const USD_HTG_MIN_PLAUSIBLE = 80
export const USD_HTG_MAX_PLAUSIBLE = 250
/** A live rate further than this from the 14-day median is refused. */
export const USD_HTG_MAX_DEVIATION_FROM_MEDIAN = 0.15
/** How far back the snapshot history reaches (median + fallback). */
export const USD_HTG_HISTORY_DAYS = 14
/** Provider timeout. Checkout must not hang on a slow FX endpoint. */
export const USD_HTG_FETCH_TIMEOUT_MS = 3000
/** A fallback is cached briefly so the live provider is retried soon. */
const FALLBACK_TTL_MS = 60 * 1000

export const FX_RATE_UNAVAILABLE_CODE = 'fx_rate_unavailable'

/** No trustworthy rate: the live one failed and there is no recent snapshot. */
export class FxRateUnavailableError extends Error {
  readonly code = FX_RATE_UNAVAILABLE_CODE
  constructor(message = 'No trustworthy USD to HTG exchange rate is available right now.') {
    super(message)
    this.name = 'FxRateUnavailableError'
  }
}

export function isFxRateUnavailableError(err: unknown): err is FxRateUnavailableError {
  return Boolean(err) && (err as any).code === FX_RATE_UNAVAILABLE_CODE
}

/** One day's stored base rate (HTG per 1 USD, no spread). */
export type UsdHtgSnapshotPoint = { baseRate: number; fetchedAt: string; id?: string }

export type UsdHtgSnapshotLoader = (sinceIso: string) => Promise<UsdHtgSnapshotPoint[]>

export function isPlausibleUsdHtgRate(rate: unknown): rate is number {
  return (
    typeof rate === 'number' &&
    Number.isFinite(rate) &&
    rate >= USD_HTG_MIN_PLAUSIBLE &&
    rate <= USD_HTG_MAX_PLAUSIBLE
  )
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * The HTG base rate a stored snapshot carries. `baseRates.HTG` is the raw
 * provider figure; a day whose HTG was rejected by the cron's sanity guard has
 * no `baseRates.HTG` but still keeps the previous accepted value in
 * `rates.HTG` (USD per HTG), so that is inverted as a second choice.
 */
export function usdHtgBaseRateFromSnapshot(doc: any): number | null {
  const direct = Number(doc?.baseRates?.HTG)
  if (isPlausibleUsdHtgRate(direct)) return direct
  const usdPerHtg = Number(doc?.rates?.HTG)
  if (Number.isFinite(usdPerHtg) && usdPerHtg > 0) {
    const inverted = 1 / usdPerHtg
    if (isPlausibleUsdHtgRate(inverted)) return inverted
  }
  return null
}

/** Default loader: the cron's dated history in Firestore. */
const loadSnapshotsFromFirestore: UsdHtgSnapshotLoader = async (sinceIso) => {
  // Lazy import: this module is also used for pure money helpers (sumMoney).
  const { adminDb } = await import('@/lib/firebase/admin')
  const snap = await adminDb.collection('fx_snapshots').where('fetchedAt', '>=', sinceIso).get()
  const points: UsdHtgSnapshotPoint[] = []
  snap.docs.forEach((d: any) => {
    const data = d.data() || {}
    const baseRate = usdHtgBaseRateFromSnapshot(data)
    if (baseRate !== null) points.push({ baseRate, fetchedAt: String(data.fetchedAt || d.id), id: d.id })
  })
  return points
}

function providerTimestampIso(data: any, fallbackMs: number): string {
  const unix = Number(data?.time_last_update_unix)
  if (Number.isFinite(unix) && unix > 0) return new Date(unix * 1000).toISOString()
  const utc = data?.time_last_update_utc
  if (typeof utc === 'string' && utc) {
    const parsed = new Date(utc)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return new Date(fallbackMs).toISOString()
}

/**
 * One raw provider read (timeout, payload checks, provider timestamp) with NO
 * sanity band, cache or fallback. For monitoring; checkout uses getUsdToHtgBaseRate.
 */
export function fetchLiveUsdHtgRate(options?: { fetchUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
  const url = options?.fetchUrl || process.env.FX_USD_HTG_URL || 'https://open.er-api.com/v6/latest/USD'
  return fetchLiveRate(url, options?.fetchImpl || fetch, options?.timeoutMs ?? USD_HTG_FETCH_TIMEOUT_MS, Date.now())
}

async function fetchLiveRate(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  nowMs: number
): Promise<{ baseRate: number; fetchedAtIso: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`FX rate fetch failed: ${response.status} ${response.statusText}`)
    }
    const data: any = await response.json()
    // Expected shapes:
    // - open.er-api.com: { result: 'success', base_code: 'USD', rates: { HTG: 132.12 }, time_last_update_utc }
    // - some APIs: { base: 'USD', rates: { HTG: ... } }
    const base = String(data?.base_code || data?.base || data?.baseCode || 'USD').toUpperCase()
    const htg = data?.rates?.HTG
    if (base !== 'USD' || typeof htg !== 'number' || !Number.isFinite(htg) || htg <= 0) {
      throw new Error('FX rate fetch returned unexpected payload (missing USD->HTG)')
    }
    return { baseRate: htg, fetchedAtIso: providerTimestampIso(data, nowMs) }
  } finally {
    clearTimeout(timer)
  }
}

export type UsdToHtgBaseRateResult = {
  /** HTG per 1 USD, mid-market, no spread. */
  baseRate: number
  provider: string
  /** The provider's own timestamp when it gave one, else the snapshot's / fetch time. */
  fetchedAtIso: string
  source: UsdHtgRateSource
}

export type UsdToHtgRateOptions = {
  ttlMs?: number
  fetchUrl?: string
  /** Injected for tests. */
  fetchImpl?: typeof fetch
  loadSnapshots?: UsdHtgSnapshotLoader
  timeoutMs?: number
  now?: () => number
  /**
   * Which stored rate a fallback takes. Charges (buyer pays HTG) take the
   * HIGHEST of the window, so the buyer pays a bit more, never less; payouts
   * (Tikèm pays HTG out) take the LOWEST, so a fallback can never overpay.
   */
  fallback?: 'highest' | 'lowest'
}

/**
 * The hardened USD→HTG BASE rate (no spread). Throws FxRateUnavailableError
 * when nothing trustworthy is available.
 */
export async function getUsdToHtgBaseRate(options?: UsdToHtgRateOptions): Promise<UsdToHtgBaseRateResult> {
  const ttlMs = typeof options?.ttlMs === 'number' ? options.ttlMs : 10 * 60 * 1000
  const nowFn = options?.now || Date.now
  const now = nowFn()

  const fallbackMode = options?.fallback === 'lowest' ? 'lowest' : 'highest'
  if (
    cache &&
    cache.expiresAt > now &&
    isPlausibleUsdHtgRate(cache.baseRate) &&
    (cache.source === 'live' || cache.fallbackMode === fallbackMode)
  ) {
    return {
      baseRate: cache.baseRate,
      provider: cache.provider,
      fetchedAtIso: cache.fetchedAtIso,
      source: cache.source,
    }
  }

  // NOTE: We do NOT scrape Google. Use a proper rate endpoint.
  // Default: open ER API (no key) which returns a JSON map of rates.
  const url = options?.fetchUrl || process.env.FX_USD_HTG_URL || 'https://open.er-api.com/v6/latest/USD'
  const fetchImpl = options?.fetchImpl || fetch
  const loadSnapshots = options?.loadSnapshots || loadSnapshotsFromFirestore
  const timeoutMs = typeof options?.timeoutMs === 'number' ? options.timeoutMs : USD_HTG_FETCH_TIMEOUT_MS
  const sinceIso = new Date(now - USD_HTG_HISTORY_DAYS * 24 * 3_600_000).toISOString()

  // Both at once: the history is needed to judge the live figure anyway.
  const [liveOutcome, historyOutcome] = await Promise.allSettled([
    fetchLiveRate(url, fetchImpl, timeoutMs, now),
    loadSnapshots(sinceIso),
  ])

  const history =
    historyOutcome.status === 'fulfilled'
      ? historyOutcome.value.filter((p) => isPlausibleUsdHtgRate(p.baseRate) && String(p.fetchedAt) >= sinceIso)
      : []
  if (historyOutcome.status === 'rejected') {
    console.warn('[fx/usd-htg] snapshot history unavailable', { message: (historyOutcome.reason as any)?.message })
  }

  let liveRejection: string | null = null
  if (liveOutcome.status === 'fulfilled') {
    const live = liveOutcome.value
    const mid = median(history.map((p) => p.baseRate))
    if (!isPlausibleUsdHtgRate(live.baseRate)) {
      liveRejection = `outside ${USD_HTG_MIN_PLAUSIBLE}-${USD_HTG_MAX_PLAUSIBLE} band (${live.baseRate})`
    } else if (mid !== null && Math.abs(live.baseRate - mid) / mid > USD_HTG_MAX_DEVIATION_FROM_MEDIAN) {
      liveRejection = `more than ${USD_HTG_MAX_DEVIATION_FROM_MEDIAN * 100}% from the ${USD_HTG_HISTORY_DAYS}-day median ${mid} (${live.baseRate})`
    } else {
      cache = { baseRate: live.baseRate, fetchedAtIso: live.fetchedAtIso, expiresAt: now + ttlMs, provider: url, source: 'live' }
      return { baseRate: live.baseRate, provider: url, fetchedAtIso: live.fetchedAtIso, source: 'live' }
    }
  } else {
    liveRejection = String((liveOutcome.reason as any)?.name === 'AbortError' ? 'timeout' : (liveOutcome.reason as any)?.message || liveOutcome.reason)
  }

  // Fallback: the HIGHEST stored base rate of the window for a charge (buyer
  // pays a bit more, never less), the LOWEST for a payout (never overpays).
  const best = history.reduce<UsdHtgSnapshotPoint | null>(
    (pick, p) =>
      !pick || (fallbackMode === 'lowest' ? p.baseRate < pick.baseRate : p.baseRate > pick.baseRate) ? p : pick,
    null
  )
  console.warn('[fx/usd-htg] live rate not used', { reason: liveRejection, fallback: best ? best.baseRate : null })
  if (!best) {
    throw new FxRateUnavailableError()
  }

  const provider = `fx_snapshots/${best.id || String(best.fetchedAt).slice(0, 10)}`
  cache = {
    baseRate: best.baseRate,
    fetchedAtIso: best.fetchedAt,
    expiresAt: now + Math.min(ttlMs, FALLBACK_TTL_MS),
    provider,
    source: 'snapshot_fallback',
    fallbackMode,
  }
  return { baseRate: best.baseRate, provider, fetchedAtIso: best.fetchedAt, source: 'snapshot_fallback' }
}

export type UsdToHtgRateResult = {
  baseRate: number
  effectiveRate: number
  spreadPercent: number
  provider: string
  fetchedAtIso: string
  source: UsdHtgRateSource
}

export async function getUsdToHtgRateWithSpread(
  options?: UsdToHtgRateOptions & { spreadPercent?: number }
): Promise<UsdToHtgRateResult> {
  const spreadPercent = typeof options?.spreadPercent === 'number' ? options.spreadPercent : 0.05
  const base = await getUsdToHtgBaseRate(options)
  return {
    baseRate: base.baseRate,
    effectiveRate: base.baseRate * (1 + spreadPercent),
    spreadPercent,
    provider: base.provider,
    fetchedAtIso: base.fetchedAtIso,
    source: base.source,
  }
}

export function convertUsdToHtgAmount(usdAmount: number, effectiveRate: number): number {
  if (!Number.isFinite(usdAmount) || !Number.isFinite(effectiveRate) || effectiveRate <= 0) {
    throw new Error('Invalid conversion inputs')
  }
  return roundMoney(usdAmount * effectiveRate)
}

/** Buyer-facing copy for FxRateUnavailableError, per language. */
export const FX_UNAVAILABLE_MESSAGES = {
  en: "We can't get a reliable USD to HTG exchange rate right now, so MonCash payment is paused for this event. Please try again in a few minutes.",
  fr: "Nous ne parvenons pas à obtenir un taux de change USD/HTG fiable pour le moment : le paiement MonCash est suspendu pour cet événement. Veuillez réessayer dans quelques minutes.",
  ht: 'Nou pa ka jwenn yon to chanj USD/HTG ki serye kounye a, kidonk peman MonCash la kanpe pou evènman sa a. Tanpri eseye ankò nan kèk minit.',
} as const

/**
 * Pick a language for a server response: the web's `i18nextLng` cookie, else
 * Accept-Language (the app sends its own), else English.
 */
export function requestLanguage(request: Request): 'en' | 'fr' | 'ht' {
  const cookie = request.headers.get('cookie') || ''
  const fromCookie = /(?:^|;\s*)i18nextLng=([a-zA-Z-]+)/.exec(cookie)?.[1]?.slice(0, 2).toLowerCase()
  const fromHeader = String(request.headers.get('accept-language') || '').slice(0, 2).toLowerCase()
  for (const candidate of [fromCookie, fromHeader]) {
    if (candidate === 'en' || candidate === 'fr' || candidate === 'ht') return candidate
  }
  return 'en'
}
