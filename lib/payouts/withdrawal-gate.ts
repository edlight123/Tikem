/**
 * The payout release ladder, applied to the HAITI rail.
 *
 * The Stripe rail is a push: /api/cron/release-payouts decides when money leaves
 * a connected account. The Haiti rail is a pull — the organizer REQUESTS a
 * withdrawal and an admin moves money out of a platform-held balance. There is no
 * cron to gate, so the same judgement has to happen at request time, which is
 * what this file does: it assembles the exact same EventForRelease /
 * OrganizerHistory / resolved-config triple the cron assembles and calls the same
 * pure decideRelease(). Nothing here re-implements a threshold.
 *
 * Two things about this rail genuinely differ from cards, and are handled rather
 * than pretended away:
 *
 *  - MonCash and Haitian bank transfers have NO chargeback mechanism. There is no
 *    dispute object to look up and no clawback window, so `hasOpenDispute` is
 *    always false here and nothing imports Stripe's dispute assumptions. What the
 *    hold protects against on this rail is the organizer who sells out, never
 *    holds the event, and disappears with money that buyers are owed back — which
 *    is precisely why the "not before the event ends" rule matters MORE here, not
 *    less: once gourdes are in a MonCash wallet, they are gone.
 *  - "Available balance" is not a Stripe balance. It is the platform's own ledger
 *    of what this organizer has not yet withdrawn for the event
 *    (event_earnings.availableToWithdraw), so the caller passes that in.
 *
 * There is NO reserve, on either rail. A percentage withheld from every honest
 * promoter's takings is a tax on the people who did nothing wrong.
 */

import { adminDb } from '@/lib/firebase/admin'
import { getPlatformSettings } from '@/lib/admin/platform-settings'
import {
  DEFAULT_PAYOUT_RELEASE_CONFIG,
  type PayoutReleaseConfig,
  type PayoutReleaseOverride,
} from '@/types/platform-settings'
import { FX_SNAPSHOT_DOC, resolveReferenceRates, type FxSnapshot } from '@/lib/payouts/fx-rates'
import { ticketFactsFromDocs, type TicketFacts } from '@/lib/payouts/availability'
import {
  decideRelease,
  holdHoursFor,
  resolveConfig,
  type EventForRelease,
  type OrganizerHistory,
  type ReleaseDecision,
} from '@/lib/payouts/release-rules'

/** Which Haiti request path asked — recorded on the review row for admins. */
export type ReleaseGateMethod = 'moncash' | 'bank' | 'batch'

/**
 * Stable reason codes. The English `message` is a fallback for clients that only
 * know how to show a string (the web and mobile withdrawal sheets both do); the
 * `code` + `params` pair is what a translated string should be keyed on.
 */
export type ReleaseGateCode =
  | 'payouts_frozen'
  | 'event_cancelled'
  | 'missing_event_end_date'
  | 'event_not_over'
  | 'release_hold'
  | 'nothing_releasable_yet'
  | 'amount_exceeds_releasable'
  | 'payout_under_review'
  | 'payout_review_not_approved'

export type ReleaseGateErrorBody = {
  error: string
  message: string
  code: ReleaseGateCode
  /** decideRelease()'s own machine reason, for logs and support. */
  reason: string
  tier: ReleaseDecision['tier'] | null
  params: {
    holdHours?: number
    endsAt?: string | null
    availableAt?: string | null
    releasableMinor?: number
    requestedMinor?: number
    currency?: string | null
  }
}

export type ReleaseGateResult =
  | {
      allowed: true
      decision: ReleaseDecision
      /** Existing review-queue status, if this event has ever been queued. */
      reviewStatus: string | null
    }
  | {
      allowed: false
      status: number
      body: ReleaseGateErrorBody
      decision: ReleaseDecision | null
    }

// ── Per-organizer facts, loadable once and reused across events ─────────────

export type OrganizerReleaseContext = {
  organizerId: string
  /** Platform payoutRelease config with FX reference rates resolved. */
  platformConfig: Partial<PayoutReleaseConfig>
  override: PayoutReleaseOverride | null
  /** Ended, non-cancelled events. The event being judged is subtracted at use. */
  endedEventIds: Set<string>
  lifetimeGrossMinorByCurrency: Record<string, number>
  fxWarnings: string[]
}

