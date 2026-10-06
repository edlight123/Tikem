/**
 * WHEN a connected account's ticket money is allowed to reach their bank.
 *
 * Connected accounts sit on a manual payout schedule, so nothing leaves Stripe
 * until this says so. The rules are about TIME and MONEY, never attendance:
 * check-in counts are organizer-controlled (a manual check-in is
 * indistinguishable from a scan in stored data), so attendance can trigger a
 * human look but must never release funds.
 *
 * The tiers mirror how the category actually works — Posh gates payout speed on
 * cumulative revenue ($1k for daily payouts, $2k for pre-event "instant", the
 * latter activated by a human rather than automatically), and its baseline is
 * 24–48h to available, not days. Being materially slower than that costs
 * organizer supply, which is more expensive than the fraud it would prevent.
 *
 * Everything here is pure so the thresholds can be tested without Stripe or
 * Firestore.
 */

import {
  DEFAULT_PAYOUT_RELEASE_CONFIG,
  type PayoutReleaseConfig,
  type PayoutReleaseOverride,
} from '@/types/platform-settings'

export type PayoutRail = 'card' | 'moncash'

/**
 * Platform defaults, then this organizer's admin overrides on top. Every rule
 * below reads the RESOLVED config, so an admin can retune thresholds — globally
 * or for one promoter — without a deploy.
 */
export function resolveConfig(
  platform?: Partial<PayoutReleaseConfig> | null,
  override?: PayoutReleaseOverride | null
): PayoutReleaseConfig {
  const base = { ...DEFAULT_PAYOUT_RELEASE_CONFIG, ...(platform || {}) }
  if (!override) return base
  const picked: Partial<PayoutReleaseConfig> = {}
  if (typeof override.newHoldHours === 'number') picked.newHoldHours = override.newHoldHours
  if (typeof override.establishedHoldHours === 'number') picked.establishedHoldHours = override.establishedHoldHours
  if (typeof override.reviewAboveGrossMinor === 'number') picked.reviewAboveGrossMinor = override.reviewAboveGrossMinor
  return { ...base, ...picked }
}

/**
 * Convert an amount in `currency`'s minor units into the threshold currency's
 * minor units, for THRESHOLD COMPARISONS ONLY. Unknown currency → returned
 * unchanged, which is the conservative choice: it compares raw numbers rather
 * than silently scaling money by a rate nobody configured.
 */
export function toThresholdMinor(
  amountMinor: number,
  currency: string | null | undefined,
  cfg: PayoutReleaseConfig
): number {
  if (!currency) return amountMinor
  const code = currency.toUpperCase()
  if (code === (cfg.thresholdCurrency || 'USD').toUpperCase()) return amountMinor
  const rate = cfg.referenceRates?.[code]
  if (!rate || !Number.isFinite(rate) || rate <= 0) return amountMinor
  return Math.round(amountMinor * rate)
}

export type OrganizerHistory = {
  /** Events completed without a dispute or a refund storm. */
  completedEvents: number
  /** Lifetime gross ticket volume, minor units of the account currency. */
  lifetimeGrossMinor: number
  /** Currency those minor units are in. Used only to normalise thresholds. */
  currency?: string | null
  /**
   * Admin-granted: this organizer may be paid BEFORE their event ends. Never
   * automatic — it advances money against undelivered service, so it takes a
   * human who knows the promoter. Mirrors Posh's non-automatic Instant Pay.
   */
  preEventReleaseApproved?: boolean
  /** Admin-flagged risk: force every payout through review, ignore tiers. */
  highRisk?: boolean
  /** Admin says treat as established regardless of history (known promoter). */
  forceEstablished?: boolean
}

export type EventForRelease = {
  eventId: string
  organizerId: string
  /** Event end (ISO). Nothing releases before this unless pre-event is granted. */
  endsAt: string | null
  status: string | null
  /** events/{id}.payouts_frozen (a dispute, cancellation or admin freeze). Nothing releases. */
  payoutsFrozen?: boolean
  /** The earnings ledger's settlementStatus; 'cancelled' (lib/events/cancel.ts) releases nothing. */
  settlementStatus?: string | null
  /** Gross for THIS event, minor units. */
  grossMinor: number
  /** Currency of grossMinor/refundedMinor. Used only to normalise thresholds. */
  currency?: string | null
  /** Which rail the money came in on — card disputes exist, MonCash's don't. */
  rail: PayoutRail
  /** Share of tickets checked in, 0..1, or null when unknown. */
  checkedInRatio: number | null
  /** Share of check-ins entered by hand rather than scanned, 0..1, or null. */
  manualCheckInRatio: number | null
  /** Refunds already issued for this event, minor units. */
  refundedMinor: number
  hasOpenDispute: boolean
}

export type ReleaseTier = 'new' | 'established' | 'pre_event'

export type ReleaseDecision = {
  release: 'hold' | 'review' | 'auto'
  reason: string
  tier: ReleaseTier
  releasableMinor: number
}

/** Hold after the event ends, by tier. */
export const NEW_ORGANIZER_HOLD_HOURS = 72
export const ESTABLISHED_HOLD_HOURS = 24

