import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email'
import { processStripeRefund } from '@/lib/refunds'
import { planTicketRefund, sumRefundsByCurrency, type RefundPlan } from '@/lib/tickets/refundPlan'
import { loadOwnedTickets, parseTicketIds } from '@/lib/organizer/ticketActions'

export const dynamic = 'force-dynamic'

const MAX_TICKETS = 50

type Eligible = Extract<RefundPlan, { eligible: true }>

/**
 * Organizer action: refund tickets. Called by the web attendee drawer with
 * `{ ticketId }` and by the mobile order view with `{ ticketIds }`.
 *
 * Eligibility and the amount come from lib/tickets/refundPlan.ts — the same
 * function the order list uses to state the amount in its confirmation sheet:
 *   - card (Stripe)      refunded now; a destination charge pulls the money back
 *                        out of the organizer's connected account
 *   - MonCash / NatCash / SogePay
 *                        no refund API: the ticket is voided now and the payout
 *                        is queued for an admin (manual_refund_queue), exactly as
 *                        event cancellation does
 *   - free / comp, already refunded, or not live
 *                        refused
 *
 * Each ticket is CLAIMED in a transaction (refund_status: 'processing') before
 * any money moves, so a double tap or two devices cannot refund it twice.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const ids = parseTicketIds(body, MAX_TICKETS)
    if (!ids) return NextResponse.json({ error: 'ticketId or ticketIds is required' }, { status: 400 })

    const loaded = await loadOwnedTickets(ids)
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    const { event, user } = loaded.access

    if (String(event.status || '').toLowerCase() === 'cancelled') {
      return NextResponse.json(
        { error: 'This event was cancelled; its tickets were already refunded.', code: 'event_cancelled' },
        { status: 409 }
      )
    }

    const nowIso = new Date().toISOString()
    const refunded: { ticketId: string; amount: number; currency: string }[] = []
    const queued: { ticketId: string; amount: number; currency: string }[] = []
    const failed: { ticketId: string; reason: string }[] = []
    const skipped: { ticketId: string; reason: string }[] = []

    for (const original of loaded.tickets) {
      const ref = adminDb.collection('tickets').doc(original.id)

      // 1. Claim. Re-read inside the transaction so the plan reflects the
      // current doc, not the one loaded a moment ago.
      let plan: RefundPlan
      let ticket: Record<string, any> = original
      try {
        plan = await adminDb.runTransaction(async (tx: any) => {
          const snap = await tx.get(ref)
          ticket = snap.exists ? (snap.data() as any) : {}
          const p = planTicketRefund(ticket)
          if (p.eligible) {
            tx.set(
              ref,
              { refund_status: 'processing', refund_claimed_at: nowIso, refund_claimed_by: user.id },
              { merge: true }
            )
          }
          return p
        })
      } catch (e: any) {
        failed.push({ ticketId: original.id, reason: e?.message || 'claim_failed' })
        continue
      }

      if (!plan.eligible) {
        skipped.push({ ticketId: original.id, reason: plan.reason })
        continue
      }
      const p = plan as Eligible

      // 2. Move the money (or queue it).
      try {
        if (p.rail === 'stripe' || p.rail === 'stripe_connect') {
          const res = await processStripeRefund(String(p.paymentRef), p.amount, {
            reverseTransfer: p.rail === 'stripe_connect',
            refundApplicationFee: p.rail === 'stripe_connect',
          })
          if (!res.success) throw new Error(res.error || 'Stripe refund failed')
          await ref.set(
            {
              status: 'refunded',
              refund_status: 'approved',
              refund_amount: p.amount,
              refund_currency: p.currency,
              refund_id: res.refundId || null,
              refund_reason: 'organizer_refund',
              refunded_by: user.id,
              refund_processed_at: nowIso,
              updated_at: nowIso,
            },
            { merge: true }
          )
          refunded.push({ ticketId: original.id, amount: p.amount, currency: p.currency })
        } else {
          await ref.set(
            {
              status: 'refund_pending',
              refund_status: 'manual_required',
              refund_amount: p.amount,
              refund_currency: p.currency,
              refund_reason: 'organizer_refund',
              refunded_by: user.id,
              refund_requested_at: nowIso,
              updated_at: nowIso,
            },
            { merge: true }
          )
          await adminDb.collection('manual_refund_queue').add({
            ticketId: original.id,
            eventId: event.id,
            eventTitle: event.title || null,
            organizerId: event.organizer_id || null,
            userId: ticket.user_id || ticket.attendee_id || null,
            amount: p.amount,
            currency: p.currency,
            method: String(ticket.payment_method || 'moncash').toLowerCase(),
            transactionId: p.paymentRef,
            reason: 'organizer_refund',
            requestedBy: user.id,
            status: 'pending',
            createdAt: nowIso,
          })
          queued.push({ ticketId: original.id, amount: p.amount, currency: p.currency })
        }
      } catch (e: any) {
        // Release the claim so the organizer can retry; nothing was refunded.
        await ref.set({ refund_status: null, refund_claimed_at: null }, { merge: true }).catch(() => undefined)
        failed.push({ ticketId: original.id, reason: e?.message || 'refund_failed' })
      }
    }

    // 3. Tell the buyer, once per refund call (best-effort).
    if (refunded.length + queued.length > 0) {
      await notifyBuyer(loaded.tickets[0], event, refunded, queued).catch((e) =>
        console.error('[refund-ticket] notify failed', e)
      )
    }

    const payload = { refunded, queued, failed, skipped }
    if (refunded.length + queued.length === 0) {
      const code = failed.length > 0 ? 'refund_failed' : skipped[0]?.reason || 'not_refundable'
      return NextResponse.json(
        { error: failed.length > 0 ? 'Refund failed' : 'Nothing to refund', code, ...payload },
        { status: failed.length > 0 ? 502 : 409 }
      )
    }
    return NextResponse.json({ success: true, ...payload })
  } catch (error) {
    console.error('[refund-ticket] failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function notifyBuyer(
  ticket: Record<string, any>,
  event: Record<string, any>,
  refunded: { amount: number; currency: string }[],
  queued: { amount: number; currency: string }[]
) {
  const isGuest = Boolean(ticket.is_guest) || String(ticket.attendee_id || '').startsWith('guest_')
  const uid = isGuest ? null : String(ticket.user_id || ticket.attendee_id || '') || null
  let to: string | null = isGuest ? ticket.guest_email || null : null
  if (uid) {
    const snap = await adminDb.collection('users').doc(uid).get()
    to = (snap.exists && (snap.data() as any)?.email) || null
  }
  to = to || ticket.recipient_email || null

  const title = String(event.title || 'your event')
  const toPlans = (rows: { amount: number; currency: string }[]) =>
    rows.map((r) => ({ eligible: true as const, rail: 'manual' as const, amount: r.amount, currency: r.currency, paymentRef: null }))
  const fmt = (rows: { amount: number; currency: string }[]) =>
    sumRefundsByCurrency(toPlans(rows))
      .map((r) => `${r.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${r.currency}`)
      .join(' + ')

  if (uid) {
    await adminDb
      .collection('users')
      .doc(uid)
      .collection('notifications')
      .add({
        type: 'ticket_refunded',
        title: `Refund for ${title}`,
        message: queued.length > 0 && refunded.length === 0
          ? 'Your ticket was cancelled and your refund is being processed.'
          : 'Your ticket was refunded to your original payment method.',
        eventId: event.id,
        ticketId: ticket.id,
        isRead: false,
        createdAt: new Date(),
      })
      .catch(() => undefined)
  }

  if (!to) return
  const lines: string[] = []
  if (refunded.length > 0) {
    lines.push(
      `<p style="line-height:1.5;margin:0 0 16px"><strong>${fmt(refunded)}</strong> has been refunded to your original payment method. It can take 5–10 days to appear.</p>`
    )
  }
  if (queued.length > 0) {
    lines.push(
      `<p style="line-height:1.5;margin:0 0 16px">A refund of <strong>${fmt(queued)}</strong> is being processed. Mobile-money refunds are sent by hand, so allow a few business days.</p>`
    )
  }
  await sendEmail({
    to,
    subject: `Refund: ${title}`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#0A0A0A;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:520px;margin:0 auto">
    <p style="font-size:12px;letter-spacing:1px;color:#A3A3A3;text-transform:uppercase;margin:0 0 8px">Tikèm</p>
    <h1 style="font-size:24px;margin:0 0 12px">Your ticket for ${escapeHtml(title)} was refunded</h1>
    ${lines.join('\n    ')}
    <p style="color:#A3A3A3;font-size:13px;line-height:1.5;margin:24px 0 0">The organizer issued this refund, so the ticket no longer admits entry. If anything looks wrong, reply to this email.</p>
  </div></body></html>`,
  })
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}
