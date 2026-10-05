import type { PayoutReleaseConfig } from '@/types/platform-settings'

/**
 * Daily FX snapshot used to normalise payout thresholds across currencies.
 *
 * Written once a day by /api/cron/fx-snapshot and READ from storage during a
 * release run — never fetched inside the decision path. A rate lookup that failed
 * or spiked mid-run would change who gets paid, so the network call happens on
 * its own schedule and a release only ever reads a stored number.
 */
export type FxSnapshot = {
  /** Units of the threshold currency per 1 unit of the keyed currency. */
  rates: Record<string, number>
  /** Raw provider rates (keyed currency per 1 threshold-currency unit), for audit. */
  baseRates?: Record<string, number>
  thresholdCurrency: string
  provider: string
  fetchedAt: string
  /** Currencies the provider didn't return, so a reader knows what fell back. */
  missing?: string[]
  /** Rates rejected by the sanity guard, with the value that was refused. */
  rejected?: Record<string, number>
}

export const FX_SNAPSHOT_DOC = 'fx_snapshot'

/** A snapshot older than this is not trusted; the manual table takes over. */
export const FX_SNAPSHOT_MAX_AGE_DAYS = 7

/**
 * A single day's move larger than this is treated as a bad provider response
 * rather than a real market event, and the previous rate is kept. The gourde does
 * move sharply, so this is deliberately loose — it exists to catch a provider
 * returning 0, 1, or an inverted figure, not to second-guess the market.
 */
export const FX_MAX_DAILY_MOVE_RATIO = 0.35

export type ResolvedRates = {
  rates: Record<string, number>
  /** Where each currency's rate came from, for the run summary. */
  sources: Record<string, 'snapshot' | 'manual'>
  snapshotAgeHours: number | null
  warnings: string[]
}

/**
 * Merge the daily snapshot over the admin-maintained table.
 *
 * The manual table is the FALLBACK, not the loser: it covers currencies the
 * provider doesn't return, and it takes over entirely when the snapshot is stale.
 * That way a broken FX job degrades to the last hand-checked number instead of
 * silently shifting who qualifies for early payouts.
 */
export function resolveReferenceRates(
  config: PayoutReleaseConfig,
  snapshot: FxSnapshot | null | undefined,
  now: Date = new Date()
): ResolvedRates {
  const manual = config.referenceRates || {}
  const thresholdCurrency = (config.thresholdCurrency || 'USD').toUpperCase()
  const rates: Record<string, number> = { ...manual, [thresholdCurrency]: 1 }
  const sources: Record<string, 'snapshot' | 'manual'> = {}
  const warnings: string[] = []

  for (const code of Object.keys(rates)) sources[code] = 'manual'

  if (!snapshot) {
    warnings.push('No FX snapshot found. Using the admin-maintained rates.')
    return { rates, sources, snapshotAgeHours: null, warnings }
  }

  const fetchedAt = new Date(snapshot.fetchedAt)
  if (Number.isNaN(fetchedAt.getTime())) {
    warnings.push('FX snapshot has an unreadable timestamp. Using manual rates.')
    return { rates, sources, snapshotAgeHours: null, warnings }
  }

  const ageHours = (now.getTime() - fetchedAt.getTime()) / 3_600_000
  if (ageHours > FX_SNAPSHOT_MAX_AGE_DAYS * 24) {
    warnings.push(
      `FX snapshot is ${Math.round(ageHours / 24)} days old (max ${FX_SNAPSHOT_MAX_AGE_DAYS}). Using manual rates.`
    )
    return { rates, sources, snapshotAgeHours: ageHours, warnings }
  }

  if ((snapshot.thresholdCurrency || 'USD').toUpperCase() !== thresholdCurrency) {
    warnings.push(
      `FX snapshot is quoted in ${snapshot.thresholdCurrency} but thresholds are in ${thresholdCurrency}. Using manual rates.`
    )
    return { rates, sources, snapshotAgeHours: ageHours, warnings }
  }

  for (const [rawCode, rawValue] of Object.entries(snapshot.rates || {})) {
    const code = rawCode.toUpperCase()
    if (code === thresholdCurrency) continue
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value <= 0) {
      warnings.push(`FX snapshot rate for ${code} is not usable, so the manual rate was kept.`)
      continue
    }
    rates[code] = value
    sources[code] = 'snapshot'
  }

  if (snapshot.missing?.length) {
    warnings.push(`FX provider did not return: ${snapshot.missing.join(', ')}. Those use manual rates.`)
  }
  if (snapshot.rejected && Object.keys(snapshot.rejected).length) {
    warnings.push(
      `FX rates rejected by the sanity guard: ${Object.keys(snapshot.rejected).join(', ')}. Previous values kept.`
    )
  }

  return { rates, sources, snapshotAgeHours: ageHours, warnings }
}

/** True when a new rate is an implausible jump from the last accepted one. */
export function isImplausibleMove(previous: number | undefined, next: number): boolean {
  if (!previous || !Number.isFinite(previous) || previous <= 0) return false
  const ratio = Math.abs(next - previous) / previous
  return ratio > FX_MAX_DAILY_MOVE_RATIO
}
