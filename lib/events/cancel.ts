import { adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email'
import {
  renderEmail,
  appUrl,
  title,
  eventRow,
  quote,
  paragraphHtml,
  strong,
  p,
  gap,
  rowsBlock,
  button,
} from '@/lib/email-kit/layout'
import { COMMON, formatEventWhen, formatMoney, type EmailLang } from '@/lib/email-kit/i18n'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { eventInstantIso } from '@/lib/email-templates/reminder'
import {
  refundTicket,
  resolveBuyerContact,
  reversePromoterCommission,
  type TicketRefundResult,
} from '@/lib/tickets/refundExecution'
import { notifyAdminsOfQueuedRefunds, notifyAdminsOfRefundReview, type QueuedRefundNotice } from '@/lib/tickets/manualRefundQueue'
import { loadEventAvailability } from '@/lib/payouts/availability-server'
import { eventEndsAt } from '@/lib/payouts/availability'
import { loadRefundCoverageContext, type RefundCoverageContext } from '@/lib/tickets/refundCoverage'
import { eventRefundsRequireAdminApproval, HAITI_MANUAL_APPROVAL } from '@/lib/tickets/refundApprovalPolicy'

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
 *   5. reverse promoter commission on every voided ticket (refundTicket does it
 *      for refunded/queued ones; free and failed-held ones are done here), and
 *      send the admins ONE summary of the mobile-money refunds queued by hand
 *
 * WHO MAY CANCEL (organizerSelfCancelBlock): the organizer, only before any
 * money has been withdrawn for the event and before it has ended; after that,
 * only an admin. An organizer's cancellation also runs the refund COVERAGE GATE
 * (lib/tickets/refundCoverage.ts): what their unwithdrawn balance covers is
 * refunded now, the rest goes to refund_reviews for a Tikèm admin. An admin
 * cancellation refunds every buyer regardless, as before.
 *
 * HAITI (lib/tickets/refundApprovalPolicy.ts): for an event whose country needs
 * Tikèm's approval, NO refund is executed by the sweep, by organizer or admin.
 * Every paid ticket goes to refund_reviews ('haiti_manual_approval') with
 * refund_status 'admin_review': the event is still frozen first (step 1), the
 * door refuses an admin_review ticket (lib/scan/checkInTicket.ts) and the payout
 * engine holds its net as a refund in flight. Free tickets are voided as usual.
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
  /** Organizer cancellation only: refunds the unwithdrawn balance did not cover, held for a Tikèm admin. */
  refundsSentToReview: number
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
    refundsSentToReview: 0,
    freeTicketsVoided: 0,
    alreadyHandled: 0,
    notified: 0,
    failures: [],
    ...(ledgerStampError ? { ledgerStampFailed: ledgerStampError } : {}),
  }

  const refundEvent = {
    id: eventId,
    title: event?.title || null,
    organizer_id: event?.organizer_id || null,
    country: event?.country ?? null,
  }
  // The country gate, decided ONCE for the sweep. A failed read fails closed:
  // every refund waits for an admin rather than moving money unapproved.
  const requiresAdminApproval = await eventRefundsRequireAdminApproval(eventId, refundEvent.country).catch(
    (e: any) => {
      console.error('[cancelEvent] country gate unavailable; sending refunds to review', { eventId, message: e?.message })
      return true
    }
  )
  const queuedForAdmins: QueuedRefundNotice[] = []
  const sentToReview: Array<Extract<TicketRefundResult, { outcome: 'admin_review' }>> = []

  // The coverage gate's context (the whole event's availability facts) is
  // loaded ONCE for the sweep, on first use, instead of once per ticket. Each
  // claim transaction still re-reads the ledger (and the tickets, once anything
  // was withdrawn), so sharing it never makes the gate stale. A failed load is
  // forgotten so the next ticket retries it (that ticket fails closed to review).
  let coverageCtx: Promise<RefundCoverageContext> | null = null
  const sharedCoverageContext = () => {
    if (!coverageCtx) {
      coverageCtx = loadRefundCoverageContext(eventId).catch((e) => {
        coverageCtx = null
        throw e
      })
    }
    return coverageCtx
  }

  for (const doc of ticketsSnap.docs) {
    const res = await refundTicket(doc.id, {
      coverageContext: sharedCoverageContext,
      reason: 'event_cancelled',
      actorId: actor.id,
      event: refundEvent,
      onFailure: 'hold',
      cancellation: true,
      // An organizer's own cancellation may only spend what they still have
      // unwithdrawn; the rest waits for a Tikèm admin (refund_reviews).
      // (A resume of an admin's cancellation keeps the admin's terms.)
      cancellationCoverageGate: !actor.isAdmin && !(alreadyCancelled && event?.cancelled_by_admin === true),
      // One summary email for the whole sweep, sent below.
      notifyAdmins: false,
      requiresAdminApproval,
    })

    let notice: BuyerNotice | null = null
    if (res.outcome === 'refunded') {
      outcome.refundsSucceeded += 1
      notice = { kind: 'refunded', amount: res.amount, currency: res.currency }
    } else if (res.outcome === 'queued') {
      outcome.refundsQueuedManual += 1
      notice = { kind: 'manual', amount: res.amount, currency: res.currency }
      queuedForAdmins.push({
        ticketId: doc.id,
        eventTitle: refundEvent.title,
        amount: res.amount,
        currency: res.currency,
        method: String(res.ticket?.payment_method || 'moncash').toLowerCase(),
        reason: 'event_cancelled',
        needsReview: res.needsReview,
      })
    } else if (res.outcome === 'admin_review') {
      // Not covered by the organizer's unwithdrawn balance: held (it no longer
      // scans, its money cannot be withdrawn) until an admin approves or denies.
      outcome.refundsSentToReview += 1
      sentToReview.push(res)
      notice = { kind: 'pending' }
    } else if (res.outcome === 'failed') {
      outcome.refundsFailed += 1
      outcome.failures.push({ ticketId: doc.id, reason: res.error })
      // The ticket is held void ('hold'), so the sale is dead even though its
      // money is still being chased: no commission on it.
      await reversePromoterCommission(doc.id, 'event_cancelled_refund_failed')
      // A retry that fails again was already announced by the first run.
      if (String(res.ticket?.refund_status || '').toLowerCase() !== 'failed') notice = { kind: 'pending' }
    } else if (res.outcome === 'skipped' && res.reason === 'free') {
      // Free / RSVP / comp — nothing to refund, but the ticket must stop being
      // valid so it can't be scanned at a door that no longer exists.
      try {
        await doc.ref.set(
          { status: 'cancelled', cancelled_at: nowIso, cancellation_reason: 'event_cancelled', updated_at: nowIso },
          { merge: true }
        )
        outcome.freeTicketsVoided += 1
        notice = { kind: 'free' }
        await reversePromoterCommission(doc.id, 'event_cancelled_free')
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

  // 5. One admin email for every refund this sweep queued for a manual payout.
  // Best-effort (never throws); the queue docs are the record.
  if (queuedForAdmins.length > 0) await notifyAdminsOfQueuedRefunds(queuedForAdmins)
  // ...and one for the refunds held for review (the queue lists every one).
  if (sentToReview.length > 0) {
    const first = sentToReview[0]
    await notifyAdminsOfRefundReview({
      ticketId: first.ticketId,
      eventTitle: refundEvent.title,
      amount: first.amount,
      currency: first.currency,
      method: String(first.ticket?.payment_method || 'unknown').toLowerCase(),
      reason: `${
        sentToReview.some((r) => r.reviewReason === HAITI_MANUAL_APPROVAL)
          ? `event_cancelled (${HAITI_MANUAL_APPROVAL})`
          : 'event_cancelled_by_organizer'
      } (${sentToReview.length} ticket${sentToReview.length === 1 ? '' : 's'} held for review)`,
      eventCurrency: first.coverage?.currency ?? null,
      shortfallMinor: first.coverage?.shortfallMinor ?? null,
      coverageMinor: first.coverage?.coverageMinor ?? null,
      reviewReason: first.reviewReason,
    })
  }

  return outcome
}

export type SelfCancelBlock = { status: number; code: string; error: string }

/**
 * May the event's ORGANIZER cancel it themselves? Only before any money has been
 * withdrawn for it and before it has ended (the effective end: the later of the
 * editable end_datetime and what the server-stamped tickets say). Otherwise an
 * admin must: a self-cancel after a payout used to refund buyers out of Tikèm's
 * own funds. Fails closed when the balance cannot be computed.
 */
export async function organizerSelfCancelBlock(
  eventId: string,
  event: Record<string, any>,
  now: Date = new Date()
): Promise<SelfCancelBlock | null> {
  let availability: Awaited<ReturnType<typeof loadEventAvailability>> = null
  try {
    availability = await loadEventAvailability({ eventId, eventData: event, now })
  } catch (e: any) {
    console.error('[cancelEvent] availability failed; refusing organizer self-cancel', { eventId, message: e?.message })
    return {
      status: 503,
      code: 'cancel_balance_unavailable',
      error: 'We could not check this event’s payouts right now. Please try again, or contact support.',
    }
  }
  if (availability && availability.withdrawnMinor > 0) {
    return {
      status: 403,
      code: 'cancel_after_withdrawal',
      error: 'Money has already been withdrawn for this event, so only Tikèm support can cancel it. Please contact support.',
    }
  }
  const endIso = availability?.effectiveEndsAt || eventEndsAt(event)?.toISOString() || null
  const ends = endIso ? Date.parse(endIso) : NaN
  if (!isNaN(ends) && now.getTime() >= ends) {
    return {
      status: 403,
      code: 'cancel_after_event_end',
      error: 'This event has already ended, so only Tikèm support can cancel it. Please contact support.',
    }
  }
  return null
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
      const lang = await resolveEmailLang({ userId: uid, email, event })
      const message = cancellationEmail({ lang, event, reason, notice })
      await sendEmail({ to: email, subject: message.subject, html: message.html })
    }
    return true
  } catch (e) {
    console.error('[cancelEvent] notify failed', res.ticketId, e)
    return false
  }
}

