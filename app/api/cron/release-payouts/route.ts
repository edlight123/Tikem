import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getPlatformSettings } from '@/lib/admin/platform-settings'
import { DEFAULT_PAYOUT_RELEASE_CONFIG } from '@/types/platform-settings'
import {
  FX_SNAPSHOT_DOC,
  resolveReferenceRates,
  type FxSnapshot,
} from '@/lib/payouts/fx-rates'
import { getEventEarnings } from '@/lib/earnings'
import {
  getPayoutProfile,
  getRequiredPayoutProfileIdForEventCountry,
} from '@/lib/firestore/payout-profiles'
import {
  decideRelease,
  resolveConfig,
  type EventForRelease,
  type OrganizerHistory,
  type ReleaseDecision,
} from '@/lib/payouts/release-rules'
import type { PayoutReleaseOverride } from '@/types/platform-settings'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { ticketRefundedFaceMinor } from '@/lib/payouts/availability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Payout release cron — the thing that actually moves held money.
 *
 * Connected accounts sit on a MANUAL payout schedule (see
 * app/api/organizer/stripe/connect/route.ts), so ticket revenue accumulates in
 * the organizer's Stripe balance and stays there until this job says otherwise.
 * All of the WHEN/HOW-MUCH judgement lives in lib/payouts/release-rules.ts; this
 * route only gathers facts, calls decideRelease(), and executes.
 *
 * Runs hourly (vercel.json). Every step is bounded so one run cannot hang, and
 * every per-event failure is logged and skipped so one broken connected account
 * cannot stop the batch.
 *
 * Setup: Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET`.
 */

/** Only look this far back — older events are a human's problem, not a cron's. */
const CANDIDATE_WINDOW_DAYS = 90
/** Hard cap on events considered in one run. */
const MAX_EVENTS_PER_RUN = 200
/** Hard cap on event docs read while looking for candidates. */
const MAX_SCAN_DOCS = 600
/** Dispute pages we bother to read per connected account. */
const MAX_DISPUTES_PER_ACCOUNT = 100

/** Stripe dispute statuses that still represent money at risk. */
const OPEN_DISPUTE_STATUSES = new Set([
  'warning_needs_response',
  'warning_under_review',
  'needs_response',
  'under_review',
])

/** payout_releases statuses that mean "money may already be on its way". */
const NON_RELEASING_STATUSES = new Set(['failed', 'canceled', 'cancelled'])

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  // Lazy load — keeps the module importable in environments without Stripe keys.
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

function toDateOrNull(value: any): Date | null {
  if (!value) return null
  const raw = value?.toDate ? value.toDate() : value
  const date = raw instanceof Date ? raw : new Date(raw)
  return isNaN(date.getTime()) ? null : date
}

function toMinor(value: unknown): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}

// ── Candidate discovery ─────────────────────────────────────────────────────

type CandidateEvent = {
  eventId: string
  organizerId: string
  status: string | null
  country: unknown
  endsAt: string
  endsAtMs: number
}

/**
 * Events that ENDED inside the window and are on the Stripe rail.
 *
 * `end_datetime` is written as an ISO string by the web composer but as a
 * Firestore Timestamp by some other writers, and Firestore range queries never
 * cross value types — so we run the window twice (string bounds, then Timestamp
 * bounds) and merge. Both are single-field ranges, so no composite index.
 *
 * Events with no usable end date are deliberately not chased: decideRelease()
 * holds them as `no_end_date`, so there is nothing to pay either way.
 */
async function findCandidateEvents(now: Date): Promise<{ scanned: number; candidates: CandidateEvent[] }> {
  const cutoff = new Date(now.getTime() - CANDIDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const col = adminDb.collection('events')

  const snapshots = await Promise.all([
    col
      .where('end_datetime', '>=', cutoff.toISOString())
      .where('end_datetime', '<=', now.toISOString())
      .orderBy('end_datetime', 'desc')
      .limit(MAX_SCAN_DOCS)
      .get()
      .catch((error: any) => {
        console.error('release-payouts: string-bound candidate query failed:', error?.message || error)
        return null
      }),
    col
      .where('end_datetime', '>=', cutoff)
      .where('end_datetime', '<=', now)
      .orderBy('end_datetime', 'desc')
      .limit(MAX_SCAN_DOCS)
      .get()
      .catch((error: any) => {
        console.error('release-payouts: timestamp-bound candidate query failed:', error?.message || error)
        return null
      }),
  ])

  const seen = new Set<string>()
  const candidates: CandidateEvent[] = []
  let scanned = 0

  for (const snapshot of snapshots) {
    if (!snapshot) continue
    for (const doc of snapshot.docs) {
      if (seen.has(doc.id)) continue
      seen.add(doc.id)
      scanned += 1

      const data = (doc.data() || {}) as any
      const status = data.status ? String(data.status) : null
      if (status === 'cancelled') continue

      const organizerId = String(data.organizer_id || data.organizerId || '')
      if (!organizerId) continue

      // US/CA/FR rail only. Haiti/MonCash payouts are a different pipeline.
      if (getRequiredPayoutProfileIdForEventCountry(data.country) !== 'stripe_connect') continue

      const endsAt = toDateOrNull(data.end_datetime || data.endDateTime)
      if (!endsAt) continue

      candidates.push({
        eventId: doc.id,
        organizerId,
        status,
        country: data.country,
        endsAt: endsAt.toISOString(),
        endsAtMs: endsAt.getTime(),
      })
    }
  }

  // Oldest first: the longest-waiting organizer gets first claim on a shared
  // account balance.
  candidates.sort((a, b) => a.endsAtMs - b.endsAtMs)

  return { scanned, candidates: candidates.slice(0, MAX_EVENTS_PER_RUN) }
}

// ── Per-organizer facts (cached for the run) ────────────────────────────────

type OrganizerState = {
  organizerId: string
  stripeAccountId: string | null
  override: PayoutReleaseOverride | null
  /** Ended, non-cancelled events — the current event is subtracted at use time. */
  endedEventIds: Set<string>
  lifetimeGrossMinorByCurrency: Record<string, number>
}

async function loadOrganizerState(organizerId: string, now: Date): Promise<OrganizerState> {
  const [profile, organizerSnap, eventsSnap, earningsSnap] = await Promise.all([
    getPayoutProfile(organizerId, 'stripe_connect').catch(() => null),
    adminDb.collection('organizers').doc(organizerId).get(),
    adminDb.collection('events').where('organizer_id', '==', organizerId).select('end_datetime', 'status').get(),
    adminDb.collection('event_earnings').where('organizerId', '==', organizerId).select('grossSales', 'currency').get(),
  ])

  const endedEventIds = new Set<string>()
  for (const doc of eventsSnap.docs) {
    const data = (doc.data() || {}) as any
    if (String(data.status || '') === 'cancelled') continue
    const end = toDateOrNull(data.end_datetime)
    if (end && end.getTime() <= now.getTime()) endedEventIds.add(doc.id)
  }

  // Lifetime gross is kept per currency: summing USD cents with EUR cents would
  // be arithmetic fiction, and the tier thresholds are single-currency figures.
  const lifetimeGrossMinorByCurrency: Record<string, number> = {}
  for (const doc of earningsSnap.docs) {
    const data = (doc.data() || {}) as any
    const currency = String(data.currency || '').toUpperCase() || 'UNKNOWN'
    lifetimeGrossMinorByCurrency[currency] =
      (lifetimeGrossMinorByCurrency[currency] || 0) + Math.max(0, toMinor(data.grossSales))
  }

  const rawOverride = organizerSnap.exists ? ((organizerSnap.data() as any)?.payoutRelease || null) : null

  return {
    organizerId,
    stripeAccountId: profile?.stripeAccountId ? String(profile.stripeAccountId) : null,
    override: rawOverride as PayoutReleaseOverride | null,
    endedEventIds,
    lifetimeGrossMinorByCurrency,
  }
}

// ── Per-account facts (cached for the run) ──────────────────────────────────

type AccountState = {
  stripeAccountId: string
  payoutsEnabled: boolean
  currency: string | null
  /** Genuinely available balance, decremented as this run pays out. */
  availableMinor: number
  openDisputePaymentRefs: Set<string>
  openDisputeCount: number
  unavailable: string | null
}

async function loadAccountState(stripe: any, stripeAccountId: string): Promise<AccountState> {
  const state: AccountState = {
    stripeAccountId,
    payoutsEnabled: false,
    currency: null,
    availableMinor: 0,
    openDisputePaymentRefs: new Set<string>(),
    openDisputeCount: 0,
    unavailable: null,
  }

  const account = await stripe.accounts.retrieve(stripeAccountId)
  state.payoutsEnabled = account?.payouts_enabled === true
  state.currency = account?.default_currency ? String(account.default_currency).toLowerCase() : null

  if (!state.payoutsEnabled) {
    state.unavailable = 'payouts_disabled_on_account'
    return state
  }
  if (!state.currency) {
    state.unavailable = 'account_has_no_default_currency'
    return state
  }

  // ONLY the available bucket can be paid out. Funds in Stripe's pending window
  // are real money the organizer has earned, but Stripe will refuse to move
  // them, so they must not enter the decision.
  const balance = await stripe.balance.retrieve({ stripeAccount: stripeAccountId })
  const entry = (balance?.available || []).find(
    (row: any) => String(row?.currency || '').toLowerCase() === state.currency
  )
  state.availableMinor = Math.max(0, toMinor(entry?.amount))

  // Disputes are attributed to an event through the charge/payment-intent id we
  // stored on the ticket. An open dispute we cannot attribute does NOT block a
  // different event — but it has already been debited from the balance above, so
  // the money simply is not there to release.
  try {
    const disputes = await stripe.disputes.list(
      { limit: MAX_DISPUTES_PER_ACCOUNT },
      { stripeAccount: stripeAccountId }
    )
    for (const dispute of disputes?.data || []) {
      if (!OPEN_DISPUTE_STATUSES.has(String(dispute?.status || ''))) continue
      state.openDisputeCount += 1
      const charge = typeof dispute?.charge === 'string' ? dispute.charge : dispute?.charge?.id
      const intent = typeof dispute?.payment_intent === 'string' ? dispute.payment_intent : dispute?.payment_intent?.id
      if (charge) state.openDisputePaymentRefs.add(String(charge))
      if (intent) state.openDisputePaymentRefs.add(String(intent))
    }
  } catch (error: any) {
    // A dispute-list failure must not be read as "no disputes".
    state.unavailable = `dispute_lookup_failed: ${error?.message || 'unknown error'}`
  }

  return state
}

// ── Per-event ticket facts ──────────────────────────────────────────────────

type TicketFacts = {
  liveTickets: number
  checkedInTickets: number
  /** Check-ins whose stored record says a human picked them off a list. */
  manualCheckIns: number
  /** Check-ins that recorded a method at all — pre-fix rows recorded none. */
  methodKnownCheckIns: number
  refundedMinor: number
  matchesOpenDispute: boolean
}

/**
 * One pass over the event's tickets for the three things the rules need.
 *
 * manualCheckInRatio comes from check_in_method, recorded at write time by every
 * check-in path. Rows written before that field existed carry no method, so they
 * are excluded from the denominator rather than counted as scans — inferring
 * "scan" from silence would clear exactly the doors this signal exists to catch.
 */
async function loadTicketFacts(
  eventId: string,
  openDisputePaymentRefs: Set<string>,
  eventCurrency: string | null
): Promise<TicketFacts> {
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
      'original_currency',
      'payment_id',
      'payment_intent_id'
    )
    .get()

  const facts: TicketFacts = {
    liveTickets: 0,
    checkedInTickets: 0,
    manualCheckIns: 0,
    methodKnownCheckIns: 0,
    refundedMinor: 0,
    matchesOpenDispute: false,
  }

  for (const doc of snapshot.docs) {
    const data = (doc.data() || {}) as any
    const status = String(data.status || '').toLowerCase()
    const refundStatus = String(data.refund_status || '').toLowerCase()

    if (openDisputePaymentRefs.size > 0) {
      const paymentId = data.payment_id ? String(data.payment_id) : null
      const intentId = data.payment_intent_id ? String(data.payment_intent_id) : null
      if (
        (paymentId && openDisputePaymentRefs.has(paymentId)) ||
        (intentId && openDisputePaymentRefs.has(intentId))
      ) {
        facts.matchesOpenDispute = true
      }
    }

    if (status === 'refunded' || refundStatus === 'approved') {
      facts.refundedMinor += ticketRefundedFaceMinor(data, eventCurrency)
      continue
    }

    if (!isLiveTicketStatus(status)) continue

    facts.liveTickets += 1
    if (data.checked_in === true) {
      facts.checkedInTickets += 1
      const method = String(data.check_in_method || '').toLowerCase()
      if (method === 'manual' || method === 'scan') {
        facts.methodKnownCheckIns += 1
        if (method === 'manual') facts.manualCheckIns += 1
      }
    }
  }

  return facts
}

// ── Already-released accounting ─────────────────────────────────────────────

async function sumAlreadyReleasedMinor(eventId: string): Promise<number> {
  const snapshot = await adminDb.collection('payout_releases').where('eventId', '==', eventId).get()
  let total = 0
  for (const doc of snapshot.docs) {
    const data = (doc.data() || {}) as any
    // A `reserved` row is one whose Stripe outcome we never confirmed. Counting
    // it as released is the only safe reading: the payout may well exist.
    if (NON_RELEASING_STATUSES.has(String(data.status || '').toLowerCase())) continue
    total += Math.max(0, toMinor(data.amountMinor))
  }
  return total
}

// ── Route ───────────────────────────────────────────────────────────────────

type EventResult = {
  eventId: string
  organizerId: string
  outcome: 'auto' | 'review' | 'hold' | 'skipped' | 'error'
  reason: string
  tier: ReleaseDecision['tier'] | null
  amountMinor: number
  currency: string | null
  payoutId?: string | null
  error?: string
}

export async function GET(request: Request) {
  try {
    // Verify cron secret for security
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const stripe = getStripe()
    const now = new Date()
    const nowIso = now.toISOString()
    /**
     * Idempotency scope: one attempt per (event, UTC day).
     *
     * The Stripe idempotency key below is derived from exactly this, so an hourly
     * re-run — or a Vercel retry, or a hand-triggered run — replays the original
     * payout instead of creating a second one. Stripe only honours a key for 24h,
     * which is why the day is the scope: a key that outlived its window is a key
     * that no longer protects anything. The two Firestore guards (a deterministic
     * reservation doc id, and the released-so-far cap) cover the days after.
     */
    const attemptDay = nowIso.slice(0, 10).replace(/-/g, '')

    const platformSettings = await getPlatformSettings()
    const rawPlatformConfig = platformSettings.payoutRelease || null

    // Threshold FX comes from the DAILY SNAPSHOT written by /api/cron/fx-snapshot,
    // merged over the admin-maintained table (which stays the fallback for
    // currencies the provider misses, and takes over entirely if the snapshot goes
    // stale). Read, never fetched: a rate lookup failing here would change who
    // gets paid.
    const fxSnapshot = ((await adminDb
      .collection('platform_settings')
      .doc(FX_SNAPSHOT_DOC)
      .get()).data() || null) as FxSnapshot | null

    const resolvedRates = resolveReferenceRates(
      { ...DEFAULT_PAYOUT_RELEASE_CONFIG, ...(rawPlatformConfig || {}) },
      fxSnapshot,
      now
    )
    if (resolvedRates.warnings.length) {
      console.warn('[cron/release-payouts] FX:', resolvedRates.warnings.join(' | '))
    }

    const platformConfig = {
      ...(rawPlatformConfig || {}),
      referenceRates: resolvedRates.rates,
    }

    const { scanned, candidates } = await findCandidateEvents(now)

    const organizerCache = new Map<string, OrganizerState>()
    const accountCache = new Map<string, AccountState>()
    const results: EventResult[] = []
    const releasedByCurrency: Record<string, number> = {}
    let totalReleasedMinor = 0

    for (const candidate of candidates) {
      const { eventId, organizerId } = candidate
      try {
        let organizer = organizerCache.get(organizerId)
        if (!organizer) {
          organizer = await loadOrganizerState(organizerId, now)
          organizerCache.set(organizerId, organizer)
        }

        if (!organizer.stripeAccountId) {
          results.push({
            eventId,
            organizerId,
            outcome: 'skipped',
            reason: 'no_stripe_connected_account',
            tier: null,
            amountMinor: 0,
            currency: null,
          })
          continue
        }

        const stripeAccountId = organizer.stripeAccountId
        let account = accountCache.get(stripeAccountId)
        if (!account) {
          account = await loadAccountState(stripe, stripeAccountId)
          accountCache.set(stripeAccountId, account)
        }

        if (account.unavailable) {
          results.push({
            eventId,
            organizerId,
            outcome: 'skipped',
            reason: account.unavailable,
            tier: null,
            amountMinor: 0,
            currency: account.currency,
          })
          continue
        }

        const earnings = await getEventEarnings(eventId)
        if (!earnings) {
          results.push({
            eventId,
            organizerId,
            outcome: 'skipped',
            reason: 'no_earnings_record',
            tier: null,
            amountMinor: 0,
            currency: account.currency,
          })
          continue
        }

        const earningsCurrency = String(earnings.currency || '').toLowerCase()
        if (!earningsCurrency || !account.currency || earningsCurrency !== account.currency) {
          // Paying a USD amount out of a EUR balance is a silent FX error with a
          // real price tag. Refuse and let a human look.
          results.push({
            eventId,
            organizerId,
            outcome: 'skipped',
            reason: `currency_mismatch_event_${earningsCurrency || 'unknown'}_account_${account.currency}`,
            tier: null,
            amountMinor: 0,
            currency: account.currency,
          })
          continue
        }

        const facts = await loadTicketFacts(eventId, account.openDisputePaymentRefs, earningsCurrency || null)

        const grossMinor = Math.max(0, toMinor(earnings.grossSales))

        /**
         * Refunds are only subtracted when the gross we were handed still
         * contains them. A stored event_earnings row is never decremented on
         * refund (refundTicketFromEarnings has no callers), so its gross is
         * refund-inclusive; the ticket-derived fallback already drops refunded
         * tickets, so subtracting again there would silently under-pay.
         */
        const dataSource = String((earnings as any).dataSource || 'event_earnings')
        const refundedMinor = dataSource === 'tickets_derived' ? 0 : Math.max(0, facts.refundedMinor)

        const eventForRelease: EventForRelease = {
          eventId,
          organizerId,
          endsAt: candidate.endsAt,
          status: candidate.status,
          grossMinor,
          rail: 'card',
          currency: earningsCurrency || null, // Stripe rail. MonCash releases are a separate pipeline.
          checkedInRatio: facts.liveTickets > 0 ? facts.checkedInTickets / facts.liveTickets : null,
          // Null when no check-in recorded a method (an older event, or a door
          // that never checked anyone in) — the rules treat null as "unknown"
          // and skip the trigger rather than guessing.
          manualCheckInRatio:
            facts.methodKnownCheckIns > 0
              ? facts.manualCheckIns / facts.methodKnownCheckIns
              : null,
          refundedMinor,
          hasOpenDispute: facts.matchesOpenDispute,
        }

        const lifetimeGrossMinor = Math.max(
          0,
          organizer.lifetimeGrossMinorByCurrency[earningsCurrency.toUpperCase()] || 0
        )
        const completedEvents = Math.max(
          0,
          organizer.endedEventIds.size - (organizer.endedEventIds.has(eventId) ? 1 : 0)
        )

        const history: OrganizerHistory = {
          completedEvents,
          lifetimeGrossMinor,
          // Lets the rules normalise gross thresholds into the platform's
          // threshold currency, so one threshold means one economic amount
          // whether the account settles in USD, CAD, EUR or HTG.
          currency: earningsCurrency || account.currency || null,
          preEventReleaseApproved: organizer.override?.preEventReleaseApproved === true,
          highRisk: organizer.override?.highRisk === true,
          forceEstablished: organizer.override?.forceEstablished === true,
        }

        const decision = decideRelease({
          event: eventForRelease,
          history,
          availableMinor: account.availableMinor,
          config: resolveConfig(platformConfig, organizer.override),
          now,
        })

        if (decision.release === 'hold') {
          // Step 8: nothing recorded, but it shows up in the summary.
          results.push({
            eventId,
            organizerId,
            outcome: 'hold',
            reason: decision.reason,
            tier: decision.tier,
            amountMinor: 0,
            currency: account.currency,
          })
          continue
        }

        // How much the organizer is actually owed for THIS event, net of fees and
        // of anything already withdrawn through the legacy manual payout paths.
        const netEntitlementMinor = Math.max(
          0,
          toMinor(earnings.netAmount) - Math.max(0, toMinor(earnings.withdrawnAmount))
        )
        const alreadyReleasedMinor = await sumAlreadyReleasedMinor(eventId)

        const reviewRef = adminDb.collection('payout_review_queue').doc(eventId)
        const reviewSnap = await reviewRef.get()
        const reviewStatus = reviewSnap.exists
          ? String((reviewSnap.data() as any)?.status || '')
          : ''
        const reviewPending = reviewStatus === 'pending'
        // An admin who approved a flagged payout has to be able to unblock it.
        // The signals that route here (mostly-manual check-ins, low attendance)
        // never stop being true, so without this the event would be re-flagged
        // forever and an approval would mean nothing. Deleting the row instead
        // would just make the next run write a fresh 'pending' one and loop.
        const reviewReleased = reviewStatus === 'released'

        // Three independent ceilings. releasableMinor is the rules' answer and is
        // never exceeded; the entitlement cap stops one event draining another
        // event's held funds out of a shared balance; the balance cap stops us
        // asking Stripe for money that is not there.
        const amountMinor = Math.min(
          decision.releasableMinor,
          Math.max(0, netEntitlementMinor - alreadyReleasedMinor),
          account.availableMinor
        )

        const payable = Number.isFinite(amountMinor) && amountMinor > 0

        // Auto-eligible but the caps left nothing to send (already released, or
        // the balance moved). Nothing to record — it reports as a hold.
        if (decision.release === 'auto' && !payable) {
          results.push({
            eventId,
            organizerId,
            outcome: 'hold',
            reason: `nothing_payable_after_caps:${decision.reason}`,
            tier: decision.tier,
            amountMinor: 0,
            currency: account.currency,
          })
          continue
        }

        if ((decision.release === 'review' && !reviewReleased) || reviewPending) {
          const reason =
            decision.release === 'auto' ? `${decision.reason}+awaiting_admin_review` : decision.reason

          // Step 7: upsert the review item and pay nothing. An item an admin has
          // already resolved (status !== 'pending') is left exactly as they left
          // it — and while it sits at 'pending' it also blocks an automatic
          // release, so a queued decision cannot be quietly bypassed on a later
          // run. Admins clear it by moving the doc off 'pending'.
          const reviewStatus = reviewSnap.exists
            ? String((reviewSnap.data() as any)?.status || '')
            : null

          if (!reviewSnap.exists) {
            await reviewRef.set({
              eventId,
              organizerId,
              stripeAccountId,
              amountMinor: Math.max(0, amountMinor),
              currency: account.currency,
              reason,
              tier: decision.tier,
              status: 'pending',
              createdAt: nowIso,
              updatedAt: nowIso,
            })
          } else if (reviewStatus === 'pending') {
            await reviewRef.set(
              {
                amountMinor: Math.max(0, amountMinor),
                currency: account.currency,
                reason,
                tier: decision.tier,
                updatedAt: nowIso,
              },
              { merge: true }
            )
          }

          results.push({
            eventId,
            organizerId,
            outcome: 'review',
            reason: reviewStatus && reviewStatus !== 'pending' ? `${reason}+review_${reviewStatus}` : reason,
            tier: decision.tier,
            amountMinor: Math.max(0, amountMinor),
            currency: account.currency,
          })
          continue
        }

        // ── Step 6: automatic release ────────────────────────────────────────
        const releaseDocId = `${eventId}_${attemptDay}`
        const idempotencyKey = `tikem_release_${releaseDocId}`
        const releaseRef = adminDb.collection('payout_releases').doc(releaseDocId)

        const releaseDoc = {
          eventId,
          organizerId,
          stripeAccountId,
          amountMinor,
          currency: account.currency,
          tier: decision.tier,
          reason: decision.reason,
          payoutId: null as string | null,
          status: 'reserved',
          attemptDay,
          idempotencyKey,
          createdAt: nowIso,
          updatedAt: nowIso,
        }

        // Reserve the attempt BEFORE talking to Stripe. create() fails if the doc
        // exists, so a second run on the same UTC day cannot start a second
        // payout even if the Stripe idempotency window has drifted.
        let reserved = true
        try {
          await releaseRef.create(releaseDoc)
        } catch {
          reserved = false
        }

        if (!reserved) {
          const existing = (await releaseRef.get()).data() as any
          const existingStatus = String(existing?.status || '').toLowerCase()
          if (!NON_RELEASING_STATUSES.has(existingStatus)) {
            results.push({
              eventId,
              organizerId,
              outcome: 'skipped',
              reason: `already_attempted_today:${existingStatus || 'unknown'}`,
              tier: decision.tier,
              amountMinor: 0,
              currency: account.currency,
              payoutId: existing?.payoutId || null,
            })
            continue
          }
          // Previous attempt failed outright — retry with the SAME idempotency
          // key, so if that failure was only a lost response Stripe replays the
          // original payout instead of making a new one.
          await releaseRef.set({ ...releaseDoc, createdAt: existing?.createdAt || nowIso }, { merge: true })
        }

        try {
          const payout = await stripe.payouts.create(
            {
              amount: amountMinor,
              currency: account.currency,
              metadata: {
                eventId,
                organizerId,
                tier: decision.tier,
                reason: decision.reason,
                releaseDocId,
                source: 'tikem_release_cron',
              },
            },
            { stripeAccount: stripeAccountId, idempotencyKey }
          )

          await releaseRef.set(
            {
              payoutId: payout?.id || null,
              status: String(payout?.status || 'paid'),
              stripePayoutStatus: payout?.status || null,
              arrivalDate: payout?.arrival_date || null,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          )

          account.availableMinor = Math.max(0, account.availableMinor - amountMinor)
          totalReleasedMinor += amountMinor
          const key = String(account.currency)
          releasedByCurrency[key] = (releasedByCurrency[key] || 0) + amountMinor

          results.push({
            eventId,
            organizerId,
            outcome: 'auto',
            reason: decision.reason,
            tier: decision.tier,
            amountMinor,
            currency: account.currency,
            payoutId: payout?.id || null,
          })
        } catch (payoutError: any) {
          const message = String(payoutError?.raw?.message || payoutError?.message || 'payout failed')
          console.error(`release-payouts: payout failed for event ${eventId}:`, message)
          await releaseRef
            .set({ status: 'failed', error: message.slice(0, 500), updatedAt: new Date().toISOString() }, { merge: true })
            .catch(() => {})

          results.push({
            eventId,
            organizerId,
            outcome: 'error',
            reason: 'payout_create_failed',
            tier: decision.tier,
            amountMinor: 0,
            currency: account.currency,
            error: message,
          })
        }
      } catch (eventError: any) {
        // One bad account must never stop the batch.
        const message = String(eventError?.raw?.message || eventError?.message || 'unknown error')
        console.error(`release-payouts: event ${eventId} failed:`, message)
        results.push({
          eventId,
          organizerId,
          outcome: 'error',
          reason: 'event_processing_failed',
          tier: null,
          amountMinor: 0,
          currency: null,
          error: message,
        })
      }
    }

    const counts = {
      auto: results.filter((r) => r.outcome === 'auto').length,
      review: results.filter((r) => r.outcome === 'review').length,
      hold: results.filter((r) => r.outcome === 'hold').length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
      errors: results.filter((r) => r.outcome === 'error').length,
    }

    const summary = {
      success: true,
      timestamp: nowIso,
      attemptDay,
      windowDays: CANDIDATE_WINDOW_DAYS,
      scannedEvents: scanned,
      consideredEvents: candidates.length,
      accountsTouched: accountCache.size,
      counts,
      totalReleasedMinor,
      releasedByCurrency,
      events: results,
    }

    console.log('release-payouts:', {
      ...counts,
      totalReleasedMinor,
      consideredEvents: candidates.length,
    })

    return NextResponse.json(summary)
  } catch (error: any) {
    console.error('Payout release cron error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to process payout releases' },
      { status: 500 }
    )
  }
}
