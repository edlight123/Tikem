/**
 * Printed (physical) tickets: the price list.
 *
 * Tikèm prints the tickets in-house and the organizer pays a flat price per
 * printed ticket UPFRONT, with volume tiers. Nothing here is hard-coded at the
 * point of sale: the live values sit in Firestore `config/physical_tickets`,
 * edited by platform admins (/admin/system/printed-tickets), and every order
 * screen and the order API read them from there. The defaults below only apply
 * until an admin first saves the doc.
 *
 * Pure: no Firebase import, so it is unit-tested directly and the order screen
 * can quote with the same arithmetic the server charges with.
 */

export interface PhysicalPriceTier {
  /** Smallest batch this price applies to (inclusive). */
  minQty: number
  /** Flat price per printed ticket, in HTG. */
  priceHtgPerTicket: number
}

export interface PhysicalTicketsConfig {
  /** Off = organizers cannot order a batch (existing batches keep working). */
  enabled: boolean
  /** Smallest batch Tikèm prints. */
  minBatch: number
  /** Largest batch in one order (one tier). */
  maxBatch: number
  /** Ascending by minQty; the first tier's minQty is the effective minimum. */
  tiers: PhysicalPriceTier[]
  /**
   * Optional display prices in other currencies (per ticket, per tier index),
   * e.g. { USD: [0.3, 0.23] }. Display only: MonCash charges HTG and a card is
   * charged the HTG total converted at the live rate.
   */
  displayPrices?: Record<string, number[]> | null
  updated_at?: string | null
  updated_by?: string | null
  updated_by_email?: string | null
}

export const PHYSICAL_CONFIG_COLLECTION = 'config'
export const PHYSICAL_CONFIG_DOC = 'physical_tickets'

export const DEFAULT_PHYSICAL_CONFIG: PhysicalTicketsConfig = {
  enabled: true,
  minBatch: 100,
  maxBatch: 5000,
  tiers: [
    { minQty: 100, priceHtgPerTicket: 40 },
    { minQty: 500, priceHtgPerTicket: 30 },
  ],
  displayPrices: null,
}

/** Hard ceilings the admin form cannot pass (a typo must not print 10 million tickets). */
export const PHYSICAL_LIMITS = {
  minBatchFloor: 1,
  maxBatchCeiling: 20000,
  maxTiers: 8,
  maxPriceHtg: 10000,
} as const

const DISPLAY_CURRENCIES = new Set(['USD', 'CAD', 'EUR'])

export type ConfigValidation =
  | { ok: true; value: PhysicalTicketsConfig }
  | { ok: false; error: string; field?: string }

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/**
 * Validate an admin edit. Strict: unknown keys are refused, every number is
 * checked against PHYSICAL_LIMITS, tiers must ascend and the first tier must
 * start at the minimum batch (so every orderable quantity has a price).
 */
export function validatePhysicalConfig(raw: unknown): ConfigValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Config must be an object' }
  const obj = raw as Record<string, unknown>
  const allowed = new Set(['enabled', 'minBatch', 'maxBatch', 'tiers', 'displayPrices'])
  const extra = Object.keys(obj).filter((k) => !allowed.has(k))
  if (extra.length) return { ok: false, error: `Unknown field(s): ${extra.join(', ')}` }

  if (typeof obj.enabled !== 'boolean') return { ok: false, error: 'enabled must be true or false', field: 'enabled' }
  const { minBatch, maxBatch } = obj
  if (!isInt(minBatch) || minBatch < PHYSICAL_LIMITS.minBatchFloor || minBatch > PHYSICAL_LIMITS.maxBatchCeiling) {
    return { ok: false, error: `Minimum batch must be a whole number from ${PHYSICAL_LIMITS.minBatchFloor} to ${PHYSICAL_LIMITS.maxBatchCeiling}`, field: 'minBatch' }
  }
  if (!isInt(maxBatch) || maxBatch < minBatch || maxBatch > PHYSICAL_LIMITS.maxBatchCeiling) {
    return { ok: false, error: `Maximum batch must be a whole number from the minimum to ${PHYSICAL_LIMITS.maxBatchCeiling}`, field: 'maxBatch' }
  }

  if (!Array.isArray(obj.tiers) || obj.tiers.length === 0) return { ok: false, error: 'At least one price tier is required', field: 'tiers' }
  if (obj.tiers.length > PHYSICAL_LIMITS.maxTiers) return { ok: false, error: `At most ${PHYSICAL_LIMITS.maxTiers} price tiers`, field: 'tiers' }
  const tiers: PhysicalPriceTier[] = []
  for (let i = 0; i < obj.tiers.length; i++) {
    const t = obj.tiers[i] as Record<string, unknown> | null
    if (!t || typeof t !== 'object') return { ok: false, error: `Tier ${i + 1} is not valid`, field: 'tiers' }
    const keys = Object.keys(t).filter((k) => k !== 'minQty' && k !== 'priceHtgPerTicket')
    if (keys.length) return { ok: false, error: `Tier ${i + 1}: unknown field(s) ${keys.join(', ')}`, field: 'tiers' }
    if (!isInt(t.minQty) || t.minQty < 1 || t.minQty > PHYSICAL_LIMITS.maxBatchCeiling) {
      return { ok: false, error: `Tier ${i + 1}: from-quantity must be a whole number`, field: 'tiers' }
    }
    if (!isNum(t.priceHtgPerTicket) || t.priceHtgPerTicket <= 0 || t.priceHtgPerTicket > PHYSICAL_LIMITS.maxPriceHtg) {
      return { ok: false, error: `Tier ${i + 1}: price must be above 0 and at most ${PHYSICAL_LIMITS.maxPriceHtg} HTG`, field: 'tiers' }
    }
    if (i > 0 && t.minQty <= tiers[i - 1].minQty) {
      return { ok: false, error: `Tier ${i + 1}: from-quantity must be larger than the tier before`, field: 'tiers' }
    }
    tiers.push({ minQty: t.minQty, priceHtgPerTicket: Math.round(t.priceHtgPerTicket * 100) / 100 })
  }
  if (tiers[0].minQty !== minBatch) {
    return { ok: false, error: 'The first tier must start at the minimum batch', field: 'tiers' }
  }

  let displayPrices: Record<string, number[]> | null = null
  if (obj.displayPrices != null) {
    if (typeof obj.displayPrices !== 'object' || Array.isArray(obj.displayPrices)) {
      return { ok: false, error: 'displayPrices must be an object', field: 'displayPrices' }
    }
    displayPrices = {}
    for (const [code, list] of Object.entries(obj.displayPrices as Record<string, unknown>)) {
      const cur = code.toUpperCase()
      if (!DISPLAY_CURRENCIES.has(cur)) return { ok: false, error: `Display currency ${code} is not supported`, field: 'displayPrices' }
      if (!Array.isArray(list) || list.length !== tiers.length || !list.every((n) => isNum(n) && n >= 0 && n <= 1000)) {
        return { ok: false, error: `${cur}: one price per tier is required`, field: 'displayPrices' }
      }
      displayPrices[cur] = list.map((n) => Math.round(Number(n) * 100) / 100)
    }
    if (Object.keys(displayPrices).length === 0) displayPrices = null
  }

  return { ok: true, value: { enabled: obj.enabled, minBatch, maxBatch, tiers, displayPrices } }
}

