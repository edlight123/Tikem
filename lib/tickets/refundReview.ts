import { adminDb } from '@/lib/firebase/admin'
import { sendEmail, getRefundProcessedEmail } from '@/lib/email'
import {
  REFUND_REVIEWS,
  RefundQueueError,
  loadEventTitles,
  loadTickets,
  loadUsers,
} from '@/lib/tickets/manualRefundQueue'
import { refundTicket, resolveBuyerContact, type RefundReason } from '@/lib/tickets/refundExecution'
import { coverageInTransaction, loadRefundCoverageContext } from '@/lib/tickets/refundCoverage'

/**
 * Refunds awaiting a Tikèm decision (`refund_reviews/{ticketId}`), worked from
 * /admin/money/refunds. Written by lib/tickets/refundExecution.ts when the
 * organizer's remaining unwithdrawn balance could not cover a refund.
 *
 *   pending ─approve→ approving ─→ approved   (refund issued / queued, Tikèm funds the gap)
 *                              └─→ pending    (the provider refused; retry)
 *                              └─→ closed     (ticket no longer refundable)
 *   pending ─deny──→ denied                   (ticket back to live, refund_status 'denied')
 *   pending ─cancellation─→ superseded        (refundExecution, event cancelled)
 *
 * Approving re-runs refundTicket with `adminApprovedShortfall`, so the money
 * moves through the normal path (Stripe refund, or the manual mobile-money
 * queue), and records the shortfall Tikèm advanced as a negative carry in
 * `organizer_balance_adjustments/refund_{ticketId}`. NOTHING DEDUCTS THAT
 * CARRY YET: it is a record for the payouts team until a ledger reads it.
 */

export const ORGANIZER_BALANCE_ADJUSTMENTS = 'organizer_balance_adjustments'

const STALE_APPROVING_MS = 10 * 60 * 1000

export type RefundReviewItem = {
  ticketId: string
  status: 'pending' | 'approving'
  eventId: string | null
  eventTitle: string | null
  organizerId: string | null
  organizerName: string | null
  amount: number
  currency: string
  eventCurrency: string | null
  faceMinor: number | null
  coverageMinor: number | null
  shortfallMinor: number | null
  coverageError: string | null
  rail: string | null
  method: string | null
  reason: string | null
  buyerReason: string | null
  requestedBy: string | null
  buyerName: string | null
  buyerEmail: string | null
  buyerPhone: string | null
  ticketRefundStatus: string | null
  lastError: string | null
  createdAt: string | null
}

function str(value: unknown): string | null {
  const s = String(value ?? '').trim()
  return s || null
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export async function listRefundReviews(): Promise<RefundReviewItem[]> {
  const [pending, approving] = await Promise.all([
    adminDb.collection(REFUND_REVIEWS).where('status', '==', 'pending').get(),
    adminDb.collection(REFUND_REVIEWS).where('status', '==', 'approving').get(),
  ])
  const docs = [...pending.docs, ...approving.docs] as any[]
  const rows = docs.map((d) => ({ id: String(d.id), r: (d.data() || {}) as Record<string, any> }))
  const [tickets, titles] = await Promise.all([
    loadTickets(rows.map((x) => String(x.r.ticket_id || x.id))),
    loadEventTitles(rows.map((x) => String(x.r.event_id || ''))),
  ])
  const users = await loadUsers([
    ...rows.map((x) => String(x.r.user_id || '')),
    ...rows.map((x) => String(x.r.organizer_id || '')),
  ])

  return rows
    .map(({ id, r }) => {
      const ticketId = String(r.ticket_id || id)
      const t = tickets.get(ticketId) || {}
      const u = users.get(String(r.user_id || '')) || {}
      const o = users.get(String(r.organizer_id || '')) || {}
      return {
        ticketId,
        status: (String(r.status) === 'approving' ? 'approving' : 'pending') as RefundReviewItem['status'],
        eventId: str(r.event_id),
        eventTitle: str(r.event_title) || titles.get(String(r.event_id || '')) || null,
        organizerId: str(r.organizer_id),
        organizerName: str(o.full_name) || str(o.email),
        amount: Number(r.amount) || 0,
        currency: String(r.currency || 'HTG').toUpperCase(),
        eventCurrency: str(r.event_currency),
        faceMinor: num(r.face_amount_minor),
        coverageMinor: num(r.coverage_minor),
        shortfallMinor: num(r.shortfall_minor),
        coverageError: str(r.coverage_error),
        rail: str(r.rail),
        method: str(r.payment_method),
        reason: str(r.reason),
        buyerReason: str(r.buyer_reason),
        requestedBy: str(r.requested_by),
        // Same resolution order as the manual refund queue.
        buyerName: str(t.attendee_name) || str(u.full_name) || str(t.guest_name) || str(r.buyer_name),
        buyerEmail: str(u.email) || str(t.guest_email) || str(t.recipient_email) || str(r.buyer_email),
        buyerPhone:
          str(u.phone_number) || str(u.phone) || str(t.guest_phone) || str(t.payer_phone) || str(r.buyer_phone),
        ticketRefundStatus: str(t.refund_status),
        lastError: str(r.last_error),
        createdAt: str(r.created_at),
      }
    })
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
}

async function loadEventRef(eventId: string | null) {
  if (!eventId) return { id: '', title: null, organizer_id: null }
  const snap = await adminDb.collection('events').doc(eventId).get()
  const e = snap.exists ? ((snap.data() as any) ?? {}) : {}
  return { id: eventId, title: e.title || null, organizer_id: e.organizer_id || null }
}

/** The shortfall as it stands NOW (new sales since the review may cover part of it). */
async function currentShortfall(eventId: string, ticketId: string): Promise<{ shortfallMinor: number; currency: string } | null> {
  try {
    const ctx = await loadRefundCoverageContext(eventId)
    const ticketRef = adminDb.collection('tickets').doc(ticketId)
    return await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(ticketRef)
      const data = snap.exists ? ((snap.data() as any) ?? {}) : {}
      const c = await coverageInTransaction(tx, ctx, ticketId, data)
      return { shortfallMinor: c.shortfallMinor, currency: c.currency }
    })
  } catch (e: any) {
    console.error('[refund-review] could not recompute the shortfall', { ticketId, message: e?.message })
    return null
  }
}

