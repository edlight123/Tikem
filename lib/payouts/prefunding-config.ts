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
  /** The legal entity named in the letter (and the letterhead wordmark). */
  companyName: string
  /** Registered office, one line, printed under the letterhead wordmark. */
  companyAddress: string
  /** Company identification / patente numbers (never a person's national ID). */
  companyIds: string[]
  /** Optional https PNG/JPEG logo for the letterhead. Empty = text letterhead only. */
  logoUrl: string
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
  // hai_mfs_b2b_team: contract §3.2. MFS_B.Services: Digicel's notice of 1 March 2024.
  cc: ['hai_mfs_b2b_team@digicelgroup.com', 'MFS_B.Services@digicelgroup.com'],
  // The address Digicel knows PANTHEON SERVICES by.
  fromEmail: 'info@edlight.org',
  companyName: 'PANTHEON SERVICES',
  companyAddress: 'N° 2, rue Corlette, route de Frères, Pétion-Ville, Haïti',
  companyIds: ['000-284-278-2', '2607188721'],
  logoUrl: '',
  merchantAccountName: 'PANTHEON SERVICES',
  // Unknown until the owner supplies it: the letter prints a blank line and the page warns.
  merchantAccountNumber: '',
  prefundedAccountName: 'PANTHEON SERVICES PREFUNDED',
  prefundedAccountNumber: '188721',
  signatories: [{ name: 'Stéphane LAINÉ', title: 'Représentant', email: 'stephane.laine@edlight.org' }],
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

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
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
      companyAddress: str(dg.companyAddress, dd.companyAddress),
      companyIds: Array.isArray(dg.companyIds)
        ? dg.companyIds.map((v: unknown) => String(v ?? '').trim()).filter(Boolean)
        : dd.companyIds,
      logoUrl: typeof dg.logoUrl === 'string' && isHttpsUrl(dg.logoUrl.trim()) ? dg.logoUrl.trim() : dd.logoUrl,
      merchantAccountName: str(dg.merchantAccountName, dd.merchantAccountName),
      merchantAccountNumber: typeof dg.merchantAccountNumber === 'string' ? dg.merchantAccountNumber.trim() : dd.merchantAccountNumber,
      prefundedAccountName: str(dg.prefundedAccountName, dd.prefundedAccountName),
      // Known (the contract), so an empty stored value falls back to it.
      prefundedAccountNumber: str(dg.prefundedAccountNumber, dd.prefundedAccountNumber),
      signatories: signatories.length ? signatories : dd.signatories,
    },
  }
}

// ── The admin settings form (letterhead + Digicel fields) ───────────────────

/** What the admin settings form edits: the letterhead and Digicel fields of `digicel`. */
export type PrefundingLetterSettings = {
  companyName: string
  companyAddress: string
  companyIds: string[]
  logoUrl: string
  merchantAccountNumber: string
  prefundedAccountNumber: string
  signatoryName: string
  signatoryTitle: string
  to: string[]
  cc: string[]
  fromEmail: string
}

export function letterSettingsFromContacts(c: DigicelPrefundingContacts): PrefundingLetterSettings {
  const s = c.signatories[0] || { name: '' }
  return {
    companyName: c.companyName,
    companyAddress: c.companyAddress,
    companyIds: c.companyIds,
    logoUrl: c.logoUrl,
    merchantAccountNumber: c.merchantAccountNumber,
    prefundedAccountNumber: c.prefundedAccountNumber,
    signatoryName: s.name,
    signatoryTitle: s.title || '',
    to: c.to,
    cc: c.cc,
    fromEmail: c.fromEmail,
  }
}

const EMAIL_RE = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/
const ACCOUNT_RE = /^[0-9A-Za-z][0-9A-Za-z .\-/]{1,38}[0-9A-Za-z]$/
const ID_RE = /^[0-9A-Za-z][0-9A-Za-z .\-/]{1,28}[0-9A-Za-z]$/

