/**
 * Door team service: the price list.
 *
 * Tikèm sends its own crew to scan tickets at an organizer's event, paid
 * upfront. Nothing is hard-coded at the point of sale: the live values sit in
 * Firestore `config/door_team`, edited by platform admins
 * (/admin/system/door-team, audited), and the request form, the request API
 * and the admin queue all quote from there. The defaults below apply until an
 * admin first saves the doc.
 *
 * The standard quote is only a starting point: an admin may accept a request
 * at that price or set a negotiated one (lib/doorTeam/rules.ts validateQuotePrice).
 *
 * Pure: no Firebase import, so the form can quote with the same arithmetic the
 * server uses.
 */

export interface DoorTeamConfig {
  /** Off = organizers cannot request a door team (existing requests keep working). */
  enabled: boolean
  /** HTG per staff member per event, for up to `includedHours`. */
  ratePerStaffHtg: number
  /** Hours the per-staff rate covers. */
  includedHours: number
  /** HTG per staff member for every hour beyond `includedHours`. */
  extraHourPerStaffHtg: number
  /** From this many staff, every staff member is charged `volumeRatePerStaffHtg`. */
  volumeMinStaff: number
  volumeRatePerStaffHtg: number
  /** Smallest crew Tikèm sends. */
  minStaff: number
  /** Largest crew one request can ask for. */
  maxStaff: number
  /** Longest shift one request can ask for. */
  maxHours: number
  /** A request must be made at least this long before the event starts. */
  minLeadHours: number
  /** A paid request cancelled at least this long before the event is refunded. */
  refundCutoffHours: number
  updated_at?: string | null
  updated_by?: string | null
  updated_by_email?: string | null
}

export const DOOR_TEAM_CONFIG_COLLECTION = 'config'
export const DOOR_TEAM_CONFIG_DOC = 'door_team'

export const DEFAULT_DOOR_TEAM_CONFIG: DoorTeamConfig = {
  enabled: true,
  ratePerStaffHtg: 3500,
  includedHours: 6,
  extraHourPerStaffHtg: 600,
  volumeMinStaff: 5,
  volumeRatePerStaffHtg: 3000,
  minStaff: 2,
  maxStaff: 30,
  maxHours: 16,
  minLeadHours: 48,
  refundCutoffHours: 48,
}

/** Hard ceilings the admin form cannot pass (a typo must not quote 10 million HTG). */
export const DOOR_TEAM_LIMITS = {
  maxRateHtg: 100000,
  maxStaffCeiling: 200,
  maxHoursCeiling: 24,
  maxLeadHours: 24 * 30,
} as const

const FIELDS = [
  'enabled',
  'ratePerStaffHtg',
  'includedHours',
  'extraHourPerStaffHtg',
  'volumeMinStaff',
  'volumeRatePerStaffHtg',
  'minStaff',
  'maxStaff',
  'maxHours',
  'minLeadHours',
  'refundCutoffHours',
] as const

export type DoorTeamConfigValidation =
  | { ok: true; value: DoorTeamConfig }
  | { ok: false; error: string; field?: string }

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)

/**
 * Validate an admin edit. Strict: unknown keys are refused, every number is
 * a whole number within DOOR_TEAM_LIMITS, and the pieces must agree (the
 * volume rate cannot be above the base rate, the minimum crew cannot exceed
 * the maximum, the included hours fit in the longest shift).
 */
export function validateDoorTeamConfig(raw: unknown): DoorTeamConfigValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Config must be an object' }
  const obj = raw as Record<string, unknown>
  const allowed = new Set<string>(FIELDS)
  const extra = Object.keys(obj).filter((k) => !allowed.has(k))
  if (extra.length) return { ok: false, error: `Unknown field(s): ${extra.join(', ')}` }
  if (typeof obj.enabled !== 'boolean') return { ok: false, error: 'enabled must be true or false', field: 'enabled' }

  const money = (key: string, label: string, min = 1): string | null =>
    isInt(obj[key]) && (obj[key] as number) >= min && (obj[key] as number) <= DOOR_TEAM_LIMITS.maxRateHtg
      ? null
      : `${label} must be a whole number of HTG from ${min} to ${DOOR_TEAM_LIMITS.maxRateHtg}`
  const count = (key: string, label: string, min: number, max: number): string | null =>
    isInt(obj[key]) && (obj[key] as number) >= min && (obj[key] as number) <= max ? null : `${label} must be a whole number from ${min} to ${max}`

  const checks: Array<[string, string | null]> = [
    ['ratePerStaffHtg', money('ratePerStaffHtg', 'Rate per staff')],
    ['extraHourPerStaffHtg', money('extraHourPerStaffHtg', 'Extra hour rate', 0)],
    ['volumeRatePerStaffHtg', money('volumeRatePerStaffHtg', 'Volume rate per staff')],
    ['includedHours', count('includedHours', 'Included hours', 1, DOOR_TEAM_LIMITS.maxHoursCeiling)],
    ['maxHours', count('maxHours', 'Longest shift', 1, DOOR_TEAM_LIMITS.maxHoursCeiling)],
    ['minStaff', count('minStaff', 'Minimum crew', 1, DOOR_TEAM_LIMITS.maxStaffCeiling)],
    ['maxStaff', count('maxStaff', 'Maximum crew', 1, DOOR_TEAM_LIMITS.maxStaffCeiling)],
    ['volumeMinStaff', count('volumeMinStaff', 'Volume price from', 1, DOOR_TEAM_LIMITS.maxStaffCeiling)],
    ['minLeadHours', count('minLeadHours', 'Notice before the event', 0, DOOR_TEAM_LIMITS.maxLeadHours)],
    ['refundCutoffHours', count('refundCutoffHours', 'Refund cutoff', 0, DOOR_TEAM_LIMITS.maxLeadHours)],
  ]
  for (const [field, error] of checks) if (error) return { ok: false, error, field }

  const v = obj as unknown as DoorTeamConfig
  if (v.maxStaff < v.minStaff) return { ok: false, error: 'Maximum crew must be at least the minimum crew', field: 'maxStaff' }
  if (v.includedHours > v.maxHours) return { ok: false, error: 'Included hours cannot be more than the longest shift', field: 'includedHours' }
  if (v.volumeRatePerStaffHtg > v.ratePerStaffHtg) {
    return { ok: false, error: 'The volume rate cannot be higher than the standard rate', field: 'volumeRatePerStaffHtg' }
  }

  const value = {} as DoorTeamConfig
  for (const k of FIELDS) (value as any)[k] = (obj as any)[k]
  return { ok: true, value }
}

