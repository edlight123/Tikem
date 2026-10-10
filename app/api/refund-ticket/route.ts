import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email'
import { renderEmail, eyebrow, bigFigure, title, eventRow, p, gap, rowsBlock, C } from '@/lib/email-kit/layout'
import { COMMON, formatEventWhen, formatMoney, type EmailLang } from '@/lib/email-kit/i18n'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { eventInstantIso } from '@/lib/email-templates/reminder'
import { sumRefundsByCurrency } from '@/lib/tickets/refundPlan'
import { adminReviewMessage, refundTicket, resolveBuyerContact } from '@/lib/tickets/refundExecution'
import { HAITI_MANUAL_APPROVAL, SHORTFALL_REVIEW, type RefundReviewReason } from '@/lib/tickets/refundApprovalPolicy'
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
 *
 * A refund of money Tikèm holds that the organizer's remaining unwithdrawn
 * balance cannot cover is NOT sent: it goes to a Tikèm admin (`review` in the
 * response, refund_status 'admin_review'). When every ticket went to review the
 * answer is 202 with a message saying so. Every refund for an event in a country
 * that needs Tikèm's approval (Haiti by default, lib/tickets/refundApprovalPolicy)
 * goes to that same review.
 *
 * The service fee is non-refundable: a refund here returns the face value only
 * (lib/tickets/refundPlan.ts). The reason is NOT taken from the body: only an
 * event cancellation (lib/events/cancel.ts) or a Tikèm admin's approval as
 * 'event_changed' returns the fee.
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
    const review: { ticketId: string; amount: number; currency: string }[] = []
    const reviewReasons: RefundReviewReason[] = []

    // Claim, refund/queue and record each ticket through the same mechanics
    // event cancellation uses (lib/tickets/refundExecution.ts).
    for (const original of loaded.tickets) {
      // A ticket already used at the door is refunded only on purpose
      // (body.allowCheckedIn), never as part of a bulk tap.
      if (((original as any).checked_in === true || (original as any).checked_in_at) && body?.allowCheckedIn !== true) {
        skipped.push({ ticketId: original.id, reason: 'checked_in' })
        continue
      }
      const res = await refundTicket(original.id, {
        reason: 'organizer_refund',
        actorId: user.id,
        event: { id: event.id, title: event.title, organizer_id: event.organizer_id, country: event.country ?? null },
        onFailure: 'release',
        // Re-judged inside the claim: a check-in landing after the read above is still refused.
        allowCheckedIn: body?.allowCheckedIn === true,
      })
      if (res.outcome === 'refunded') refunded.push({ ticketId: res.ticketId, amount: res.amount, currency: res.currency })
      else if (res.outcome === 'queued') queued.push({ ticketId: res.ticketId, amount: res.amount, currency: res.currency })
      else if (res.outcome === 'admin_review') {
        review.push({ ticketId: res.ticketId, amount: res.amount, currency: res.currency })
        reviewReasons.push(res.reviewReason)
      }
      else if (res.outcome === 'skipped') skipped.push({ ticketId: res.ticketId, reason: res.reason })
      else failed.push({ ticketId: res.ticketId, reason: res.error })
    }

    // Tell the buyer, once per refund call (best-effort).
    if (refunded.length + queued.length > 0) {
      await notifyBuyer(loaded.tickets[0], event, refunded, queued).catch((e) =>
        console.error('[refund-ticket] notify failed', e)
      )
    }

    const payload = {
      refunded,
      queued,
      failed,
      skipped,
      review,
      // 'haiti_manual_approval' when any ticket waits because the event's country
      // needs Tikèm's approval; 'shortfall' when only the balance gate held them.
      ...(review.length > 0
        ? { reviewReason: reviewReasons.includes(HAITI_MANUAL_APPROVAL) ? HAITI_MANUAL_APPROVAL : SHORTFALL_REVIEW }
        : {}),
    }
    if (refunded.length + queued.length === 0 && review.length > 0) {
      return NextResponse.json(
        { success: true, code: 'admin_review', message: adminReviewMessage(reviewReasons), ...payload },
        { status: 202 }
      )
    }
    if (refunded.length + queued.length === 0) {
      const code = failed.length > 0 ? 'refund_failed' : skipped[0]?.reason || 'not_refundable'
      return NextResponse.json(
        { error: failed.length > 0 ? 'Refund failed' : 'Nothing to refund', code, ...payload },
        { status: failed.length > 0 ? 502 : 409 }
      )
    }
    return NextResponse.json({
      success: true,
      ...(review.length > 0 ? { message: `Some tickets were refunded. ${adminReviewMessage(reviewReasons)}` } : {}),
      ...payload,
    })
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
  const lang = await resolveEmailLang({ userId: uid, email: to, event })
  const message = refundEmail(lang, event, ticket, sumRefundsByCurrency(toPlans(refunded)), sumRefundsByCurrency(toPlans(queued)), sumRefundsByCurrency(toPlans([...refunded, ...queued])))
  await sendEmail({ to, subject: message.subject, html: message.html })
}

