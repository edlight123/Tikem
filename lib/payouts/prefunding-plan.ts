/**
 * MonCash prefunding planner: how much to ask Digicel to move from Tikèm's
 * MonCash MERCHANT (collections) account into the PREFUNDED pool that organizer
 * MonCash payouts are sent from.
 *
 * Nothing here moves money or sends email. It answers three questions for the
 * HTG / MonCash rail, from facts the caller loads
 * (lib/payouts/prefunding-plan-server.ts):
 *
 *  - MINIMUM: what the pool must hold to pay everything that becomes
 *    withdrawable within the next N Haiti business days (default 2), plus the
 *    MonCash withdrawals already requested but not yet sent.
 *        owed      = Σ balance of events withdrawable now or by the horizon
 *                  + Σ unsent MonCash withdrawals
 *        need      = ceil(owed x poolFeeFactor)              (Digicel's 3%)
 *        minimum   = roundUp(max(0, need − pool balance), step)
 *
 *  - RECOMMENDED: the same over the next D calendar days (default 7), with a
 *    buffer (default 15%):
 *        need      = ceil(owed7d x poolFeeFactor x (1 + buffer))
 *        recommended = roundUp(max(0, need − pool balance), step), capped at MAXIMUM
 *
 *  - MAXIMUM: the most it is SAFE to take out of the merchant account — only
 *    money that already belongs to organizers and can no longer be needed for
 *    a buyer refund:
 *        movable   = Σ balance of events that have ENDED and passed their release
 *                    hold (released now) + Σ unsent MonCash withdrawals
 *        maximum   = roundDown(max(0, floor(movable x poolFeeFactor) − pool balance), step)
 *    "balance" is computeEventAvailability's balanceMinor: the organizer's NET
 *    (Tikèm's platform fee and the MonCash collection fee Tikèm absorbs are never
 *    in it), less refunds paid, in flight or requested, less promoter commission,
 *    less everything already withdrawn or paid. Upcoming and ongoing events,
 *    pre-event releases, payout reviews, frozen / cancelled events and currency
 *    reviews are excluded: that money stays in the merchant account.
 *    The poolFeeFactor on the maximum covers Digicel's 3% on paying that money
 *    out, which Tikèm owes from its own fee revenue (see report assumptions).
 *
 * Release timing is computeEventAvailability (lib/payouts/availability.ts) and
 * therefore lib/payouts/release-rules.ts: this module never re-derives a
 * balance or a hold. It only buckets the engine's answers by WHEN.
 *
 * Money is HTG minor units (centimes) inside, whole HTG on the three outputs.
 */

import type { AvailabilityReason } from '@/lib/payouts/availability'
import {
  endOfHaitiDayAfter,
  endOfNthBusinessDayAfter,
  haitiDay,
  nextDigicelCutoff,
  sendByFor,
  type DigicelCutoff,
} from '@/lib/payouts/haiti-business-time'
import { DEFAULT_PREFUNDING_PLAN_CONFIG, type PrefundingPlanConfig } from '@/lib/payouts/prefunding-config'

// ── Inputs ──────────────────────────────────────────────────────────────────

/** Which rail the organizer's Haiti payout profile points at. */
export type PayoutRailChoice = 'moncash' | 'bank' | 'unknown'

/** The subset of EventAvailability the planner reads, plus labels. */
export type PlanEventInput = {
  eventId: string
  title: string
  organizerId: string
  organizerName?: string | null
  currency: string
  /** Organizers whose Haiti profile is a BANK account are paid off-pool. */
  payoutRail: PayoutRailChoice
  /** computeEventAvailability(...) fields, unmodified. */
  balanceMinor: number
  availableNowMinor: number
  releasedNow: boolean
  reason: AvailabilityReason | string
  /** When the hold lifts (ISO), per release-rules. */
  availableAt: string | null
  /** The event end the hold counts from (ISO). */
  effectiveEndsAt: string | null
}

export type PlanWithdrawalInput = {
  id: string
  organizerId: string
  eventId?: string | null
  /** What will be SENT to the receiver, HTG minor units. Null = unknown. */
  amountHtgMinor: number | null
  status: string
  createdAt?: string | null
  payeeType?: string | null
}