const CANCEL_COPY = {
  en: {
    fallbackTitle: 'your event',
    subject: (e: string) => `Cancelled: ${e}`,
    status: 'Cancelled',
    headline: (e: string) => `${e} was cancelled`,
    preheader: (e: string) => `${e} was cancelled. Here is what happens to your ticket.`,
    reason: 'Reason from the organizer',
    refunded: (m: string) => `Your ticket is cancelled and ${m} has been refunded to your original payment method. It can take 5 to 10 days to appear.`,
    manual: (m: string) => `Your ticket is cancelled and a refund of ${m} is being processed. Mobile-money refunds are sent by hand, so allow a few business days.`,
    pending: "Your ticket is cancelled and your refund is being processed. We'll be in touch if we need anything from you.",
    free: 'Your free registration has been cancelled. Nothing was charged.',
    refund: 'Refund',
    wrong: 'If anything looks wrong, write to us from the Help page and we will sort it out.',
  },
  fr: {
    fallbackTitle: 'votre événement',
    subject: (e: string) => `Annulé : ${e}`,
    status: 'Annulé',
    headline: (e: string) => `${e} est annulé`,
    preheader: (e: string) => `${e} est annulé. Voici ce qu'il advient de votre billet.`,
    reason: "Motif donné par l'organisateur",
    refunded: (m: string) => `Votre billet est annulé et ${m} vous ont été remboursés sur votre moyen de paiement initial. Comptez 5 à 10 jours pour les voir apparaître.`,
    manual: (m: string) => `Votre billet est annulé et un remboursement de ${m} est en cours. Les remboursements mobile money sont envoyés manuellement : comptez quelques jours ouvrés.`,
    pending: 'Votre billet est annulé et votre remboursement est en cours. Nous vous contacterons si nous avons besoin de quoi que ce soit.',
    free: "Votre inscription gratuite est annulée. Rien ne vous a été facturé.",
    refund: 'Remboursement',
    wrong: "Si quelque chose ne va pas, écrivez-nous depuis la page Aide, on s'en occupe.",
  },
  ht: {
    fallbackTitle: 'evènman ou an',
    subject: (e: string) => `Anile: ${e}`,
    status: 'Anile',
    headline: (e: string) => `Yo anile ${e}`,
    preheader: (e: string) => `Yo anile ${e}. Men sa k ap pase ak tikè ou.`,
    reason: 'Rezon òganizatè a bay',
    refunded: (m: string) => `Tikè ou anile, epi yo ranbouse ${m} sou mwayen peman ou te itilize a. Li ka pran 5 a 10 jou pou w wè l.`,
    manual: (m: string) => `Tikè ou anile, epi yon ranbousman ${m} ap trete. Ranbousman mobile money yo voye alamen, kidonk konte kèk jou ouvrab.`,
    pending: 'Tikè ou anile, epi ranbousman ou ap trete. N ap kontakte w si nou bezwen kèk lòt bagay.',
    free: 'Enskripsyon gratis ou an anile. Ou pa t peye anyen.',
    refund: 'Ranbousman',
    wrong: 'Si gen yon bagay ki pa bon, ekri nou sou paj Èd la, n ap regle sa.',
  },
} satisfies Record<EmailLang, unknown>