/** The stored doc, made safe to quote with: anything malformed falls back to the defaults. */
export function normalizeStoredDoorTeamConfig(stored: unknown): DoorTeamConfig {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_DOOR_TEAM_CONFIG }
  const s = stored as Record<string, any>
  const candidate: Record<string, unknown> = {}
  for (const k of FIELDS) candidate[k] = s[k] ?? (DEFAULT_DOOR_TEAM_CONFIG as any)[k]
  const v = validateDoorTeamConfig(candidate)
  if (!v.ok) {
    return { ...DEFAULT_DOOR_TEAM_CONFIG, enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_DOOR_TEAM_CONFIG.enabled }
  }
  return {
    ...v.value,
    updated_at: typeof s.updated_at === 'string' ? s.updated_at : null,
    updated_by: typeof s.updated_by === 'string' ? s.updated_by : null,
    updated_by_email: typeof s.updated_by_email === 'string' ? s.updated_by_email : null,
  }
}

/** Only what an organizer needs to see the price list (no audit fields). */
export function publicDoorTeamConfig(c: DoorTeamConfig) {
  const out: Record<string, unknown> = {}
  for (const k of FIELDS) out[k] = c[k]
  return out as Omit<DoorTeamConfig, 'updated_at' | 'updated_by' | 'updated_by_email'>
}

export interface DoorTeamQuoteBreakdown {
  staff: number
  hours: number
  /** HTG per staff for the included hours (the volume rate from volumeMinStaff). */
  unitHtg: number
  volume: boolean
  baseHtg: number
  extraHours: number
  extraHoursHtg: number
  totalHtg: number
}

export type DoorTeamQuote =
  | ({ ok: true } & DoorTeamQuoteBreakdown)
  | { ok: false; code: 'disabled' | 'below_min_staff' | 'above_max_staff' | 'invalid_staff' | 'invalid_hours' | 'above_max_hours'; minStaff: number; maxStaff: number; maxHours: number }

/**
 * The standard quote for `staff` people for `hours` hours:
 *   staff × (rate, or the volume rate from volumeMinStaff)
 *   + staff × max(0, hours − includedHours) × extraHourPerStaff
 */
export function quoteDoorTeam(config: DoorTeamConfig, input: { staff: number; hours: number }): DoorTeamQuote {
  const base = { minStaff: config.minStaff, maxStaff: config.maxStaff, maxHours: config.maxHours }
  if (!config.enabled) return { ok: false, code: 'disabled', ...base }
  const staff = input.staff
  const hours = input.hours
  if (!isInt(staff) || staff <= 0) return { ok: false, code: 'invalid_staff', ...base }
  if (staff < config.minStaff) return { ok: false, code: 'below_min_staff', ...base }
  if (staff > config.maxStaff) return { ok: false, code: 'above_max_staff', ...base }
  if (!isInt(hours) || hours <= 0) return { ok: false, code: 'invalid_hours', ...base }
  if (hours > config.maxHours) return { ok: false, code: 'above_max_hours', ...base }
  const volume = staff >= config.volumeMinStaff
  const unitHtg = volume ? config.volumeRatePerStaffHtg : config.ratePerStaffHtg
  const baseHtg = unitHtg * staff
  const extraHours = Math.max(0, hours - config.includedHours)
  const extraHoursHtg = extraHours * staff * config.extraHourPerStaffHtg
  return { ok: true, staff, hours, unitHtg, volume, baseHtg, extraHours, extraHoursHtg, totalHtg: baseHtg + extraHoursHtg }
}