const REFUND_COPY = {
  en: {
    fallbackTitle: 'your event',
    subject: (e: string) => `Refund: ${e}`,
    status: 'Refunded',
    eyebrow: 'Refund issued',
    headline: (e: string) => `Your ticket for ${e} was refunded`,
    preheader: (m: string) => `${m} is on its way back to you.`,
    captionRefunded: 'back to your original payment method',
    captionQueued: 'refund being processed',
    captionMixed: 'refunded in total',
    refunded: (m: string) => `${m} has been refunded to your original payment method. It can take 5 to 10 days to appear.`,
    queued: (m: string) => `A refund of ${m} is being processed. Mobile-money refunds are sent by hand, so allow a few business days.`,
    note: 'The organizer issued this refund, so the ticket no longer admits entry. If anything looks wrong, write to us from the Help page.',
  },
  fr: {
    fallbackTitle: 'votre événement',
    subject: (e: string) => `Remboursement : ${e}`,
    status: 'Remboursé',
    eyebrow: 'Remboursement effectué',
    headline: (e: string) => `Votre billet pour ${e} a été remboursé`,
    preheader: (m: string) => `${m} est en route vers vous.`,
    captionRefunded: 'sur votre moyen de paiement initial',
    captionQueued: 'remboursement en cours',
    captionMixed: 'remboursés au total',
    refunded: (m: string) => `${m} vous ont été remboursés sur votre moyen de paiement initial. Comptez 5 à 10 jours pour les voir apparaître.`,
    queued: (m: string) => `Un remboursement de ${m} est en cours. Les remboursements mobile money sont envoyés manuellement : comptez quelques jours ouvrés.`,
    note: "C'est l'organisateur qui a effectué ce remboursement : le billet ne donne plus accès à l'événement. Si quelque chose ne va pas, écrivez-nous depuis la page Aide.",
  },
  ht: {
    fallbackTitle: 'evènman ou an',
    subject: (e: string) => `Ranbousman: ${e}`,
    status: 'Ranbouse',
    eyebrow: 'Ranbousman fèt',
    headline: (e: string) => `Yo ranbouse tikè ou pou ${e}`,
    preheader: (m: string) => `${m} ap tounen ba ou.`,
    captionRefunded: 'ap tounen sou mwayen peman ou te itilize a',
    captionQueued: 'ranbousman an ap trete',
    captionMixed: 'ranbouse an total',
    refunded: (m: string) => `Yo ranbouse ${m} sou mwayen peman ou te itilize a. Li ka pran 5 a 10 jou pou w wè l.`,
    queued: (m: string) => `Yon ranbousman ${m} ap trete. Ranbousman mobile money yo voye alamen, kidonk konte kèk jou ouvrab.`,
    note: 'Se òganizatè a ki fè ranbousman sa a, kidonk tikè a pa ka fè w antre ankò. Si gen yon bagay ki pa bon, ekri nou sou paj Èd la.',
  },
} satisfies Record<EmailLang, unknown>

type CurrencyTotal = { amount: number; currency: string }

function refundEmail(
  lang: EmailLang,
  event: Record<string, any>,
  ticket: Record<string, any>,
  refunded: CurrencyTotal[],
  queued: CurrencyTotal[],
  all: CurrencyTotal[]
): { subject: string; html: string } {
  const t = REFUND_COPY[lang]
  const eventTitle = String(event?.title || '').replace(/[\r\n]+/g, ' ').trim() || t.fallbackTitle
  const posterUrl = String(event?.banner_image_url || '').trim() || null
  const when = formatEventWhen(eventInstantIso(event?.start_datetime), lang, event)
  const fmt = (rows: CurrencyTotal[]) => rows.map((r) => formatMoney(r.amount, r.currency, lang)).join(' + ')
  const total = fmt(all)
  // One currency: the amount is the hero figure. Several: the sentences carry them.
  const single = all.length === 1 ? formatMoney(all[0].amount, all[0].currency, lang) : null
  const caption = refunded.length && queued.length ? t.captionMixed : queued.length ? t.captionQueued : t.captionRefunded
  const html = renderEmail({
    lang,
    title: t.headline(eventTitle),
    preheader: t.preheader(total),
    status: { label: t.status, tone: 'teal' },
    footer: 'attendee',
    blocks: [
      eyebrow(t.eyebrow, 'teal'),
      single
        ? bigFigure(single.slice(0, single.lastIndexOf(' ')), single.slice(single.lastIndexOf(' ') + 1), caption)
        : title(t.headline(eventTitle), 34),
      gap(32),
      eventRow(posterUrl, eventTitle, when?.line),
      gap(28),
      refunded.length ? p(t.refunded(fmt(refunded))) : '',
      queued.length ? p(t.queued(fmt(queued))) : '',
      rowsBlock([{ label: COMMON[lang].reference, value: String(ticket?.id || '').slice(0, 12).toUpperCase(), mono: true }]),
      gap(20),
      p(t.note, C.text3),
    ],
  })
  return { subject: t.subject(eventTitle), html }
}
