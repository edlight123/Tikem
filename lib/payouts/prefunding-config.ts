/**
 * Settings for the MonCash prefunding planner, stored at
 * `config/payouts.prefundingPlan` (a field on the existing config/payouts doc,
 * beside `prefunding`). Every field is optional in Firestore; anything missing
 * or invalid falls back to the defaults below, so an empty doc is a working
 * planner.
 *
 * The Digicel contacts, account names and signatories live here too, so a new
 * contact or a changed account number is a Firestore edit, not a deploy.
 *
 * Pure: no Firestore import. The loader is lib/payouts/prefunding-plan-server.ts.
 */

export type PrefundingSignatory = {
  name: string
  /** e.g. "Directeur général". Left out of the letter when empty. */
  title?: string
  email?: string
}

export type DigicelPrefundingContacts = {
  /** Who the request goes to. */
  to: string[]
  cc: string[]
  /** The Gmail account the compose link opens in (the sender). */
  fromEmail: string
  /** The legal entity named in the letter. */
  companyName: string
  /** The MonCash merchant (collections) account the money leaves. */
  merchantAccountName: string
  /** Its account number / merchant id. Empty = "[à compléter]" in the letter, and a warning. */
  merchantAccountNumber: string
  /** The prefunded (disbursement) account the money goes to. */
  prefundedAccountName: string
  prefundedAccountNumber: string
  signatories: PrefundingSignatory[]
}

export type PrefundingPlanConfig = {
  /** Minimum covers money withdrawable within this many Haiti business days after today. */
  minimumHorizonBusinessDays: number
  /** Recommended covers money withdrawable within this many calendar days. */
  recommendedHorizonDays: number
  /** Extra on top of the recommended need, as a ratio (0.15 = 15%). */
  recommendedBufferPercent: number
  /** Amounts round to this many HTG (up for minimum/recommended, down for maximum). */
  roundingStepHtg: number
  /**
   * The pool is debited the transfer PLUS Digicel's 3% (lib/payouts/moncash-prefunded.ts
   * DIGICEL_PREFUNDED_FEE_PERCENT), so N HTG owed needs N x 1.03 in the pool.
   */
  poolFeeFactor: number
  /** Digicel processes requests sent before this hour (Haiti) the same business day. */
  cutoffHourHaiti: number
  /** Haiti public holidays, YYYY-MM-DD; not business days. */
  holidays: string[]
  /** The low-balance alert recomputes the plan when its cached copy is older than this. */
  alertPlanMaxAgeHours: number
  digicel: DigicelPrefundingContacts
}

export const DEFAULT_DIGICEL_PREFUNDING_CONTACTS: DigicelPrefundingContacts = {
  to: ['Hai_MFS_Request@digicelgroup.com'],
  cc: ['hai_mfs_b2b_team@digicelgroup.com'],
  fromEmail: 'info@edlight.org',
  companyName: 'PANTHEON SERVICES',
  merchantAccountName: 'PANTHEON SERVICES',
  merchantAccountNumber: '',
  prefundedAccountName: 'PANTHEON SERVICES PREFUNDED',
  prefundedAccountNumber: '',
  signatories: [{ name: 'Stéphane Lainé', email: 'stephane.laine@edlight.org' }],
}

export const DEFAULT_PREFUNDING_PLAN_CONFIG: PrefundingPlanConfig = {
  minimumHorizonBusinessDays: 2,
  recommendedHorizonDays: 7,
  recommendedBufferPercent: 0.15,
  roundingStepHtg: 1000,
  poolFeeFactor: 1.03,
  cutoffHourHaiti: 16,
  holidays: [],
  alertPlanMaxAgeHours: 3,
  digicel: DEFAULT_DIGICEL_PREFUNDING_CONTACTS,
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function emails(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const list = value.map((v) => String(v || '').trim()).filter((v) => /^[^@\s]+@[^@\s]+$/.test(v))
  return list.length ? list : fallback
}

/** Stored (possibly partial or corrupt) settings → a complete, sane config. */
export function resolvePrefundingPlanConfig(stored?: any): PrefundingPlanConfig {
  const d = DEFAULT_PREFUNDING_PLAN_CONFIG
  const s = stored && typeof stored === 'object' ? stored : {}
  const dg = s.digicel && typeof s.digicel === 'object' ? s.digicel : {}
  const dd = d.digicel
  const signatories: PrefundingSignatory[] = Array.isArray(dg.signatories)
    ? dg.signatories
        .filter((x: any) => x && typeof x.name === 'string' && x.name.trim())
        .map((x: any) => ({
          name: String(x.name).trim(),
          ...(typeof x.title === 'string' && x.title.trim() ? { title: x.title.trim() } : {}),
          ...(typeof x.email === 'string' && x.email.trim() ? { email: x.email.trim() } : {}),
        }))
    : []
  return {
    minimumHorizonBusinessDays: Math.round(num(s.minimumHorizonBusinessDays, d.minimumHorizonBusinessDays, 1, 10)),
    recommendedHorizonDays: Math.round(num(s.recommendedHorizonDays, d.recommendedHorizonDays, 1, 60)),
    recommendedBufferPercent: num(s.recommendedBufferPercent, d.recommendedBufferPercent, 0, 2),
    roundingStepHtg: Math.round(num(s.roundingStepHtg, d.roundingStepHtg, 1, 1_000_000)),
    poolFeeFactor: num(s.poolFeeFactor, d.poolFeeFactor, 1, 1.5),
    cutoffHourHaiti: Math.round(num(s.cutoffHourHaiti, d.cutoffHourHaiti, 0, 23)),
    holidays: Array.isArray(s.holidays)
      ? s.holidays.map(String).filter((h: string) => /^\d{4}-\d{2}-\d{2}$/.test(h))
      : d.holidays,
    alertPlanMaxAgeHours: num(s.alertPlanMaxAgeHours, d.alertPlanMaxAgeHours, 0.25, 48),
    digicel: {
      to: emails(dg.to, dd.to),
      cc: Array.isArray(dg.cc) ? emails(dg.cc, []) : dd.cc,
      fromEmail: str(dg.fromEmail, dd.fromEmail),
      companyName: str(dg.companyName, dd.companyName),
      merchantAccountName: str(dg.merchantAccountName, dd.merchantAccountName),
      merchantAccountNumber: typeof dg.merchantAccountNumber === 'string' ? dg.merchantAccountNumber.trim() : dd.merchantAccountNumber,
      prefundedAccountName: str(dg.prefundedAccountName, dd.prefundedAccountName),
      prefundedAccountNumber:
        typeof dg.prefundedAccountNumber === 'string' ? dg.prefundedAccountNumber.trim() : dd.prefundedAccountNumber,
      signatories: signatories.length ? signatories : dd.signatories,
    },
  }
}