export type PrefundingPlanInput = {
  now: Date
  events: PlanEventInput[]
  /** MonCash withdrawals filed but not yet transferred (pending / approved). */
  unsentWithdrawals: PlanWithdrawalInput[]
  /** Live prefunded balance in HTG (major units, as MonCash reports it). Null = the call failed. */
  poolBalanceHtg: number | null
  config?: PrefundingPlanConfig
}

// ── Outputs ─────────────────────────────────────────────────────────────────

export type PlanBucket =
  /** Ended, hold passed, withdrawable now: counts in all three numbers. */
  | 'available_now'
  /** Withdrawable now BEFORE the event ended (admin pre-event grant): minimum, not maximum. */
  | 'pre_event'
  /** Becomes withdrawable within the minimum horizon. */
  | 'due_soon'
  /** Becomes withdrawable within the recommended horizon. */
  | 'due_week'
  /** Becomes withdrawable after the recommended horizon. */
  | 'later'
  /** Held by a review, freeze, cancellation or integrity check: excluded. */
  | 'held'
  /** Organizer is paid by bank, not MonCash: excluded. */
  | 'bank_rail'
  /** Not an HTG event: excluded (this planner is HTG only). */
  | 'other_currency'

export type PlanRow = {
  eventId: string
  title: string
  organizerId: string
  organizerName: string | null
  bucket: PlanBucket
  /** When the money becomes (or became) withdrawable, ISO. Null when unknown. */
  releaseAt: string | null
  /** Organizer money for this event, HTG minor units. */
  amountMinor: number
  reason: string
  countsIn: { minimum: boolean; recommended: boolean; maximum: boolean }
}

export type PlanWarning = {
  code:
    | 'pool_balance_unknown'
    | 'pool_below_minimum_need'
    | 'minimum_exceeds_maximum'
    | 'recommended_capped'
    | 'owed_now_uncovered'
    | 'deadline_passed'
    | 'pre_event_not_movable'
    | 'under_review_excluded'
    | 'held_excluded'
    | 'other_currency_excluded'
    | 'withdrawal_amount_unknown'
    | 'account_numbers_missing'
  severity: 'critical' | 'warning' | 'info'
  /** Blocks generating a Digicel request until resolved. */
  blocking?: boolean
  message: string
}

export type PlanDeadline = {
  /** Haiti day the money becomes withdrawable. */
  day: string
  /** First moment on that day it does, ISO (now, for money withdrawable already). */
  dueAt: string
  owedMinor: number
  cumulativeOwedMinor: number
  /** Pool needed to cover everything up to and including this day. */
  cumulativePoolNeedMinor: number
  /** The pool (as last read) already covers it. */
  covered: boolean
  /** Latest Digicel cutoff to send a request for it, ISO; null when already due. */
  sendBy: string | null
  eventCount: number
}