/**
 * The stored doc, made safe to price with: anything malformed falls back to
 * the defaults (a broken doc must never price a batch at 0).
 */
export function normalizeStoredConfig(stored: unknown): PhysicalTicketsConfig {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_PHYSICAL_CONFIG }
  const s = stored as Record<string, any>
  const candidate = {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_PHYSICAL_CONFIG.enabled,
    minBatch: s.minBatch,
    maxBatch: s.maxBatch ?? DEFAULT_PHYSICAL_CONFIG.maxBatch,
    tiers: s.tiers,
    displayPrices: s.displayPrices ?? null,
  }
  const v = validatePhysicalConfig(candidate)
  if (!v.ok) return { ...DEFAULT_PHYSICAL_CONFIG, enabled: candidate.enabled }
  return {
    ...v.value,
    updated_at: typeof s.updated_at === 'string' ? s.updated_at : null,
    updated_by: typeof s.updated_by === 'string' ? s.updated_by : null,
    updated_by_email: typeof s.updated_by_email === 'string' ? s.updated_by_email : null,
  }
}

/** The tier a quantity falls in (the highest minQty at or below it), or null below the minimum. */
export function tierForQuantity(config: PhysicalTicketsConfig, quantity: number): { tier: PhysicalPriceTier; index: number } | null {
  if (!isInt(quantity) || quantity < config.minBatch) return null
  let found: { tier: PhysicalPriceTier; index: number } | null = null
  config.tiers.forEach((tier, index) => {
    if (quantity >= tier.minQty) found = { tier, index }
  })
  return found
}

export type BatchQuote =
  | { ok: true; quantity: number; unitPriceHtg: number; totalHtg: number; tierIndex: number; display: Record<string, { unit: number; total: number }> }
  | { ok: false; code: 'disabled' | 'below_minimum' | 'above_maximum' | 'invalid_quantity'; minBatch: number; maxBatch: number }

/** What a batch of `quantity` costs under `config`. The server charges exactly this. */
export function quoteBatch(config: PhysicalTicketsConfig, quantity: number): BatchQuote {
  const base = { minBatch: config.minBatch, maxBatch: config.maxBatch }
  if (!config.enabled) return { ok: false, code: 'disabled', ...base }
  if (!isInt(quantity) || quantity <= 0) return { ok: false, code: 'invalid_quantity', ...base }
  if (quantity < config.minBatch) return { ok: false, code: 'below_minimum', ...base }
  if (quantity > config.maxBatch) return { ok: false, code: 'above_maximum', ...base }
  const hit = tierForQuantity(config, quantity)
  if (!hit) return { ok: false, code: 'below_minimum', ...base }
  const unit = hit.tier.priceHtgPerTicket
  const display: Record<string, { unit: number; total: number }> = {}
  for (const [cur, list] of Object.entries(config.displayPrices || {})) {
    const u = Number(list[hit.index])
    if (Number.isFinite(u)) display[cur] = { unit: u, total: Math.round(u * quantity * 100) / 100 }
  }
  return {
    ok: true,
    quantity,
    unitPriceHtg: unit,
    totalHtg: Math.round(unit * quantity * 100) / 100,
    tierIndex: hit.index,
    display,
  }
}