function toDateOrNull(value: any): Date | null {
  if (!value) return null
  const raw = value?.toDate ? value.toDate() : value
  const date = raw instanceof Date ? raw : new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

function toMinor(value: unknown): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function formatMoney(minor: number, currency: string | null | undefined): string {
  const amount = (Math.max(0, minor) / 100).toFixed(2)
  return currency ? `${amount} ${String(currency).toUpperCase()}` : amount
}

/**
 * The organizer-level inputs to the ladder, gathered exactly as
 * /api/cron/release-payouts gathers them:
 *
 *  - platform payoutRelease config, with FX reference rates merged from the daily
 *    snapshot over the admin-maintained table (READ, never fetched — a rate lookup
 *    failing mid-request would change who gets paid);
 *  - the per-organizer admin override on organizers/{id}.payoutRelease;
 *  - history: how many of their events have ended, and lifetime gross per currency.
 *
 * Exported so a caller judging several events in one request loads it once.
 */
export async function loadOrganizerReleaseContext(
  organizerId: string,
  now: Date = new Date()
): Promise<OrganizerReleaseContext> {
  const [platformSettings, fxSnap, organizerSnap, eventsSnap, earningsSnap] = await Promise.all([
    getPlatformSettings(),
    adminDb.collection('platform_settings').doc(FX_SNAPSHOT_DOC).get().catch(() => null),
    adminDb.collection('organizers').doc(organizerId).get().catch(() => null),
    adminDb
      .collection('events')
      .where('organizer_id', '==', organizerId)
      .select('end_datetime', 'status')
      .get(),
    adminDb
      .collection('event_earnings')
      .where('organizerId', '==', organizerId)
      .select('grossSales', 'currency')
      .get(),
  ])

  const rawPlatformConfig = platformSettings.payoutRelease || null
  const fxSnapshot = ((fxSnap?.data() || null) as FxSnapshot | null) || null
  const resolvedRates = resolveReferenceRates(
    { ...DEFAULT_PAYOUT_RELEASE_CONFIG, ...(rawPlatformConfig || {}) },
    fxSnapshot,
    now
  )

  const endedEventIds = new Set<string>()
  for (const doc of eventsSnap.docs) {
    const data = (doc.data() || {}) as any
    if (String(data.status || '') === 'cancelled') continue
    // end_datetime ONLY — the same field the cron counts. An event with no end
    // date has not been shown to have happened, so it cannot count as a
    // completed event that earns a shorter hold.
    const end = toDateOrNull(data.end_datetime)
    if (end && end.getTime() <= now.getTime()) endedEventIds.add(doc.id)
  }

  // Kept per currency: summing USD cents with HTG cents would be arithmetic
  // fiction, and the tier thresholds are single-currency figures.
  const lifetimeGrossMinorByCurrency: Record<string, number> = {}
  for (const doc of earningsSnap.docs) {
    const data = (doc.data() || {}) as any
    const currency = String(data.currency || '').toUpperCase() || 'UNKNOWN'
    lifetimeGrossMinorByCurrency[currency] =
      (lifetimeGrossMinorByCurrency[currency] || 0) + Math.max(0, toMinor(data.grossSales))
  }

  if (resolvedRates.warnings.length) {
    // Which FX numbers were used decides who counts as established, so a fallback
    // is never silent.
    console.warn('[payouts/withdrawal-gate] FX:', resolvedRates.warnings.join(' | '))
  }

  return {
    organizerId,
    platformConfig: { ...(rawPlatformConfig || {}), referenceRates: resolvedRates.rates },
    override: (organizerSnap?.exists ? ((organizerSnap.data() as any)?.payoutRelease || null) : null) as
      | PayoutReleaseOverride
      | null,
    endedEventIds,
    lifetimeGrossMinorByCurrency,
    fxWarnings: resolvedRates.warnings,
  }
}

// ── Per-event ticket facts ──────────────────────────────────────────────────

/**
 * One pass over the event's tickets for the attendance signals and refund total.
 *
 * manualCheckInRatio comes from check_in_method. Rows written before that field
 * existed carry no method and are excluded from the denominator rather than
 * counted as scans — inferring "scan" from silence would clear exactly the doors
 * this signal exists to catch. No payment ids are read: this rail has no disputes
 * to attribute.
 */
async function loadTicketFacts(eventId: string): Promise<TicketFacts> {
  const snapshot = await adminDb
    .collection('tickets')
    .where('event_id', '==', eventId)
    .select(
      'status',
      'checked_in',
      'check_in_method',
      'price_paid',
      'pricePaid',
      'refund_status',
      'refund_amount',
      // Refunds count at face value in the event currency (ticketRefundedFaceMinor).
      'refund_face_amount',
      'refund_currency',
      'currency',
      'original_currency'
    )
    .get()

  // One definition, shared with lib/payouts/availability.ts, so the figure a
  // screen shows and the decision this gate takes are fed identical facts.
  return ticketFactsFromDocs(snapshot.docs.map((doc: any) => doc.data() || {}))
}

// ── Shared, side-effect-free decision assembly ──────────────────────────────

/**
 * Everything the ladder needs to judge ONE event, gathered without writing
 * anything.
 *
 * Both the gate (which refuses a withdrawal) and `previewRelease` (which tells
 * the organizer when their money is due) go through here, so the date shown on
 * the earnings screen and the date enforced at submit are computed once. When
 * they were computed separately, the screen could promise money the gate would
 * then refuse — which is the exact surprise this exists to prevent.
 */
async function buildReleaseInputs(args: {
  eventId: string
  organizerId: string
  eventData: any
  currency: string | null
  availableMinor: number
  grossMinor: number
  refundedMinor?: number | null
  context?: OrganizerReleaseContext
  now: Date
}): Promise<{
  decision: ReleaseDecision
  endsAt: Date | null
  refundedMinor: number
  history: OrganizerHistory
  config: PayoutReleaseConfig
  context: OrganizerReleaseContext
}> {
  const { eventId, organizerId, eventData, currency, availableMinor, now } = args
  const context = args.context || (await loadOrganizerReleaseContext(organizerId, now))
  const config = resolveConfig(context.platformConfig, context.override)

  /**
   * The end of the event, and nothing else.
   *
   * lib/earnings.ts settles off `start_datetime` and then `created_at` when
   * `end_datetime` is missing, which is why an undated event was withdrawable the
   * moment it was created. The ladder is a promise about time AFTER the event, so
   * an event with no parseable end date has no ladder to climb: decideRelease()
   * holds it as `no_end_date`. A start time is not an end time and is not
   * substituted here.
   */
  const endsAt = toDateOrNull(eventData?.end_datetime ?? eventData?.endDateTime)

  const facts = await loadTicketFacts(eventId)
  const refundedMinor =
    args.refundedMinor === null || args.refundedMinor === undefined
      ? Math.max(0, facts.refundedMinor)
      : Math.max(0, toMinor(args.refundedMinor))

  /**
   * A stored event_earnings row that records no gross (legacy or hand-repaired
   * data) must not silently become permanently unwithdrawable, so fall back to
   * what the ledger says is owed.
   */
  const grossMinorRaw = Math.max(0, toMinor(args.grossMinor))
  const grossMinor = grossMinorRaw > 0 ? grossMinorRaw : availableMinor + refundedMinor

  const eventForRelease: EventForRelease = {
    eventId,
    organizerId,
    endsAt: endsAt ? endsAt.toISOString() : null,
    status: eventData?.status ? String(eventData.status) : null,
    grossMinor,
    currency,
    // MonCash/Haitian bank transfers have no chargeback mechanism, so there is no
    // dispute to look up. This is NOT "we didn't check" — there is nothing to
    // check. The protection on this rail is the post-event hold itself.
    rail: 'moncash',
    checkedInRatio: facts.liveTickets > 0 ? facts.checkedInTickets / facts.liveTickets : null,
    // Null when no check-in recorded a method — the rules treat null as unknown
    // and skip the trigger rather than guessing.
    manualCheckInRatio:
      facts.methodKnownCheckIns > 0 ? facts.manualCheckIns / facts.methodKnownCheckIns : null,
    refundedMinor,
    hasOpenDispute: false,
  }

  const completedEvents = Math.max(
    0,
    context.endedEventIds.size - (context.endedEventIds.has(eventId) ? 1 : 0)
  )

  const history: OrganizerHistory = {
    completedEvents,
    lifetimeGrossMinor: Math.max(
      0,
      context.lifetimeGrossMinorByCurrency[(currency || 'HTG').toUpperCase()] || 0
    ),
    // Lets the rules normalise the money thresholds, so one threshold means one
    // economic amount whether the organizer settles in HTG or USD.
    currency,
    preEventReleaseApproved: context.override?.preEventReleaseApproved === true,
    highRisk: context.override?.highRisk === true,
    forceEstablished: context.override?.forceEstablished === true,
  }

  const decision = decideRelease({
    event: eventForRelease,
    history,
    availableMinor,
    config,
    now,
  })

  return { decision, endsAt, refundedMinor, history, config, context }
}

/** What the organizer can be TOLD about this event's money, right now. */
export type ReleasePreview = {
  /** True when a withdrawal request for `releasableMinor` would be accepted. */
  releasedNow: boolean
  /** How much the ladder would allow today, minor units. */
  releasableMinor: number
  /** When the hold expires, ISO. Null when there is no date to promise. */
  availableAt: string | null
  /** The hold that applies to this organizer's tier, in hours. */
  holdHours: number
  /** decideRelease()'s machine reason, for a translated string. */
  reason: string
  tier: ReleaseDecision['tier']
  /** Set when the payouts team is holding this event. */
  reviewStatus: string | null
}

/**
 * READ-ONLY twin of the gate, for screens.
 *
 * The earnings screen used to show "available to withdraw" from settlement
 * status alone, so an organizer could read a figure the ladder would refuse the
 * moment they tapped withdraw. This answers the question the screen should be
 * asking — "is it released, and if not, when?" — and writes NOTHING. The gate
 * files review-queue rows; a screen must never do that just by being opened.
 */
export async function previewRelease(args: {
  eventId: string
  organizerId: string
  eventData: any
  grossMinor: number
  refundedMinor?: number | null
  currency: string | null
  availableMinor: number
  context?: OrganizerReleaseContext
  now?: Date
}): Promise<ReleasePreview> {
  const now = args.now || new Date()
  const currency = args.currency ? String(args.currency).toUpperCase() : null
  const availableMinor = Math.max(0, toMinor(args.availableMinor))

  const frozen =
    args.eventData?.payouts_frozen === true ||
    String(args.eventData?.status || '') === 'cancelled'

  const { decision, endsAt, history, config } = await buildReleaseInputs({
    eventId: String(args.eventId),
    organizerId: String(args.organizerId),
    eventData: args.eventData || {},
    currency,
    availableMinor,
    grossMinor: args.grossMinor,
    refundedMinor: args.refundedMinor,
    context: args.context,
    now,
  })

  const holdHours = holdHoursFor(history, config)
  const availableAt =
    endsAt && holdHours >= 0 ? new Date(endsAt.getTime() + holdHours * 3_600_000) : null

  // Read, never write: an opened screen must not queue anything for an admin.
  const reviewSnap = await adminDb
    .collection('payout_review_queue')
    .doc(String(args.eventId))
    .get()
    .catch(() => null)
  const reviewStatus = reviewSnap?.exists
    ? String((reviewSnap.data() as any)?.status || '') || null
    : null

  const heldByReview =
    (decision.release === 'review' && reviewStatus !== 'released') || reviewStatus === 'pending'

  return {
    releasedNow: !frozen && decision.release !== 'hold' && !heldByReview,
    releasableMinor: frozen ? 0 : decision.releasableMinor,
    availableAt: availableAt ? availableAt.toISOString() : null,
    holdHours,
    reason: frozen ? 'payouts_frozen' : heldByReview ? 'payout_under_review' : decision.reason,
    tier: decision.tier,
    reviewStatus,
  }
}

// ── The gate ────────────────────────────────────────────────────────────────

export type ReleaseGateInput = {
  eventId: string
  organizerId: string
  /** Already-read event doc data. The CALLER must have checked ownership. */
  eventData: any
  /** Gross ticket revenue for this event, minor units of `currency`. */
  grossMinor: number
  /**
   * Refunds already issued for this event, minor units — pass 0 when the gross
   * above already excludes refunded tickets, or null/undefined to derive it from
   * the tickets. Getting this wrong in either direction is a money error, so the
   * caller states it explicitly rather than this helper guessing.
   */
  refundedMinor?: number | null
  currency: string | null
  /** What the platform still holds for this organizer on this event, minor units. */
  availableMinor: number
  /** What they are asking for right now, minor units. */
  requestedAmountMinor: number
  method: ReleaseGateMethod
  /** Preloaded context, when several events are judged in one request. */
  context?: OrganizerReleaseContext
  now?: Date
}

/**
 * Decide whether a Haiti withdrawal REQUEST may be filed at all.
 *
 * This is purely an added gate. Every existing check in the withdrawal routes
 * (ownership, $50 minimum, cancelled event, settlement, balance, atomic debit)
 * still runs; this one refuses earlier, before any money is reserved and before
 * any request doc is written.
 *
 * A 'review' decision does NOT create a withdrawal request. It writes the same
 * `payout_review_queue/{eventId}` row the Stripe rail writes and refuses, so the
 * admin queue stays single and no payable request can sit in the withdrawal
 * inbox waiting for an admin who has no way of knowing it was flagged. Once an
 * admin marks the row `released`, the organizer's next request goes through.
 */
export async function gateHaitiWithdrawal(input: ReleaseGateInput): Promise<ReleaseGateResult> {
  const now = input.now || new Date()
  const nowIso = now.toISOString()
  const eventId = String(input.eventId)
  const organizerId = String(input.organizerId)
  const eventData = input.eventData || {}
  const currency = input.currency ? String(input.currency).toUpperCase() : null
  const availableMinor = Math.max(0, toMinor(input.availableMinor))
  const requestedMinor = Math.max(0, toMinor(input.requestedAmountMinor))

  const blocked = (
    code: ReleaseGateCode,
    message: string,
    extras: {
      status?: number
      reason?: string
      decision?: ReleaseDecision | null
      params?: ReleaseGateErrorBody['params']
    } = {}
  ): ReleaseGateResult => ({
    allowed: false,
    status: extras.status || 400,
    decision: extras.decision || null,
    body: {
      error: message,
      message,
      code,
      reason: extras.reason || code,
      tier: extras.decision?.tier || null,
      params: { currency, ...(extras.params || {}) },
    },
  })

  // Belt and braces: the withdraw routes already refuse a cancelled or frozen
  // event, but the batch payout path did not, and this is money.
  if (eventData?.payouts_frozen === true) {
    return blocked(
      'payouts_frozen',
      'Payouts for this event are on hold. Please contact Tikèm support.'
    )
  }
  if (String(eventData?.status || '') === 'cancelled') {
    return blocked(
      'event_cancelled',
      'This event was cancelled, so its earnings are reserved for refunds.'
    )
  }

  const built = await buildReleaseInputs({
    eventId,
    organizerId,
    eventData,
    currency,
    availableMinor,
    grossMinor: input.grossMinor,
    refundedMinor: input.refundedMinor,
    context: input.context,
    now,
  })
  const { decision, endsAt, refundedMinor, history, config } = built

  // ── hold: refuse with something the organizer can act on ──────────────────
  if (decision.release === 'hold') {
    const holdHours = holdHoursFor(history, config)
    const availableAt =
      endsAt && holdHours >= 0 ? new Date(endsAt.getTime() + holdHours * 3_600_000) : null
    const params = {
      holdHours,
      endsAt: endsAt ? endsAt.toISOString() : null,
      availableAt: availableAt ? availableAt.toISOString() : null,
    }

    if (decision.reason === 'no_end_date') {
      return blocked(
        'missing_event_end_date',
        'This event has no end date, so we cannot tell when its funds are due. Add an end date and time to the event, then request your withdrawal again.',
        { reason: decision.reason, decision, params }
      )
    }
    if (decision.reason === 'event_not_over') {
      return blocked(
        'event_not_over',
        holdHours > 0
          ? `Funds for this event become available ${holdHours} hours after it ends.`
          : 'Funds for this event become available after it ends.',
        { reason: decision.reason, decision, params }
      )
    }
    if (decision.reason.startsWith('hold_')) {
      return blocked(
        'release_hold',
        `Funds for this event become available ${holdHours} hours after it ends.`,
        { reason: decision.reason, decision, params }
      )
    }
    if (decision.reason === 'event_cancelled') {
      return blocked(
        'event_cancelled',
        'This event was cancelled, so its earnings are reserved for refunds.',
        { reason: decision.reason, decision, params }
      )
    }
    // 'nothing_available_yet' and anything decideRelease adds later.
    return blocked(
      'nothing_releasable_yet',
      'There are no released funds for this event yet.',
      { reason: decision.reason, decision, params }
    )
  }

  // ── the releasable cap ────────────────────────────────────────────────────
  // decideRelease() has already clamped to (gross − refunds) and to the balance
  // we handed it. Refunded money is not the organizer's to take, and a stored
  // earnings row is never decremented on refund, so without this the refunded
  // slice stayed withdrawable.
  if (requestedMinor > decision.releasableMinor) {
    return blocked(
      'amount_exceeds_releasable',
      `Only ${formatMoney(decision.releasableMinor, currency)} of this event's earnings is released right now${
        refundedMinor > 0 ? `. ${formatMoney(refundedMinor, currency)} has been refunded to buyers.` : '.'
      }`,
      {
        reason: 'amount_above_releasable',
        decision,
        params: { releasableMinor: decision.releasableMinor, requestedMinor },
      }
    )
  }

  // ── review: one queue, shared with the Stripe rail ────────────────────────
  const reviewRef = adminDb.collection('payout_review_queue').doc(eventId)
  const reviewSnap = await reviewRef.get()
  const reviewStatus = reviewSnap.exists ? String((reviewSnap.data() as any)?.status || '') : null

  const needsReview = (decision.release === 'review' && reviewStatus !== 'released') || reviewStatus === 'pending'

  if (needsReview) {
    const reason =
      decision.release === 'auto' ? `${decision.reason}+awaiting_admin_review` : decision.reason

    if (!reviewSnap.exists) {
      await reviewRef.set({
        eventId,
        organizerId,
        amountMinor: requestedMinor,
        currency,
        reason,
        tier: decision.tier,
        status: 'pending',
        // Extra context for the admin, ignored by readers that don't know it:
        // this row came from an organizer pulling, not from the cron pushing.
        rail: 'moncash',
        source: 'organizer_withdrawal_request',
        requestMethod: input.method,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
    } else if (reviewStatus === 'pending') {
      // Refresh the figures an admin is looking at; never touch a row they have
      // already resolved (that stored status IS their decision).
      await reviewRef.set(
        {
          amountMinor: requestedMinor,
          currency,
          reason,
          tier: decision.tier,
          rail: 'moncash',
          requestMethod: input.method,
          updatedAt: nowIso,
        },
        { merge: true }
      )
    }

    if (reviewStatus && reviewStatus !== 'pending' && reviewStatus !== 'released') {
      // dismissed, or any other resolution that is not an approval.
      return blocked(
        'payout_review_not_approved',
        'A Tikèm payouts review closed this event without approving a payout. Please contact support.',
        { status: 409, reason: `${reason}+review_${reviewStatus}`, decision }
      )
    }

    return blocked(
      'payout_under_review',
      'Your payout for this event is with the Tikèm payouts team. We will email you as soon as it is approved.',
      { status: 409, reason, decision }
    )
  }

  return { allowed: true, decision, reviewStatus }
}