/** Cumulative gross that earns the 24h hold (Posh's daily-payout threshold). */
export const ESTABLISHED_AFTER_GROSS_MINOR = 100_000 // $1,000 / 100k HTG
/** …or this many clean events, whichever comes first. */
export const ESTABLISHED_AFTER_EVENTS = 3
/** Cumulative gross that makes pre-event release *eligible* for admin approval. */
export const PRE_EVENT_ELIGIBLE_GROSS_MINOR = 200_000 // $2,000 / 200k HTG

/** Above this per-event gross, a still-new organizer goes to review. */
export const REVIEW_ABOVE_GROSS_MINOR = 100_000

export const MANUAL_CHECKIN_REVIEW_RATIO = 0.8
export const LOW_ATTENDANCE_REVIEW_RATIO = 0.2

export function isEstablished(history: OrganizerHistory, cfg: PayoutReleaseConfig): boolean {
  if (history.forceEstablished) return true
  return (
    history.completedEvents >= cfg.establishedAfterEvents ||
    toThresholdMinor(history.lifetimeGrossMinor, history.currency, cfg) >=
      cfg.establishedAfterGrossMinor
  )
}

export function isPreEventEligible(history: OrganizerHistory, cfg: PayoutReleaseConfig): boolean {
  return (
    toThresholdMinor(history.lifetimeGrossMinor, history.currency, cfg) >=
      cfg.preEventEligibleGrossMinor &&
    history.preEventReleaseApproved === true
  )
}

export function tierFor(history: OrganizerHistory, cfg: PayoutReleaseConfig): ReleaseTier {
  if (isPreEventEligible(history, cfg)) return 'pre_event'
  return isEstablished(history, cfg) ? 'established' : 'new'
}

export function holdHoursFor(history: OrganizerHistory, cfg: PayoutReleaseConfig): number {
  const tier = tierFor(history, cfg)
  if (tier === 'pre_event') return 0
  return tier === 'established' ? cfg.establishedHoldHours : cfg.newHoldHours
}

/**
 * Decide what (if anything) may be paid out for one event right now.
 * `availableMinor` is the connected account's genuinely available Stripe balance
 * — funds still inside Stripe's pending window cannot be paid out at all.
 */
export function decideRelease({
  event,
  history,
  availableMinor,
  config,
  now = new Date(),
}: {
  event: EventForRelease
  history: OrganizerHistory
  availableMinor: number
  config?: PayoutReleaseConfig
  now?: Date
}): ReleaseDecision {
  const cfg = config || DEFAULT_PAYOUT_RELEASE_CONFIG
  const tier = tierFor(history, cfg)
  const nothing = (reason: string): ReleaseDecision => ({
    release: 'hold',
    reason,
    tier,
    releasableMinor: 0,
  })

  if (event.status === 'cancelled') return nothing('event_cancelled')
  if (String(event.settlementStatus || '').toLowerCase() === 'cancelled') return nothing('event_cancelled')
  if (event.payoutsFrozen === true) return nothing('payouts_frozen')
  if (event.hasOpenDispute) return nothing('open_dispute')

  const endsAt = event.endsAt ? new Date(event.endsAt) : null
  const endsAtValid = !!endsAt && !Number.isNaN(endsAt.getTime())

  if (tier !== 'pre_event') {
    // No end date means we cannot prove the event happened. Such events used to
    // settle off created_at, i.e. were withdrawable immediately.
    if (!endsAtValid) return nothing('no_end_date')
    if (now < (endsAt as Date)) return nothing('event_not_over')

    const hoursSinceEnd = (now.getTime() - (endsAt as Date).getTime()) / 3_600_000
    const requiredHold = holdHoursFor(history, cfg)
    if (hoursSinceEnd < requiredHold) return nothing(`hold_${requiredHold}h`)
  }

  // No reserve is withheld. Holding back a slice of every organizer's takings
  // taxes the working capital of people who did nothing wrong, and a promoter who
  // paid the venue out of pocket feels it immediately. Chargeback exposure is
  // handled by holding until AFTER the event, by reverse_transfer clawback while
  // the organizer still has a Stripe balance, and by review on the risky signals.
  const net = Math.max(0, event.grossMinor - event.refundedMinor)
  const releasableMinor = Math.max(0, Math.min(net, availableMinor))

  if (releasableMinor <= 0) return nothing('nothing_available_yet')

  const decision = (release: 'review' | 'auto', reason: string): ReleaseDecision => ({
    release,
    reason,
    tier,
    releasableMinor,
  })

  if (history.highRisk) return decision('review', 'organizer_flagged_high_risk')

  // Signals that want human eyes rather than an automatic transfer. None of
  // these block the organizer — they route to the admin queue.
  if (
    toThresholdMinor(event.grossMinor, event.currency, cfg) >= cfg.reviewAboveGrossMinor &&
    !isEstablished(history, cfg)
  ) {
    return decision('review', 'large_event_from_new_organizer')
  }
  if (
    event.manualCheckInRatio !== null &&
    event.manualCheckInRatio >= cfg.manualCheckInReviewRatio &&
    event.checkedInRatio !== null &&
    event.checkedInRatio > 0
  ) {
    return decision('review', 'mostly_manual_checkins')
  }
  if (event.checkedInRatio !== null && event.checkedInRatio < cfg.lowAttendanceReviewRatio) {
    return decision('review', 'very_low_attendance')
  }

  return decision('auto', 'eligible')
}