function money(minor: number, currency: string) {
  return `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}

async function emailOrganizer(organizerId: string | null, subject: string, body: string) {
  if (!organizerId) return
  try {
    const snap = await adminDb.collection('users').doc(organizerId).get()
    const to = snap.exists ? (snap.data() as any)?.email : null
    if (!to) return
    await sendEmail({
      to,
      subject,
      html: `<!doctype html><html><body style="margin:0;padding:24px;background:#0A0A0A;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:520px;margin:0 auto">
    <p style="font-size:12px;letter-spacing:1px;color:#A3A3A3;text-transform:uppercase;margin:0 0 8px">Tikèm</p>
    ${body}
  </div></body></html>`,
    })
  } catch (e: any) {
    console.error('[refund-review] organizer email failed', { organizerId, message: e?.message })
  }
}

async function emailBuyer(ticket: Record<string, any>, ticketId: string, eventTitle: string, status: 'approved' | 'denied', amount: number) {
  try {
    const { uid, email } = await resolveBuyerContact(ticket)
    if (uid) {
      await adminDb
        .collection('users')
        .doc(uid)
        .collection('notifications')
        .add({
          type: status === 'approved' ? 'ticket_refunded' : 'refund_denied',
          title: `Refund for ${eventTitle}`,
          message:
            status === 'approved'
              ? 'Your refund was approved and is being processed.'
              : 'Your refund was not approved. Your ticket is still valid.',
          ticketId,
          isRead: false,
          createdAt: new Date(),
        })
        .catch(() => undefined)
    }
    if (!email) return
    await sendEmail({
      to: email,
      subject: `Refund ${status === 'approved' ? 'approved' : 'not approved'}: ${eventTitle}`,
      html: getRefundProcessedEmail({
        attendeeName: String(ticket.attendee_name || ticket.guest_name || 'there'),
        eventTitle,
        status,
        refundAmount: status === 'approved' ? amount : 0,
        ticketId,
      }),
    })
  } catch (e: any) {
    console.error('[refund-review] buyer email failed', { ticketId, message: e?.message })
  }
}

export type ApproveResult = {
  outcome: 'refunded' | 'queued'
  amount: number
  currency: string
  /** What Tikèm advanced, event currency minor units (0 = covered by the time it was approved). */
  shortfallMinor: number
  eventCurrency: string | null
  adjustmentId: string | null
}

/**
 * Approve: Tikèm funds the gap. The review is moved to 'approving' in a
 * transaction first, so two admins cannot both run the refund.
 */
export async function approveRefundReview(input: {
  ticketId: string
  actorId: string
  note?: string | null
  /**
   * A ticket already used at the door is refused (409, code 'checked_in')
   * unless the admin confirmed refunding it anyway.
   */
  allowCheckedIn?: boolean
}): Promise<ApproveResult> {
  const ticketId = String(input.ticketId || '').trim()
  const note = String(input.note ?? '').trim().slice(0, 500) || null
  if (!ticketId || ticketId.includes('/')) throw new RefundQueueError('Invalid ticket id', 400)
  const reviewRef = adminDb.collection(REFUND_REVIEWS).doc(ticketId)
  const nowIso = new Date().toISOString()

  const review: Record<string, any> = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(reviewRef)
    if (!snap.exists) throw new RefundQueueError('Review not found', 404)
    const r = (snap.data() as any) || {}
    // An approval that died mid-way (crash, timeout) is retryable after a while:
    // refundTicket's claim and Stripe idempotency key make a re-run safe.
    const staleApproving =
      String(r.status) === 'approving' &&
      Date.now() - new Date(String(r.approving_at || 0)).getTime() > STALE_APPROVING_MS
    if (String(r.status) !== 'pending' && !staleApproving) {
      throw new RefundQueueError(`Already ${String(r.status || 'handled')}`, 409)
    }
    tx.set(reviewRef, { status: 'approving', approving_by: input.actorId, approving_at: nowIso }, { merge: true })
    return r
  })

  const event = await loadEventRef(str(review.event_id))
  const current = event.id ? await currentShortfall(event.id, ticketId) : null
  const shortfallMinor = current ? current.shortfallMinor : Math.max(0, Number(review.shortfall_minor) || 0)
  const eventCurrency = current?.currency || str(review.event_currency)

  const res = await refundTicket(ticketId, {
    reason: (String(review.reason || 'organizer_refund') as RefundReason) || 'organizer_refund',
    actorId: input.actorId,
    event,
    onFailure: 'release',
    keepRefundReason: review.keep_refund_reason === true,
    // The approving admin is looking at the queue: no extra email for a manual payout.
    notifyAdmins: false,
    adminApprovedShortfall: { adminId: input.actorId },
    // A cancelled event's buyer is refunded regardless, as the cancellation sweep does.
    allowCheckedIn: input.allowCheckedIn === true || String(review.reason || '') === 'event_cancelled',
  })

  if (res.outcome === 'skipped' && res.reason === 'checked_in') {
    // Nothing was claimed or moved: the review goes back to pending for the admin to confirm.
    await reviewRef.set({ status: 'pending', updated_at: new Date().toISOString() }, { merge: true })
    throw new RefundQueueError(
      'This ticket was already checked in at the door. Confirm to refund it anyway.',
      409,
      'checked_in'
    )
  }

  if (res.outcome === 'failed') {
    // The claim was released back to 'admin_review': the review stays open.
    await reviewRef.set({ status: 'pending', last_error: res.error, updated_at: new Date().toISOString() }, { merge: true })
    throw new RefundQueueError(`The refund did not go through: ${res.error}`, 502)
  }
  if (res.outcome === 'skipped' || res.outcome === 'admin_review') {
    const why = res.outcome === 'skipped' ? res.reason : 'admin_review'
    await reviewRef.set(
      {
        status: 'closed',
        resolved_by: input.actorId,
        resolved_at: new Date().toISOString(),
        resolution_note: `Ticket no longer refundable here (${why})${note ? `: ${note}` : ''}`,
      },
      { merge: true }
    )
    throw new RefundQueueError(`This ticket can no longer be refunded here (${why}). The review was closed.`, 409)
  }

  let adjustmentId: string | null = null
  const doneIso = new Date().toISOString()
  if (shortfallMinor > 0) {
    adjustmentId = `refund_${ticketId}`
    await adminDb
      .collection(ORGANIZER_BALANCE_ADJUSTMENTS)
      .doc(adjustmentId)
      .set({
        organizer_id: str(review.organizer_id) || event.organizer_id || null,
        event_id: event.id || null,
        amount_minor: -shortfallMinor,
        currency: eventCurrency,
        reason: 'refund_after_withdrawal',
        ticket_id: ticketId,
        approved_by: input.actorId,
        note,
        // Nothing reads this yet: a future ledger must deduct it and flip this.
        applied: false,
        created_at: doneIso,
      })
      .catch(async (e: any) => {
        adjustmentId = null
        console.error('[refund-review] RECORD BY HAND: refund approved but the negative carry was not written', {
          ticketId,
          shortfallMinor,
          message: e?.message,
        })
      })
  }

  await reviewRef.set(
    {
      status: 'approved',
      approved_by: input.actorId,
      approved_at: doneIso,
      resolution_note: note,
      outcome: res.outcome,
      shortfall_at_approval_minor: shortfallMinor,
      adjustment_id: adjustmentId,
      last_error: null,
    },
    { merge: true }
  )

  const title = String(event.title || 'your event')
  await emailBuyer(res.ticket, ticketId, title, 'approved', res.amount)
  await emailOrganizer(
    event.organizer_id,
    `Refund approved: ${title}`,
    `<h1 style="font-size:22px;margin:0 0 12px">Tikèm approved a refund for ${escapeHtml(title)}</h1>
    <p style="line-height:1.5;margin:0 0 16px">The refund you sent for review has been issued to the buyer.${
      shortfallMinor > 0 && eventCurrency
        ? ` Your remaining balance did not cover <strong>${escapeHtml(money(shortfallMinor, eventCurrency))}</strong> of it; Tikèm advanced that amount and it is recorded against your account.`
        : ''
    }</p>`
  )

  return { outcome: res.outcome, amount: res.amount, currency: res.currency, shortfallMinor, eventCurrency, adjustmentId }
}

/** Deny: no money moves; the ticket is live again with refund_status 'denied'. */
export async function denyRefundReview(input: { ticketId: string; actorId: string; note?: string | null }): Promise<void> {
  const ticketId = String(input.ticketId || '').trim()
  const note = String(input.note ?? '').trim().slice(0, 500) || null
  if (!ticketId || ticketId.includes('/')) throw new RefundQueueError('Invalid ticket id', 400)
  const reviewRef = adminDb.collection(REFUND_REVIEWS).doc(ticketId)
  const ticketRef = adminDb.collection('tickets').doc(ticketId)
  const nowIso = new Date().toISOString()

  const { review, ticket, held } = await adminDb.runTransaction(async (tx: any) => {
    const [rSnap, tSnap] = [await tx.get(reviewRef), await tx.get(ticketRef)]
    if (!rSnap.exists) throw new RefundQueueError('Review not found', 404)
    const r = (rSnap.data() as any) || {}
    if (String(r.status) !== 'pending') throw new RefundQueueError(`Already ${String(r.status || 'handled')}`, 409)
    // A refund held because the event was cancelled must be paid: the buyer
    // has no event to attend, so denying it would keep their money for nothing.
    if (String(r.reason || '') === 'event_cancelled') {
      throw new RefundQueueError(
        'This refund is for a cancelled event, so the buyer must be refunded. Approve it instead.',
        409,
        'event_cancelled'
      )
    }
    const t = tSnap.exists ? ((tSnap.data() as any) ?? {}) : null
    const onHold = Boolean(t) && String(t.refund_status || '').toLowerCase() === 'admin_review'
    if (onHold) {
      tx.set(
        ticketRef,
        {
          refund_status: 'denied',
          refund_processed_at: nowIso,
          refund_denied_by: input.actorId,
          refund_review_note: note,
          updated_at: nowIso,
        },
        { merge: true }
      )
    }
    tx.set(
      reviewRef,
      {
        status: onHold ? 'denied' : 'closed',
        resolved_by: input.actorId,
        resolved_at: nowIso,
        resolution_note: onHold ? note : `Ticket was no longer on hold${note ? `: ${note}` : ''}`,
      },
      { merge: true }
    )
    return { review: r, ticket: (t || {}) as Record<string, any>, held: onHold }
  })
  if (!held) throw new RefundQueueError('This ticket is no longer on hold for review. The review was closed.', 409)

  const event = await loadEventRef(str(review.event_id))
  const title = String(event.title || review.event_title || 'your event')
  await emailBuyer(ticket, ticketId, title, 'denied', 0)
  await emailOrganizer(
    event.organizer_id || str(review.organizer_id),
    `Refund not approved: ${title}`,
    `<h1 style="font-size:22px;margin:0 0 12px">A refund for ${escapeHtml(title)} was not approved</h1>
    <p style="line-height:1.5;margin:0 0 16px">Tikèm reviewed the refund your remaining balance didn't cover and did not approve it. The buyer's ticket is valid again and no money moved.${
      note ? ` Note from Tikèm: ${escapeHtml(note)}` : ''
    }</p>`
  )
}