/**
 * Validate the settings form. Strict (unlike resolvePrefundingPlanConfig, which
 * repairs what is stored): every problem is reported so the admin can fix it,
 * and nothing is saved unless all of it is valid.
 */
export function parseLetterSettingsInput(
  input: unknown
): { ok: true; value: PrefundingLetterSettings } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const text = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).replace(/\s+/g, ' ').trim() : '')
  const list = (k: string) =>
    (Array.isArray(o[k]) ? (o[k] as unknown[]) : typeof o[k] === 'string' ? String(o[k]).split(/[,;\n]/) : [])
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)

  const companyName = text('companyName')
  if (companyName.length < 2 || companyName.length > 80) errors.companyName = 'Company name: 2 to 80 characters.'
  const companyAddress = text('companyAddress')
  if (companyAddress.length < 5 || companyAddress.length > 160) errors.companyAddress = 'Address: 5 to 160 characters, one line.'
  const companyIds = list('companyIds')
  if (companyIds.length > 4 || companyIds.some((v) => !ID_RE.test(v)))
    errors.companyIds = 'Company IDs: up to 4 patente / identification numbers (digits, letters, dashes).'
  const logoUrl = text('logoUrl')
  if (logoUrl && !isHttpsUrl(logoUrl)) errors.logoUrl = 'Logo URL must start with https:// (PNG or JPEG), or be empty.'
  const merchantAccountNumber = text('merchantAccountNumber')
  if (merchantAccountNumber && !ACCOUNT_RE.test(merchantAccountNumber))
    errors.merchantAccountNumber = 'Merchant account number: 3 to 40 digits, letters or dashes (or leave empty until known).'
  const prefundedAccountNumber = text('prefundedAccountNumber')
  if (!ACCOUNT_RE.test(prefundedAccountNumber))
    errors.prefundedAccountNumber = 'Prefunded account number is required (3 to 40 digits, letters or dashes).'
  const signatoryName = text('signatoryName')
  if (signatoryName.length < 2 || signatoryName.length > 80) errors.signatoryName = 'Signatory name: 2 to 80 characters.'
  const signatoryTitle = text('signatoryTitle')
  if (signatoryTitle.length > 80) errors.signatoryTitle = 'Signatory title: at most 80 characters.'
  const to = list('to')
  if (!to.length || to.length > 5 || to.some((e) => !EMAIL_RE.test(e))) errors.to = 'To: one to five valid email addresses.'
  const cc = list('cc')
  if (cc.length > 10 || cc.some((e) => !EMAIL_RE.test(e))) errors.cc = 'Cc: up to ten valid email addresses.'
  const fromEmail = text('fromEmail')
  if (!EMAIL_RE.test(fromEmail)) errors.fromEmail = 'From must be one valid email address.'

  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    value: {
      companyName,
      companyAddress,
      companyIds,
      logoUrl,
      merchantAccountNumber,
      prefundedAccountNumber,
      signatoryName,
      signatoryTitle,
      to,
      cc,
      fromEmail,
    },
  }
}

/**
 * The `digicel` patch a saved form writes into config/payouts.prefundingPlan.
 * The signatory's email (used only in the cover email) is carried over.
 */
export function letterSettingsToDigicelPatch(
  s: PrefundingLetterSettings,
  current: DigicelPrefundingContacts
): Partial<DigicelPrefundingContacts> {
  const keepEmail = current.signatories[0]?.email
  return {
    companyName: s.companyName,
    companyAddress: s.companyAddress,
    companyIds: s.companyIds,
    logoUrl: s.logoUrl,
    merchantAccountNumber: s.merchantAccountNumber,
    prefundedAccountNumber: s.prefundedAccountNumber,
    signatories: [
      {
        name: s.signatoryName,
        ...(s.signatoryTitle ? { title: s.signatoryTitle } : {}),
        ...(keepEmail ? { email: keepEmail } : {}),
      },
    ],
    to: s.to,
    cc: s.cc,
    fromEmail: s.fromEmail,
  }
}
