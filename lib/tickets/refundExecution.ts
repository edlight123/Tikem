import { adminDb } from '@/lib/firebase/admin'
import { isDestinationCharge, processStripeRefund } from '@/lib/refunds'
import { planTicketRefund, refundFaceAmount, type RefundIneligibleReason, type RefundPlan } from '@/lib/tickets/refundPlan'
import { reversePromoterSaleForTicket } from '@/lib/promoters'
import {
  notifyAdminsOfQueuedRefunds,
  notifyAdminsOfRefundReview,
  MANUAL_REFUND_QUEUE,
  REFUND_REVIEWS,
} from '@/lib/tickets/manualRefundQueue'
import {
  coverageInTransaction,
  loadRefundCoverageContext,
  type RefundCoverage,
  type RefundCoverageContext,
} from '@/lib/tickets/refundCoverage'

/**
 * Refund ONE ticket: claim it, move the money (or queue it), record the result.
 *
 * Shared by the organizer refund action (/api/refund-ticket) and event
 * cancellation (lib/events/cancel.ts) so the two can never disagree about which
 * field holds the amount, which rail a sale went through, or how a refund is
 * protected against running twice. The decision itself is planTicketRefund's.
 *
 *   1. CLAIM in a transaction: re-read the ticket, plan it, and stamp
 *      `refund_status: 'processing'`. planTicketRefund refuses any ticket that
 *      is refunded, refund_pending, or already processing/approved/manual, so a
 *      second caller (double tap, a re-run of cancellation) gets `skipped`.
 *   2. MOVE MONEY:
 *      - card: Stripe refund in the CHARGED currency, with reverse_transfer +
 *        refund_application_fee for a destination charge, and an idempotency key
 *        per ticket so a retry can't issue a second refund
 *      - mobile money: the ticket is voided and the payout is queued in
 *        manual_refund_queue, in the same batch so neither can exist alone
 *   3. On failure, either release the claim (the organizer can retry) or hold
 *      the ticket void with `refund_status: 'failed'` (cancellation — a ticket
 *      for a dead event must not scan while its money is being chased).
 *      EXCEPT once Stripe has accepted the refund: the money has left, so the
 *      claim is never released. The result is recorded with retries, and if
 *      that still fails the ticket is flagged `refund_needs_reconciliation`
 *      and a `refund_reconciliation/{ticketId}` doc is written for an admin.
 *   4. On refunded / queued, reverse the promoter commission accrued on the
 *      order (lib/promoters reversePromoterSaleForTicket). Best-effort, logged.
 *   5. On queued, email the admins (unless the caller batches that itself, as
 *      cancellation does) — the queue is worked at /admin/money/refunds.
 *
 * THE COVERAGE GATE (lib/tickets/refundCoverage.ts). Before the claim is
 * written, a refund of money Tikèm holds (platform Stripe, MonCash, NatCash,
 * SogePay) is checked against what the organizer still has unwithdrawn for the
 * event, inside the same transaction that reads the ledger's withdrawn amount.
 * If it is not covered, no provider is called: the ticket is set to
 * `refund_status: 'admin_review'` (held from withdrawals, refused at the door),
 * a `refund_reviews/{ticketId}` doc is written, the admins are emailed and the
 * outcome is `admin_review`. Skipped for event cancellation (the buyer is
 * refunded regardless) and for Stripe destination charges (reverse_transfer
 * takes the money from the organizer's own Stripe balance). An admin who
 * approves the review re-runs this with `adminApprovedShortfall`, which skips
 * the gate and records who approved it.
 */

export type RefundReason = 'organizer_refund' | 'event_cancelled'

export type RefundEventRef = {
  id: string
  title?: string | null
  organizer_id?: string | null
}

type Eligible = Extract<RefundPlan, { eligible: true }>

export type TicketRefundResult =
  | {
      outcome: 'refunded'
      ticketId: string
      ticket: Record<string, any>
      amount: number
      currency: string
      refundId: string | null
      /** Stripe refunded but the ticket could not be updated; flagged for reconciliation. */
      recordFailed?: boolean
    }
  | { outcome: 'queued'; ticketId: string; ticket: Record<string, any>; amount: number; currency: string; needsReview: boolean }
  | { outcome: 'skipped'; ticketId: string; ticket: Record<string, any>; reason: RefundIneligibleReason }
  | {
      /** Not covered by the organizer's remaining balance: sent to a Tikèm admin, no money moved. */
      outcome: 'admin_review'
      ticketId: string
      ticket: Record<string, any>
      amount: number
      currency: string
      /** Null when the balance could not be computed (sent to review to be safe). */
      coverage: RefundCoverage | null
    }
  | { outcome: 'failed'; ticketId: string; ticket: Record<string, any>; error: string }