export type PrefundingPlan = {
  computedAt: string
  currency: 'HTG'
  poolBalanceHtg: number | null
  minimum: {
    amountHtg: number
    owedMinor: number
    poolNeedMinor: number
    shortfallMinor: number
    horizonEnd: string
  }
  recommended: {
    amountHtg: number
    /** Before the cap at maximum. */
    uncappedAmountHtg: number
    cappedAtMaximum: boolean
    owedMinor: number
    poolNeedMinor: number
    shortfallMinor: number
    horizonEnd: string
  }
  maximum: {
    amountHtg: number
    /** Organizer money for ended, released events + unsent withdrawals. */
    movableMinor: number
    /** movable x poolFeeFactor. */
    poolEquivalentMinor: number
  }
  unsentWithdrawalsMinor: number
  rows: PlanRow[]
  withdrawals: PlanWithdrawalInput[]
  deadlines: PlanDeadline[]
  cutoff: DigicelCutoff
  warnings: PlanWarning[]
  /** Nothing owed at all over the recommended horizon and nothing movable. */
  nothingDue: boolean
  settings: {
    minimumHorizonBusinessDays: number
    recommendedHorizonDays: number
    recommendedBufferPercent: number
    roundingStepHtg: number
    poolFeeFactor: number
    cutoffHourHaiti: number
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Reasons that keep an event's money out of every number. */
const HELD_REASONS = new Set<string>([
  'payouts_frozen',
  'event_cancelled',
  'earnings_currency_review',
  'ticket_currency_review',
  'ledger_gross_exceeded',
  'release_unknown',
  'payout_under_review',
  'no_end_date',
  'open_dispute',
])

const EPS = 1e-9

/** Round a minor-unit amount UP to a whole step of HTG; returns whole HTG. */
export function roundUpHtg(minor: number, stepHtg: number): number {
  if (!(minor > 0)) return 0
  const stepMinor = stepHtg * 100
  return (Math.ceil(minor / stepMinor - EPS) * stepMinor) / 100
}

/** Round a minor-unit amount DOWN to a whole step of HTG; returns whole HTG. */
export function roundDownHtg(minor: number, stepHtg: number): number {
  if (!(minor > 0)) return 0
  const stepMinor = stepHtg * 100
  return (Math.floor(minor / stepMinor + EPS) * stepMinor) / 100
}

const nonNeg = (n: unknown) => {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0
}

export function formatHtg(minorOrMajor: number, unit: 'minor' | 'major' = 'major'): string {
  const major = unit === 'minor' ? minorOrMajor / 100 : minorOrMajor
  const rounded = Math.round(major)
  return `${rounded.toLocaleString('en-US')} HTG`
}

function dateOrNull(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

// ── Bucketing ───────────────────────────────────────────────────────────────

export function bucketEvent(
  e: PlanEventInput,
  now: Date,
  minimumEnd: Date,
  recommendedEnd: Date
): { bucket: PlanBucket; releaseAt: string | null; amountMinor: number } {
  const balance = nonNeg(e.balanceMinor)
  const ends = dateOrNull(e.effectiveEndsAt)
  const at = dateOrNull(e.availableAt)

  if (String(e.currency || '').toUpperCase() !== 'HTG') return { bucket: 'other_currency', releaseAt: e.availableAt, amountMinor: balance }
  if (e.payoutRail === 'bank') return { bucket: 'bank_rail', releaseAt: e.availableAt, amountMinor: balance }

  if (e.releasedNow && nonNeg(e.availableNowMinor) > 0) {
    const amount = Math.max(nonNeg(e.availableNowMinor), balance)
    const ended = !!ends && ends.getTime() <= now.getTime()
    return { bucket: ended ? 'available_now' : 'pre_event', releaseAt: at ? at.toISOString() : now.toISOString(), amountMinor: amount }
  }

  if (HELD_REASONS.has(String(e.reason))) return { bucket: 'held', releaseAt: e.availableAt, amountMinor: balance }
  if (!at) return { bucket: 'held', releaseAt: null, amountMinor: balance }

  // A hold that has lapsed without a release (e.g. the ladder will route it to
  // review) is still money that may be asked for at any moment.
  if (at.getTime() <= minimumEnd.getTime()) return { bucket: 'due_soon', releaseAt: at.toISOString(), amountMinor: balance }
  if (at.getTime() <= recommendedEnd.getTime()) return { bucket: 'due_week', releaseAt: at.toISOString(), amountMinor: balance }
  return { bucket: 'later', releaseAt: at.toISOString(), amountMinor: balance }
}

const COUNTS: Record<PlanBucket, PlanRow['countsIn']> = {
  available_now: { minimum: true, recommended: true, maximum: true },
  pre_event: { minimum: true, recommended: true, maximum: false },
  due_soon: { minimum: true, recommended: true, maximum: false },
  due_week: { minimum: false, recommended: true, maximum: false },
  later: { minimum: false, recommended: false, maximum: false },
  held: { minimum: false, recommended: false, maximum: false },
  bank_rail: { minimum: false, recommended: false, maximum: false },
  other_currency: { minimum: false, recommended: false, maximum: false },
}

// ── The plan ────────────────────────────────────────────────────────────────

export function computePrefundingPlan(input: PrefundingPlanInput): PrefundingPlan {
  const cfg = input.config || DEFAULT_PREFUNDING_PLAN_CONFIG
  const now = input.now
  const step = cfg.roundingStepHtg
  const factor = cfg.poolFeeFactor
  const holidays = cfg.holidays

  const minimumEnd = endOfNthBusinessDayAfter(now, cfg.minimumHorizonBusinessDays, holidays)
  const recommendedEnd = endOfHaitiDayAfter(now, cfg.recommendedHorizonDays)
  const cutoff = nextDigicelCutoff(now, cfg.cutoffHourHaiti, holidays)

  const balanceKnown = typeof input.poolBalanceHtg === 'number' && Number.isFinite(input.poolBalanceHtg)
  const poolMinor = balanceKnown ? Math.max(0, Math.round((input.poolBalanceHtg as number) * 100)) : 0

  // ── rows ──
  const rows: PlanRow[] = []
  for (const e of input.events || []) {
    const { bucket, releaseAt, amountMinor } = bucketEvent(e, now, minimumEnd, recommendedEnd)
    if (amountMinor <= 0) continue // nothing owed: not worth a row
    rows.push({
      eventId: e.eventId,
      title: e.title,
      organizerId: e.organizerId,
      organizerName: e.organizerName ?? null,
      bucket,
      releaseAt,
      amountMinor,
      reason: String(e.reason || ''),
      countsIn: COUNTS[bucket],
    })
  }
  rows.sort((a, b) => {
    const ta = dateOrNull(a.releaseAt)?.getTime() ?? Number.MAX_SAFE_INTEGER
    const tb = dateOrNull(b.releaseAt)?.getTime() ?? Number.MAX_SAFE_INTEGER
    return ta - tb || b.amountMinor - a.amountMinor
  })

  const withdrawals = (input.unsentWithdrawals || []).slice()
  const unsentWithdrawalsMinor = withdrawals.reduce((s, w) => s + nonNeg(w.amountHtgMinor), 0)

  const sum = (pick: (r: PlanRow) => boolean) => rows.filter(pick).reduce((s, r) => s + r.amountMinor, 0)

  // ── minimum ──
  const minOwed = sum((r) => r.countsIn.minimum) + unsentWithdrawalsMinor
  const minNeed = Math.ceil(minOwed * factor - EPS)
  const minShort = Math.max(0, minNeed - poolMinor)
  const minimumHtg = roundUpHtg(minShort, step)

  // ── recommended ──
  const recOwed = sum((r) => r.countsIn.recommended) + unsentWithdrawalsMinor
  const recNeed = Math.ceil(recOwed * factor * (1 + cfg.recommendedBufferPercent) - EPS)
  const recShort = Math.max(0, recNeed - poolMinor)
  const recUncapped = roundUpHtg(recShort, step)

  // ── maximum ──
  const movable = sum((r) => r.countsIn.maximum) + unsentWithdrawalsMinor
  const movablePool = Math.floor(movable * factor + EPS)
  const maximumHtg = roundDownHtg(Math.max(0, movablePool - poolMinor), step)

  const recommendedHtg = Math.min(recUncapped, maximumHtg)

  // ── deadlines ──
  type Due = { at: Date; owed: number; events: number }
  const dues: Due[] = []
  for (const r of rows) {
    if (!r.countsIn.recommended) continue
    const at = r.bucket === 'available_now' || r.bucket === 'pre_event' ? now : dateOrNull(r.releaseAt) || now
    dues.push({ at: at.getTime() < now.getTime() ? now : at, owed: r.amountMinor, events: 1 })
  }
  if (unsentWithdrawalsMinor > 0) dues.push({ at: now, owed: unsentWithdrawalsMinor, events: 0 })
  dues.sort((a, b) => a.at.getTime() - b.at.getTime())

  const byDay = new Map<string, { dueAt: Date; owed: number; events: number }>()
  for (const d of dues) {
    const key = d.at.getTime() <= now.getTime() ? 'now' : haitiDay(d.at)
    const cur = byDay.get(key)
    if (cur) {
      cur.owed += d.owed
      cur.events += d.events
    } else byDay.set(key, { dueAt: d.at, owed: d.owed, events: d.events })
  }
  const deadlines: PlanDeadline[] = []
  let cumulative = 0
  for (const [key, v] of Array.from(byDay.entries())) {
    cumulative += v.owed
    const need = Math.ceil(cumulative * factor - EPS)
    const alreadyDue = key === 'now'
    deadlines.push({
      day: alreadyDue ? haitiDay(now) : key,
      dueAt: v.dueAt.toISOString(),
      owedMinor: v.owed,
      cumulativeOwedMinor: cumulative,
      cumulativePoolNeedMinor: need,
      covered: balanceKnown && poolMinor >= need,
      sendBy: alreadyDue ? null : sendByFor(v.dueAt, cfg.cutoffHourHaiti, holidays).toISOString(),
      eventCount: v.events,
    })
  }

  // ── warnings ──
  const warnings: PlanWarning[] = []
  const fmt = (minor: number) => formatHtg(minor, 'minor')

  if (!balanceKnown) {
    warnings.push({
      code: 'pool_balance_unknown',
      severity: 'critical',
      blocking: true,
      message:
        'The live prefunded balance could not be read from MonCash, so the numbers below assume an empty pool. Do not send a request until the balance loads: the maximum would overstate what is safe to move.',
    })
  } else if (minNeed > 0 && poolMinor < minNeed) {
    warnings.push({
      code: 'pool_below_minimum_need',
      severity: 'critical',
      message: `The pool holds ${fmt(poolMinor)} but payouts due within ${cfg.minimumHorizonBusinessDays} business days need ${fmt(minNeed)} (including Digicel's ${Math.round((factor - 1) * 100)}% transfer fee).`,
    })
  }

  if (minimumHtg > maximumHtg) {
    const roundingOnly = Math.max(0, minNeed - poolMinor) <= Math.max(0, movablePool - poolMinor)
    warnings.push({
      code: 'minimum_exceeds_maximum',
      severity: roundingOnly ? 'info' : 'critical',
      message: roundingOnly
        ? `The minimum rounds up to ${formatHtg(minimumHtg)} but only ${formatHtg(maximumHtg)} rounds down as movable. The gap is rounding: request the maximum, and it still covers what is due.`
        : `Money owed within ${cfg.minimumHorizonBusinessDays} business days (${formatHtg(minimumHtg)} to request) is more than what can safely leave the merchant account now (${formatHtg(maximumHtg)}). Some of it is for events that have not ended yet or are still in their hold, so a request today cannot fully cover the deadline. Request the maximum now and plan a second request once those events release.`,
    })
  }

  if (recUncapped > recommendedHtg) {
    warnings.push({
      code: 'recommended_capped',
      severity: 'info',
      message: `The 7-day need with buffer is ${formatHtg(recUncapped)}, capped at the safe maximum of ${formatHtg(maximumHtg)}.`,
    })
  }

  const firstDue = deadlines[0]
  if (firstDue && !firstDue.sendBy && !firstDue.covered) {
    warnings.push({
      code: 'owed_now_uncovered',
      severity: 'critical',
      message: `${fmt(firstDue.cumulativeOwedMinor)} is withdrawable to MonCash right now (or already requested) and the pool does not cover it. Organizers asking for it now will be queued for a manual payout.`,
    })
  }
  const missed = deadlines.find(
    (d) => d.sendBy && !d.covered && new Date(d.sendBy).getTime() < now.getTime()
  )
  if (missed) {
    warnings.push({
      code: 'deadline_passed',
      severity: 'critical',
      message: `${fmt(missed.owedMinor)} becomes withdrawable on ${missed.day}; the last Digicel cutoff to fund it in time was ${missed.sendBy}. A request now lands ${cutoff.label}.`,
    })
  }

  const pre = rows.filter((r) => r.bucket === 'pre_event')
  if (pre.length) {
    warnings.push({
      code: 'pre_event_not_movable',
      severity: 'warning',
      message: `${pre.length} event(s) with an admin pre-event release (${fmt(pre.reduce((s, r) => s + r.amountMinor, 0))}) count toward the minimum but not the maximum: the events have not ended, so their money stays in the merchant account for refunds.`,
    })
  }
  const review = rows.filter((r) => r.bucket === 'held' && r.reason === 'payout_under_review')
  if (review.length) {
    warnings.push({
      code: 'under_review_excluded',
      severity: 'info',
      message: `${review.length} event(s) under payout review (${fmt(review.reduce((s, r) => s + r.amountMinor, 0))}) are excluded. If an admin releases one, it is withdrawable at once.`,
    })
  }
  const held = rows.filter((r) => r.bucket === 'held' && r.reason !== 'payout_under_review')
  if (held.length) {
    warnings.push({
      code: 'held_excluded',
      severity: 'info',
      message: `${held.length} event(s) are held (frozen, cancelled, missing an end date or in an integrity review: ${fmt(held.reduce((s, r) => s + r.amountMinor, 0))}) and are excluded.`,
    })
  }
  const other = rows.filter((r) => r.bucket === 'other_currency')
  if (other.length) {
    warnings.push({
      code: 'other_currency_excluded',
      severity: 'info',
      message: `${other.length} Haiti event(s) priced in another currency are not included; this planner covers HTG only.`,
    })
  }
  const unknown = withdrawals.filter((w) => w.amountHtgMinor === null || !(Number(w.amountHtgMinor) > 0))
  if (unknown.length) {
    warnings.push({
      code: 'withdrawal_amount_unknown',
      severity: 'warning',
      message: `${unknown.length} unsent MonCash withdrawal(s) have no HTG payout amount recorded and are counted as 0. Check them in Withdrawals.`,
    })
  }
  const missingAccounts: string[] = []
  if (!cfg.digicel.merchantAccountNumber) missingAccounts.push('merchant account number')
  if (!cfg.digicel.prefundedAccountNumber) missingAccounts.push('prefunded account number')
  if (missingAccounts.length) {
    warnings.push({
      code: 'account_numbers_missing',
      severity: 'warning',
      message: `The ${missingAccounts.join(' and ')} ${missingAccounts.length > 1 ? 'are' : 'is'} not set in config/payouts.prefundingPlan.digicel; the letter will say "[à compléter]" until it is.`,
    })
  }

  const nothingDue = recOwed === 0 && movable === 0

  return {
    computedAt: now.toISOString(),
    currency: 'HTG',
    poolBalanceHtg: balanceKnown ? (input.poolBalanceHtg as number) : null,
    minimum: {
      amountHtg: minimumHtg,
      owedMinor: minOwed,
      poolNeedMinor: minNeed,
      shortfallMinor: minShort,
      horizonEnd: minimumEnd.toISOString(),
    },
    recommended: {
      amountHtg: recommendedHtg,
      uncappedAmountHtg: recUncapped,
      cappedAtMaximum: recUncapped > recommendedHtg,
      owedMinor: recOwed,
      poolNeedMinor: recNeed,
      shortfallMinor: recShort,
      horizonEnd: recommendedEnd.toISOString(),
    },
    maximum: { amountHtg: maximumHtg, movableMinor: movable, poolEquivalentMinor: movablePool },
    unsentWithdrawalsMinor,
    rows,
    withdrawals,
    deadlines,
    cutoff,
    warnings,
    nothingDue,
    settings: {
      minimumHorizonBusinessDays: cfg.minimumHorizonBusinessDays,
      recommendedHorizonDays: cfg.recommendedHorizonDays,
      recommendedBufferPercent: cfg.recommendedBufferPercent,
      roundingStepHtg: cfg.roundingStepHtg,
      poolFeeFactor: cfg.poolFeeFactor,
      cutoffHourHaiti: cfg.cutoffHourHaiti,
    },
  }
}

/**
 * Whether a custom amount may be requested: a whole step of HTG, at least the
 * minimum and at most the maximum. When the minimum exceeds the maximum (money
 * due soon is not yet movable) the maximum is the only safe ceiling, so any
 * amount up to it is accepted.
 */
export function validateRequestAmount(
  amountHtg: number,
  plan: Pick<PrefundingPlan, 'minimum' | 'maximum' | 'settings'>
): { ok: true } | { ok: false; error: string } {
  const step = plan.settings.roundingStepHtg
  const min = plan.minimum.amountHtg
  const max = plan.maximum.amountHtg
  if (!Number.isFinite(amountHtg) || amountHtg <= 0) return { ok: false, error: 'Enter an amount above 0.' }
  if (amountHtg % step !== 0) return { ok: false, error: `Use a multiple of ${step.toLocaleString('en-US')} HTG.` }
  if (amountHtg > max) return { ok: false, error: `That is more than the safe maximum of ${formatHtg(max)}.` }
  const floor = Math.min(min, max)
  if (amountHtg < floor) return { ok: false, error: `That is below the minimum of ${formatHtg(floor)}.` }
  return { ok: true }
}

/** The low-balance alert's condition: the pool is below the 2-day need (in pool terms). */
export function poolBelowMinimumNeed(plan: Pick<PrefundingPlan, 'poolBalanceHtg' | 'minimum'>): boolean {
  if (plan.poolBalanceHtg === null) return false
  return plan.minimum.poolNeedMinor > 0 && Math.round(plan.poolBalanceHtg * 100) < plan.minimum.poolNeedMinor
}
