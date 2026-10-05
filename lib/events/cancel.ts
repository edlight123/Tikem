import { adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email'
import { refundTicket, resolveBuyerContact, type TicketRefundResult } from '@/lib/tickets/refundExecution'

/**
 * Cancelling an event is a MONEY operation, not a status flag.
 *
 * Before this existed, cancel wrote `status: 'cancelled'` from the mobile client
 * and nothing else: tickets stayed valid, buyers were never told, and the
 * organizer could still withdraw the takings for an event that never happened.
 *
 * One cancel does all of it, in an order chosen so a partial failure can't pay
 * out money for a dead event:
 *   1. mark the event cancelled  — withdrawals check this and refuse (see
 *      withdraw-bank / withdraw-moncash), so the freeze lands FIRST
 *   2. zero the event's withdrawable earnings
 *   3. refund every live ticket through lib/tickets/refundExecution.ts — the
 *      same planner, claim and refund mechanics as the organizer's per-ticket
 *      refund, so the amount comes from the fields the purchase paths actually
 *      write (`charged_amount` / `charged_currency`, `payment_id`):
 *        - card (`stripe`, `stripe_connect`) refunded now, in the charged
 *          currency; destination charges pull the money back OUT of the
 *          organizer's connected account (reverse_transfer)
 *        - MonCash / NatCash / SogePay voided and queued for an admin
 *        - free / comp voided, nothing to refund
 *   4. tell every affected buyer, in-app and by email
 *
 * IDEMPOTENT: re-running on an already-cancelled event resumes the sweep
 * instead of refusing. Each ticket is claimed in a transaction before money
 * moves and planTicketRefund refuses refunded / refund_pending / in-flight
 * tickets, so a second run refunds nothing twice and re-notifies nobody it
 * already told. It only retries tickets a previous run left
 * `refund_status: 'failed'` — and Stripe refunds carry a per-ticket idempotency
 * key, so even a refund whose success was never recorded is replayed, not
 * repeated.
 */

export type CancelActor = {
  id: string
  email?: string | null
  isAdmin: boolean
}

export type CancelOutcome = {
  eventId: string
  /** True when the event was already cancelled and this run only resumed the sweep. */
  alreadyCancelled: boolean
  ticketsAffected: number
  refundsSucceeded: number
  refundsQueuedManual: number
  refundsFailed: number
  freeTicketsVoided: number
  /** Tickets already refunded, pending or in flight — left untouched. */
  alreadyHandled: number
  notified: number
  failures: { ticketId: string; reason: string }[]
  /**
   * Set when the server-side cancellation stamp on event_earnings could not be
   * written after retries. The event doc is still frozen; re-run the cancel.
   */
  ledgerStampFailed?: string
}

type BuyerNotice =
  | { kind: 'refunded'; amount: number; currency: string }
  | { kind: 'manual'; amount: number; currency: string }
  | { kind: 'pending' }
  | { kind: 'free' }

export async function cancelEventWithRefunds({
  eventId,
  actor,
  reason,
}: {
  eventId: string
  actor: CancelActor
  reason?: string | null
}): Promise<CancelOutcome> {
  const eventRef = adminDb.collection('events').doc(eventId)
  const eventSnap = await eventRef.get()
  if (!eventSnap.exists) throw Object.assign(new Error('Event not found'), { status: 404 })

  const event = eventSnap.data() as any
  const alreadyCancelled = String(event?.status || '').toLowerCase() === 'cancelled'
  // Buyers see the reason given when the event was first cancelled.
  const buyerReason: string | null = alreadyCancelled
    ? event?.cancellation_reason || reason || null
    : reason || null

  const nowIso = new Date().toISOString()

  if (!alreadyCancelled) {
    // 1. FREEZE FIRST. Both withdrawal routes reject a cancelled event, so even if
    // a later step throws, the takings can no longer leave.
    await eventRef.set(
      {
        status: 'cancelled',
        is_published: false,
        cancelled_at: nowIso,
        cancelled_by: actor.id,
        cancelled_by_admin: actor.isAdmin,
        cancellation_reason: reason || null,
        payouts_frozen: true,
        updated_at: nowIso,
      },
      { merge: true }
    )
  }

  // 2. Nothing left to withdraw. Refunded tickets are already excluded when
  // earnings are derived from tickets, but the STORED doc is what withdrawals
  // read, so it has to be zeroed explicitly. Re-applying it on a resume is harmless.
  //
  // This stamp is also the SERVER-SIDE record of the cancellation that the payout
  // availability reads (lib/payouts/availability-server.ts), so it must not be
  // swallowed. Retried; if it still fails the outcome says so and the route
  // answers 500 — the sweep is resumable, so re-running the cancel re-applies it.
  let ledgerStampError: string | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await adminDb.collection('event_earnings').doc(eventId).set(
        {
          availableToWithdraw: 0,
          settlementStatus: 'cancelled',
          ...(alreadyCancelled ? {} : { cancelledAt: nowIso }),
          updatedAt: nowIso,
        },
        { merge: true }
      )
      ledgerStampError = null
      break
    } catch (e: any) {
      ledgerStampError = String(e?.message || e)
      console.error('[cancelEvent] failed to stamp the earnings ledger', { eventId, attempt, message: ledgerStampError })
    }
  }

  // 3. Refund every live ticket.
  const ticketsSnap = await adminDb.collection('tickets').where('event_id', '==', eventId).get()

  const outcome: CancelOutcome = {
    eventId,
    alreadyCancelled,
    ticketsAffected: 0,
    refundsSucceeded: 0,
    refundsQueuedManual: 0,
    refundsFailed: 0,
    freeTicketsVoided: 0,
    alreadyHandled: 0,
    notified: 0,
    failures: [],
    ...(ledgerStampError ? { ledgerStampFailed: ledgerStampError } : {}),
  }

  const refundEvent = { id: eventId, title: event?.title || null, organizer_id: event?.organizer_id || null }

  for (const doc of ticketsSnap.docs) {
    const res = await refundTicket(doc.id, {
      reason: 'event_cancelled',
      actorId: actor.id,
      event: refundEvent,
      onFailure: 'hold',
      cancellation: true,
    })

    let notice: BuyerNotice | null = null
    if (res.outcome === 'refunded') {
      outcome.refundsSucceeded += 1
      notice = { kind: 'refunded', amount: res.amount, currency: res.currency }
    } else if (res.outcome === 'queued') {
      outcome.refundsQueuedManual += 1
      notice = { kind: 'manual', amount: res.amount, currency: res.currency }
    } else if (res.outcome === 'failed') {
      outcome.refundsFailed += 1
      outcome.failures.push({ ticketId: doc.id, reason: res.error })
      // A retry that fails again was already announced by the first run.
      if (String(res.ticket?.refund_status || '').toLowerCase() !== 'failed') notice = { kind: 'pending' }
    } else if (res.reason === 'free') {
      // Free / RSVP / comp — nothing to refund, but the ticket must stop being
      // valid so it can't be scanned at a door that no longer exists.
      try {
        await doc.ref.set(
          { status: 'cancelled', cancelled_at: nowIso, cancellation_reason: 'event_cancelled', updated_at: nowIso },
          { merge: true }
        )
        outcome.freeTicketsVoided += 1
        notice = { kind: 'free' }
      } catch (e: any) {
        outcome.refundsFailed += 1
        outcome.failures.push({ ticketId: doc.id, reason: e?.message || 'void_failed' })
      }
    } else {
      // Already refunded, refund pending (including a previous run's manual
      // queue), in flight, or not live: already dealt with.
      outcome.alreadyHandled += 1
      continue
    }

    outcome.ticketsAffected += 1

    // 4. Tell the buyer. Best-effort per ticket: a bounced email must not stop
    // the remaining refunds.
    if (notice && (await notifyBuyer(res, notice, event, eventId, buyerReason))) {
      outcome.notified += 1
    }
  }

  return outcome
}

