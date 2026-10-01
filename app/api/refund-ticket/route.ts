import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email'
import { sumRefundsByCurrency } from '@/lib/tickets/refundPlan'
import { refundTicket, resolveBuyerContact } from '@/lib/tickets/refundExecution'
import { loadOwnedTickets, parseTicketIds } from '@/lib/organizer/ticketActions'

export const dynamic = 'force-dynamic'

const MAX_TICKETS = 50

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

    const refunded: { ticketId: string; amount: number; currency: string }[] = []
    const queued: { ticketId: string; amount: number; currency: string }[] = []
    const failed: { ticketId: string; reason: string }[] = []
    const skipped: { ticketId: string; reason: string }[] = []

    // Claim, refund/queue and record each ticket through the same mechanics
    // event cancellation uses (lib/tickets/refundExecution.ts).
    for (const original of loaded.tickets) {
      const res = await refundTicket(original.id, {
        reason: 'organizer_refund',
        actorId: user.id,
        event: { id: event.id, title: event.title, organizer_id: event.organizer_id },
        onFailure: 'release',
      })
      if (res.outcome === 'refunded') refunded.push({ ticketId: res.ticketId, amount: res.amount, currency: res.currency })
      else if (res.outcome === 'queued') queued.push({ ticketId: res.ticketId, amount: res.amount, currency: res.currency })
      else if (res.outcome === 'skipped') skipped.push({ ticketId: res.ticketId, reason: res.reason })
      else failed.push({ ticketId: res.ticketId, reason: res.error })
    }

    // Tell the buyer, once per refund call (best-effort).
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
  const { uid, email: to } = await resolveBuyerContact(ticket)

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