function cancellationEmail({
  lang,
  event,
  reason,
  notice,
}: {
  lang: EmailLang
  event: Record<string, any>
  reason: string | null
  notice: BuyerNotice
}): { subject: string; html: string } {
  const t = CANCEL_COPY[lang]
  const eventTitle = String(event?.title || '').replace(/[\r\n]+/g, ' ').trim() || t.fallbackTitle
  const posterUrl = String(event?.banner_image_url || '').trim() || null
  const when = formatEventWhen(eventInstantIso(event?.start_datetime), lang, event)
  const sub = [when?.line, [event?.venue_name, event?.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
  const money =
    notice.kind === 'refunded' || notice.kind === 'manual' ? formatMoney(notice.amount, notice.currency, lang) : null
  // The amount is bolded inside the sentence; every piece around it is escaped.
  const MARK = '\u0000'
  const sentence =
    notice.kind === 'refunded'
      ? t.refunded(MARK)
      : notice.kind === 'manual'
        ? t.manual(MARK)
        : notice.kind === 'pending'
          ? t.pending
          : t.free
  const bodyHtml = sentence
    .split(MARK)
    .map((part) => escapeHtml(part))
    .join(money ? strong(money) : '')
  const html = renderEmail({
    lang,
    title: t.headline(eventTitle),
    preheader: t.preheader(eventTitle),
    status: { label: t.status, tone: 'red' },
    footer: 'attendee',
    blocks: [
      eventRow(posterUrl, eventTitle, sub),
      gap(28),
      title(t.headline(eventTitle), 34),
      gap(16),
      reason ? quote(t.reason, reason) : '',
      reason ? gap(20) : '',
      paragraphHtml(bodyHtml),
      money ? gap(4) : '',
      money ? rowsBlock([{ label: t.refund, value: money, strong: true }]) : '',
      gap(24),
      p(t.wrong),
      gap(4),
      button(COMMON[lang].findEvents, `${appUrl()}/discover`, 'secondary'),
    ],
  })
  return { subject: t.subject(eventTitle), html }
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}