async function notifyBuyer(
  res: TicketRefundResult,
  notice: BuyerNotice,
  event: Record<string, any>,
  eventId: string,
  reason: string | null
): Promise<boolean> {
  try {
    const { uid, email } = await resolveBuyerContact(res.ticket || {})
    if (!uid && !email) return false
    if (uid) {
      await adminDb
        .collection('users')
        .doc(uid)
        .collection('notifications')
        .add({
          type: 'event_cancelled',
          title: `${event?.title || 'Event'} was cancelled`,
          message:
            notice.kind === 'free'
              ? 'Your registration has been cancelled.'
              : notice.kind === 'refunded'
                ? 'Your ticket has been cancelled and refunded to your original payment method.'
                : 'Your ticket has been cancelled and your refund is on the way.',
          eventId,
          ticketId: res.ticketId,
          isRead: false,
          createdAt: new Date(),
        })
    }
    if (email) {
      await sendEmail({
        to: email,
        subject: `Cancelled: ${event?.title || 'your event'}`,
        html: cancellationEmailHtml({ eventTitle: event?.title || 'your event', reason, notice }),
      })
    }
    return true
  } catch (e) {
    console.error('[cancelEvent] notify failed', res.ticketId, e)
    return false
  }
}

function cancellationEmailHtml({
  eventTitle,
  reason,
  notice,
}: {
  eventTitle: string
  reason: string | null
  notice: BuyerNotice
}) {
  const money =
    notice.kind === 'refunded' || notice.kind === 'manual'
      ? `${notice.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${notice.currency}`
      : null
  const body =
    notice.kind === 'refunded'
      ? `<p style="line-height:1.5;margin:0 0 16px">Your ticket is cancelled and <strong>${money}</strong> has been refunded to your original payment method. It can take 5–10 days to appear.</p>`
      : notice.kind === 'manual'
        ? `<p style="line-height:1.5;margin:0 0 16px">Your ticket is cancelled and a refund of <strong>${money}</strong> is being processed. Mobile-money refunds are sent by hand, so allow a few business days.</p>`
        : notice.kind === 'pending'
          ? `<p style="line-height:1.5;margin:0 0 16px">Your ticket is cancelled and your refund is being processed. We'll be in touch if we need anything from you.</p>`
          : `<p style="line-height:1.5;margin:0 0 16px">Your free registration has been cancelled. Nothing was charged.</p>`
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#0A0A0A;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:520px;margin:0 auto">
    <p style="font-size:12px;letter-spacing:1px;color:#A3A3A3;text-transform:uppercase;margin:0 0 8px">Tikèm</p>
    <h1 style="font-size:24px;margin:0 0 12px">${escapeHtml(eventTitle)} was cancelled</h1>
    ${reason ? `<p style="color:#A3A3A3;line-height:1.5;margin:0 0 16px">Reason: ${escapeHtml(reason)}</p>` : ''}
    ${body}
    <p style="color:#A3A3A3;font-size:13px;line-height:1.5;margin:24px 0 0">If anything looks wrong, reply to this email and we'll sort it out.</p>
  </div></body></html>`
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}
