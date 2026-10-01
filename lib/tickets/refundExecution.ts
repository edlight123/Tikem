import { adminDb } from '@/lib/firebase/admin'
import { isDestinationCharge, processStripeRefund } from '@/lib/refunds'
import { planTicketRefund, type RefundIneligibleReason, type RefundPlan } from '@/lib/tickets/refundPlan'

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
 */

export type RefundReason = 'organizer_refund' | 'event_cancelled'

export type RefundEventRef = {
  id: string
  title?: string | null
  organizer_id?: string | null
}

type Eligible = Extract<RefundPlan, { eligible: true }>

export type TicketRefundResult =
  | { outcome: 'refunded'; ticketId: string; ticket: Record<string, any>; amount: number; currency: string; refundId: string | null }
  | { outcome: 'queued'; ticketId: string; ticket: Record<string, any>; amount: number; currency: string; needsReview: boolean }
  | { outcome: 'skipped'; ticketId: string; ticket: Record<string, any>; reason: RefundIneligibleReason }
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
}

const STRIPE_IDEMPOTENCY_PREFIX = 'tikem-ticket-refund-'

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

function planForClaim(ticket: Record<string, any>, cancellation: boolean): { plan: RefundPlan; needsReview: boolean } {
  // A failed cancellation refund moved no money (a Stripe call that did succeed
  // is replayed by its idempotency key), so it is planned as the live ticket it
  // was before the failed attempt.
  const source =
    cancellation && isFailedCancellationRefund(ticket)
      ? { ...ticket, status: 'valid', refund_status: null }
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
  const ref = adminDb.collection('tickets').doc(ticketId)
  const nowIso = new Date().toISOString()

  // 1. Claim.
  let ticket: Record<string, any> = {}
  let plan: RefundPlan
  let needsReview = false
  try {
    const claimed = await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref)
      const data = snap.exists ? ((snap.data() as any) ?? {}) : {}
      const decided = planForClaim(data, cancellation)
      if (decided.plan.eligible) {
        tx.set(
          ref,
          { refund_status: 'processing', refund_claimed_at: nowIso, refund_claimed_by: actorId },
          { merge: true }
        )
      }
      return { data, ...decided }
    })
    ticket = claimed.data
    plan = claimed.plan
    needsReview = claimed.needsReview
  } catch (e: any) {
    return { outcome: 'failed', ticketId, ticket, error: e?.message || 'claim_failed' }
  }

  if (!plan.eligible) return { outcome: 'skipped', ticketId, ticket, reason: plan.reason }
  const p = plan as Eligible

  // 2. Move the money (or queue it).
  try {
    if (p.rail === 'stripe' || p.rail === 'stripe_connect') {
      const paymentIntentId = String(p.paymentRef)
      // `payment_method` under-reports destination charges on older tickets, so
      // a plain 'stripe' sale is checked against Stripe itself.
      const destination = p.rail === 'stripe_connect' || (await isDestinationCharge(paymentIntentId)) === true
      const res = await processStripeRefund(paymentIntentId, p.amount, {
        reverseTransfer: destination,
        refundApplicationFee: destination,
        idempotencyKey: `${STRIPE_IDEMPOTENCY_PREFIX}${ticketId}`,
      })
      if (!res.success) throw new Error(res.error || 'Stripe refund failed')
      await ref.set(
        {
          status: 'refunded',
          refund_status: 'approved',
          refund_amount: p.amount,
          refund_currency: p.currency,
          refund_id: res.refundId || null,
          refund_reason: reason,
          refund_error: null,
          refunded_by: actorId,
          refund_processed_at: nowIso,
          updated_at: nowIso,
        },
        { merge: true }
      )
      return { outcome: 'refunded', ticketId, ticket, amount: p.amount, currency: p.currency, refundId: res.refundId || null }
    }

    // Mobile money has no refund API: void now, queue the payout for an admin.
    // One queue doc per ticket (deterministic id) and one batch, so a re-run
    // can't queue the same ticket twice and the ticket can't be marked
    // manual_required with nothing in the queue.
    const batch = adminDb.batch()
    batch.set(
      ref,
      {
        status: 'refund_pending',
        refund_status: 'manual_required',
        refund_amount: p.amount,
        refund_currency: p.currency,
        refund_reason: reason,
        refund_error: null,
        refunded_by: actorId,
        refund_requested_at: nowIso,
        updated_at: nowIso,
      },
      { merge: true }
    )
    batch.set(adminDb.collection('manual_refund_queue').doc(`ticket_${ticketId}`), {
      ticketId,
      eventId: event.id,
      eventTitle: event.title || null,
      organizerId: event.organizer_id || null,
      userId: ticket.user_id || ticket.attendee_id || null,
      amount: p.amount,
      currency: p.currency,
      method: String(ticket.payment_method || 'moncash').toLowerCase(),
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
    return { outcome: 'queued', ticketId, ticket, amount: p.amount, currency: p.currency, needsReview }
  } catch (e: any) {
    const error = e?.message || 'refund_failed'
    const release =
      onFailure === 'release'
        ? { refund_status: null, refund_claimed_at: null }
        : {
            status: 'refund_pending',
            refund_status: 'failed',
            refund_error: error,
            refund_reason: reason,
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