export type RefundTicketOptions = {
  reason: RefundReason
  actorId: string
  event: RefundEventRef
  /**
   * 'release' clears the claim so the caller can retry later (organizer action).
   * 'hold' leaves the ticket void as refund_pending/failed (cancellation).
   */
  onFailure: 'release' | 'hold'
  /**
   * Cancellation only. A paid ticket the plan can't refund automatically (no
   * PaymentIntent, or an HTG card sale with no recorded charged amount) is
   * queued for an admin instead of being left live, and a ticket a previous
   * cancellation run left `refund_status: 'failed'` is retried.
   */
  cancellation?: boolean
  /**
   * Buyer refund requests keep the buyer's own words in `refund_reason` (the
   * organizer's queue shows them), so the refund's cause is recorded in
   * `refund_source` instead of overwriting it.
   */
  keepRefundReason?: boolean
  /**
   * Email the admins when this ticket is queued for a manual payout. Default
   * true. Cancellation passes false and sends ONE summary for the whole sweep.
   */
  notifyAdmins?: boolean
  /**
   * Set ONLY by the admin approval of a refund_reviews item: Tikèm has agreed to
   * fund the shortfall, so the coverage gate is skipped and the ticket's
   * 'admin_review' hold is planned as the live ticket it was.
   */
  adminApprovedShortfall?: { adminId: string }
}

export const ADMIN_REVIEW_REFUND_STATUS = 'admin_review'

/** Copy the organizer sees when a refund was sent to review. */
export const ADMIN_REVIEW_MESSAGE =
  "Sent to Tikèm for review because your remaining balance doesn't cover it. The buyer's ticket is on hold until Tikèm decides."

const STRIPE_IDEMPOTENCY_PREFIX = 'tikem-ticket-refund-'
const RECORD_ATTEMPTS = 3

/**
 * Take the promoter's commission back for a refunded/voided ticket's order.
 * Never throws: a ledger hiccup must not fail a refund that already moved money.
 * reversePromoterSaleForTicket is idempotent (it only reverses an `accrued` row),
 * so a re-run or a second ticket of the same order is a no-op.
 */
export async function reversePromoterCommission(ticketId: string, context: string): Promise<boolean> {
  try {
    const reversed = await reversePromoterSaleForTicket(ticketId)
    if (reversed) console.info('[refund] promoter commission reversed', { ticketId, context })
    return reversed
  } catch (err: any) {
    console.error('[refund] promoter commission reversal failed', { ticketId, context, message: err?.message })
    return false
  }
}

/**
 * Write the outcome of a refund whose money has ALREADY moved. Retried; on
 * final failure the ticket keeps its 'processing' claim (so nothing retries the
 * refund or scans the ticket) and a reconciliation record is left for an admin.
 */
async function recordSettledRefund(
  ref: any,
  ticketId: string,
  fields: Record<string, any>,
  context: Record<string, any>
): Promise<boolean> {
  let lastError: string | null = null
  for (let attempt = 1; attempt <= RECORD_ATTEMPTS; attempt++) {
    try {
      await ref.set(fields, { merge: true })
      return true
    } catch (e: any) {
      lastError = String(e?.message || e)
      console.error('[refund] Stripe refunded but recording failed', { ticketId, attempt, message: lastError })
    }
  }
  const nowIso = new Date().toISOString()
  await ref
    .set(
      { refund_needs_reconciliation: true, refund_record_error: lastError, updated_at: nowIso },
      { merge: true }
    )
    .catch(() => undefined)
  await adminDb
    .collection('refund_reconciliation')
    .doc(ticketId)
    .set({ ticketId, ...context, intended: fields, error: lastError, createdAt: nowIso, resolved: false }, { merge: true })
    .catch((e: any) =>
      // Last line of defence: the log is all that is left.
      console.error('[refund] RECONCILE BY HAND: refund moved money but nothing could be recorded', {
        ticketId,
        ...context,
        message: e?.message,
      })
    )
  return false
}

function positive(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** True when an earlier cancellation run voided this ticket but no money moved. */
export function isFailedCancellationRefund(ticket: Record<string, any>): boolean {
  return (
    String(ticket?.status ?? '').toLowerCase() === 'refund_pending' &&
    String(ticket?.refund_status ?? '').toLowerCase() === 'failed'
  )
}

function isAdminReview(ticket: Record<string, any>): boolean {
  return String(ticket?.refund_status ?? '').toLowerCase().trim() === ADMIN_REVIEW_REFUND_STATUS
}

function planForClaim(
  ticket: Record<string, any>,
  cancellation: boolean,
  adminApproved = false
): { plan: RefundPlan; needsReview: boolean } {
  // A failed cancellation refund moved no money (a Stripe call that did succeed
  // is replayed by its idempotency key), so it is planned as the live ticket it
  // was before the failed attempt. A ticket held for admin review moved no money
  // either: a cancellation (refund regardless) or the admin's approval plans it
  // as live.
  const source =
    cancellation && isFailedCancellationRefund(ticket)
      ? { ...ticket, status: 'valid', refund_status: null }
      : (cancellation || adminApproved) && isAdminReview(ticket)
        ? { ...ticket, refund_status: null }
        : ticket
  const plan = planTicketRefund(source)
  if (plan.eligible || !cancellation) return { plan, needsReview: false }

  if (plan.reason === 'no_payment_reference' || plan.reason === 'amount_unknown') {
    const amount = positive(source.charged_amount) || positive(source.price_paid ?? source.price)
    const currency = String(
      (positive(source.charged_amount) ? source.charged_currency : null) ||
        source.original_currency ||
        source.currency ||
        'HTG'
    ).toUpperCase()
    return {
      plan: {
        eligible: true,
        rail: 'manual',
        amount: Math.round(amount * 100) / 100,
        currency,
        paymentRef: String(source.payment_id || source.payment_intent_id || source.transaction_id || '').trim() || null,
      },
      needsReview: true,
    }
  }
  return { plan, needsReview: false }
}

export async function refundTicket(ticketId: string, options: RefundTicketOptions): Promise<TicketRefundResult> {
  const { reason, actorId, event, onFailure } = options
  const cancellation = Boolean(options.cancellation)
  const approvedBy = options.adminApprovedShortfall?.adminId ? String(options.adminApprovedShortfall.adminId) : null
  const reasonFields = options.keepRefundReason ? { refund_source: reason } : { refund_reason: reason }
  const ref = adminDb.collection('tickets').doc(ticketId)
  const nowIso = new Date().toISOString()

  // 0. Should the coverage gate run? Decided from a pre-read; the claim
  //    transaction re-plans from its own read and only gates an eligible plan.
  let gate: { ctx: RefundCoverageContext | null; error: string | null } | null = null
  let knownDestination: boolean | null = null
  if (!cancellation && !approvedBy) {
    try {
      const pre = await ref.get()
      const preData = pre.exists ? ((pre.data() as any) ?? {}) : {}
      const prePlan = planTicketRefund(preData)
      if (prePlan.eligible && prePlan.rail !== 'stripe_connect') {
        if (prePlan.rail === 'stripe') {
          // `payment_method` under-reports destination charges on older tickets.
          knownDestination = (await isDestinationCharge(String(prePlan.paymentRef))) === true
        }
        if (!knownDestination) {
          try {
            gate = { ctx: await loadRefundCoverageContext(String(event.id)), error: null }
          } catch (e: any) {
            // Fail closed: a balance that cannot be computed sends the refund to
            // an admin rather than letting Tikèm fund an unknown amount.
            console.error('[refund] coverage context failed; sending to review', { ticketId, message: e?.message })
            gate = { ctx: null, error: String(e?.message || 'coverage_unavailable') }
          }
        }
      }
    } catch (e: any) {
      return { outcome: 'failed', ticketId, ticket: {}, error: e?.message || 'claim_failed' }
    }
  }

  // 1. Claim.
  let ticket: Record<string, any> = {}
  let plan: RefundPlan
  let needsReview = false
  let review: { coverage: RefundCoverage | null; error: string | null } | null = null
  try {
    const claimed = await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      const data = snap.exists ? ((snap.data() as any) ?? {}) : {}
      const decided = planForClaim(data, cancellation, Boolean(approvedBy))
      const wasAdminReview = isAdminReview(data)
      let coverage: RefundCoverage | null = null
      let reviewNeeded = false
      if (
        decided.plan.eligible &&
        !gate &&
        !cancellation &&
        !approvedBy &&
        decided.plan.rail !== 'stripe_connect' &&
        knownDestination !== true
      ) {
        // The pre-read found nothing to gate but this read is refundable (the
        // ticket changed in between). Never claim it ungated: ask for a retry.
        throw new Error('ticket_changed_retry')
      }
      if (decided.plan.eligible && gate && decided.plan.rail !== 'stripe_connect') {
        if (gate.ctx) {
          coverage = await coverageInTransaction(tx, gate.ctx, ticketId, data)
          reviewNeeded = coverage.shortfallMinor > 0
        } else {
          reviewNeeded = true
        }
      }
      if (decided.plan.eligible && reviewNeeded) {
        const p = decided.plan
        tx.set(
          ref,
          {
            refund_status: ADMIN_REVIEW_REFUND_STATUS,
            refund_review_requested_at: nowIso,
            refund_review_requested_by: actorId,
            ...reasonFields,
            updated_at: nowIso,
          },
          { merge: true }
        )
        tx.set(adminDb.collection(REFUND_REVIEWS).doc(ticketId), {
          ticket_id: ticketId,
          event_id: event.id,
          event_title: event.title || null,
          organizer_id: event.organizer_id || null,
          user_id: data.user_id || data.attendee_id || null,
          buyer_name: data.attendee_name || data.guest_name || null,
          buyer_email: data.guest_email || data.recipient_email || null,
          buyer_phone: data.guest_phone || data.payer_phone || null,
          // What the buyer would get back, in the CHARGED currency.
          amount: p.amount,
          currency: p.currency,
          // The gate's figures, EVENT currency minor units.
          event_currency: coverage?.currency ?? null,
          face_amount_minor: coverage?.faceMinor ?? Math.round(refundFaceAmount(data) * 100),
          organizer_cost_minor: coverage?.organizerCostMinor ?? null,
          coverage_minor: coverage?.coverageMinor ?? null,
          shortfall_minor: coverage?.shortfallMinor ?? null,
          withdrawn_minor: coverage?.withdrawnMinor ?? null,
          coverage_error: gate?.error ?? null,
          rail: p.rail,
          payment_method: String(data.payment_method || '').toLowerCase() || null,
          payment_ref: p.paymentRef,
          requested_by: actorId,
          reason,
          keep_refund_reason: Boolean(options.keepRefundReason),
          buyer_reason: options.keepRefundReason ? data.refund_reason || null : null,
          // What the ticket's refund_status was before the hold, so a denial can
          // tell a buyer's request apart from an organizer-initiated refund.
          previous_refund_status: data.refund_status ?? null,
          status: 'pending',
          created_at: nowIso,
        })
      } else if (decided.plan.eligible) {
        tx.set(
          ref,
          {
            refund_status: 'processing',
            refund_claimed_at: nowIso,
            refund_claimed_by: actorId,
            ...(approvedBy
              ? { refund_shortfall_approved_by: approvedBy, refund_shortfall_approved_at: nowIso }
              : {}),
          },
          { merge: true }
        )
        if (wasAdminReview && cancellation) {
          // The event was cancelled while this refund waited for review: the
          // cancellation refunds it, so the review is closed.
          tx.set(
            adminDb.collection(REFUND_REVIEWS).doc(ticketId),
            { status: 'superseded', resolved_at: nowIso, resolution_note: 'Event cancelled: refunded by the cancellation' },
            { merge: true }
          )
        }
      }
      return { data, ...decided, reviewNeeded, coverage }
    })
    ticket = claimed.data
    plan = claimed.plan
    needsReview = claimed.needsReview
    if (claimed.reviewNeeded) review = { coverage: claimed.coverage, error: gate?.error ?? null }
  } catch (e: any) {
    return { outcome: 'failed', ticketId, ticket, error: e?.message || 'claim_failed' }
  }

  if (plan.eligible && review) {
    const p = plan as Eligible
    if (options.notifyAdmins !== false) {
      await notifyAdminsOfRefundReview({
        ticketId,
        eventTitle: event.title || null,
        amount: p.amount,
        currency: p.currency,
        method: String(ticket.payment_method || p.rail).toLowerCase(),
        reason,
        eventCurrency: review.coverage?.currency ?? null,
        shortfallMinor: review.coverage?.shortfallMinor ?? null,
        coverageMinor: review.coverage?.coverageMinor ?? null,
      })
    }
    return { outcome: 'admin_review', ticketId, ticket, amount: p.amount, currency: p.currency, coverage: review.coverage }
  }

  if (!plan.eligible) return { outcome: 'skipped', ticketId, ticket, reason: plan.reason }
  const p = plan as Eligible

  // 2. Move the money (or queue it).
  if (p.rail === 'stripe' || p.rail === 'stripe_connect') {
    let refundId: string | null = null
    try {
      const paymentIntentId = String(p.paymentRef)
      // `payment_method` under-reports destination charges on older tickets, so
      // a plain 'stripe' sale is checked against Stripe itself.
      const destination =
        p.rail === 'stripe_connect' || (knownDestination ?? (await isDestinationCharge(paymentIntentId)) === true)
      const res = await processStripeRefund(paymentIntentId, p.amount, {
        reverseTransfer: destination,
        refundApplicationFee: destination,
        idempotencyKey: `${STRIPE_IDEMPOTENCY_PREFIX}${ticketId}`,
      })
      if (!res.success) throw new Error(res.error || 'Stripe refund failed')
      refundId = res.refundId || null
    } catch (e: any) {
      // Stripe did NOT accept the refund: no money moved, safe to release/hold.
      return failWith(e)
    }

    // Stripe accepted it. From here on the money is gone: never undo the claim.
    const recorded = await recordSettledRefund(
      ref,
      ticketId,
      {
        status: 'refunded',
        refund_status: 'approved',
        refund_amount: p.amount,
        refund_currency: p.currency,
        refund_face_amount: refundFaceAmount(ticket),
        refund_id: refundId,
        ...reasonFields,
        refund_error: null,
        refunded_by: actorId,
        refund_processed_at: nowIso,
        updated_at: nowIso,
      },
      { eventId: event.id, amount: p.amount, currency: p.currency, refundId, actorId, reason }
    )
    await reversePromoterCommission(ticketId, reason)
    return {
      outcome: 'refunded',
      ticketId,
      ticket,
      amount: p.amount,
      currency: p.currency,
      refundId,
      ...(recorded ? {} : { recordFailed: true }),
    }
  }

  // Mobile money has no refund API: void now, queue the payout for an admin.
  // One queue doc per ticket (deterministic id) and one batch, so a re-run
  // can't queue the same ticket twice and the ticket can't be marked
  // manual_required with nothing in the queue.
  try {
    const method = String(ticket.payment_method || 'moncash').toLowerCase()
    const batch = adminDb.batch()
    batch.set(
      ref,
      {
        status: 'refund_pending',
        refund_status: 'manual_required',
        refund_amount: p.amount,
        refund_currency: p.currency,
        refund_face_amount: refundFaceAmount(ticket),
        ...reasonFields,
        refund_error: null,
        refunded_by: actorId,
        refund_requested_at: nowIso,
        updated_at: nowIso,
      },
      { merge: true }
    )
    batch.set(adminDb.collection(MANUAL_REFUND_QUEUE).doc(`ticket_${ticketId}`), {
      ticketId,
      eventId: event.id,
      eventTitle: event.title || null,
      organizerId: event.organizer_id || null,
      userId: ticket.user_id || ticket.attendee_id || null,
      amount: p.amount,
      currency: p.currency,
      method,
      transactionId: p.paymentRef,
      reason,
      requestedBy: actorId,
      // A card sale that could not be refunded automatically: the amount is the
      // best figure on the ticket and must be checked against Stripe first.
      needsReview,
      status: 'pending',
      createdAt: nowIso,
    })
    await batch.commit()

    await reversePromoterCommission(ticketId, reason)
    if (options.notifyAdmins !== false) {
      await notifyAdminsOfQueuedRefunds([
        { ticketId, eventTitle: event.title || null, amount: p.amount, currency: p.currency, method, reason, needsReview },
      ])
    }
    return { outcome: 'queued', ticketId, ticket, amount: p.amount, currency: p.currency, needsReview }
  } catch (e: any) {
    return failWith(e)
  }

  async function failWith(e: any): Promise<TicketRefundResult> {
    const error = e?.message || 'refund_failed'
    const release =
      onFailure === 'release'
        ? // Put back whatever the claim replaced (e.g. a buyer's 'requested'),
          // so a failed approval leaves the request in the organizer's queue.
          { refund_status: ticket.refund_status ?? null, refund_claimed_at: null }
        : {
            status: 'refund_pending',
            refund_status: 'failed',
            refund_error: error,
            ...reasonFields,
            updated_at: nowIso,
          }
    await ref.set(release, { merge: true }).catch(() => undefined)
    return { outcome: 'failed', ticketId, ticket, error }
  }
}

/**
 * Where to tell a buyer about their refund. Card tickets carry `attendee_id`
 * (often no `user_id`), guests carry `guest_email`, comps `recipient_email`.
 */
export async function resolveBuyerContact(
  ticket: Record<string, any>
): Promise<{ uid: string | null; email: string | null }> {
  const isGuest = Boolean(ticket.is_guest) || String(ticket.attendee_id || '').startsWith('guest_')
  const uid = isGuest ? null : String(ticket.user_id || ticket.attendee_id || '') || null
  let email: string | null = isGuest ? ticket.guest_email || null : null
  if (uid) {
    const snap = await adminDb.collection('users').doc(uid).get()
    email = (snap.exists && (snap.data() as any)?.email) || null
  }
  return { uid, email: email || ticket.recipient_email || null }
}
