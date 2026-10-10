/**
 * Chargebacks (Stripe disputes) — recording, attribution and notification.
 *
 * WHY THIS EXISTS
 * ---------------
 * Tikèm is the MERCHANT OF RECORD on the Stripe rail: ticket sales in US/CA/FR are
 * destination charges and `on_behalf_of` is never set, so a cardholder's chargeback
 * lands on the PLATFORM. Stripe debits our balance immediately, we are the party
 * Stripe expects to answer the network, and the organizer whose show was disputed
 * may already have been paid out.
 *
 * Before this module nothing stored a dispute at all. /api/cron/release-payouts had
 * to ask Stripe live, every hour, whether an event had an open dispute — and when a
 * dispute opened, nobody was told: not the organizer who has the evidence (a scan
 * log, a door list, a signed contract) and not an admin, even though the evidence
 * deadline is a hard one and a missed deadline is an automatic loss.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * No clawback: nothing here reverses a transfer. The one protective step it takes
 * is on a NEW open dispute: it freezes that event's payouts (events/{id}.payouts_frozen,
 * which withdrawals, the release cron and new sales all honour) and flags the
 * organizer (organizers/{id}.payoutRelease.highRisk, every later release goes to
 * review), once per dispute. Lifting either is an admin decision.
 */

import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { sendEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/html'
import {
  renderEmail,
  title,
  p,
  paragraphHtml,
  strong,
  gap,
  button,
  bigFigure,
  rowsBlock,
  quote,
  lines,
  serifHeading,
  appUrl,
  C,
  FONT,
} from '@/lib/email-kit/layout'
import { formatMoney, pickLang, type EmailLang } from '@/lib/email-kit/i18n'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import { createNotification } from '@/lib/notifications/helpers'
import { getAdminEmails } from '@/lib/admin'
import type { NotificationType } from '@/types/database'

export const DISPUTES_COLLECTION = 'disputes'

/**
 * Stripe dispute statuses that still represent money at risk.
 *
 * Kept in step with OPEN_DISPUTE_STATUSES in /api/cron/release-payouts (that file
 * belongs to the payout pipeline, so the set is restated here rather than shared).
 */
const OPEN_DISPUTE_STATUSES = new Set([
  'warning_needs_response',
  'warning_under_review',
  'needs_response',
  'under_review',
])

/** Ticket fields that can carry the Stripe payment reference. */
const TICKET_PAYMENT_FIELDS = ['payment_id', 'payment_intent_id'] as const

/** Tickets read per payment reference. One order is a handful of tickets. */
const MAX_TICKET_MATCHES = 50

/** Event-history entries kept on a dispute doc. */
const MAX_HISTORY_ENTRIES = 25

/**
 * The in-app notification type for a chargeback. The notification UI switches on
 * the type string with a generic-bell default, so it renders without a dedicated
 * icon case.
 */
const DISPUTE_NOTIFICATION_TYPE: NotificationType = 'payment_dispute'

// ── Types ───────────────────────────────────────────────────────────────────

export type DisputeOutcome = 'open' | 'won' | 'lost' | 'inquiry_closed' | 'refunded' | 'unknown'

export type DisputeAttribution = {
  /** True only when a ticket was actually matched. Never a guess. */
  attributed: boolean
  /** Why we could not attribute — null when we could. */
  unattributedReason: string | null
  /**
   * True when a Firestore ticket query FAILED. A failed lookup is not evidence of
   * "no such ticket", and an admin reading an unattributed dispute needs to know
   * which of the two they are looking at.
   */
  lookupFailed: boolean
  ticketId: string | null
  ticketIds: string[]
  eventId: string | null
  eventTitle: string | null
  organizerId: string | null
  organizerName: string | null
  organizerEmail: string | null
  attendeeName: string | null
  /** Which ticket field the payment reference matched on. */
  matchedField: string | null
  /** Which Stripe id matched (charge id or payment_intent id). */
  matchedRef: string | null
  /** Set when one payment reference somehow spans more than one event. */
  multipleEvents: boolean
}

export type DisputeRecord = {
  disputeId: string
  status: string
  outcome: DisputeOutcome
  reason: string | null
  amountMinor: number
  currency: string
  chargeId: string | null
  paymentIntentId: string | null
  evidenceDueBy: string | null
  attribution: DisputeAttribution
}

export type HandleDisputeResult = {
  disputeId: string
  status: string
  outcome: DisputeOutcome
  /** First time we have ever seen this dispute. */
  isNew: boolean
  /** The event was older than what the doc already knew; mutable state untouched. */
  stale: boolean
  attributed: boolean
  /** A loss was counted into the organizer's risk history on THIS delivery. */
  lossRecorded: boolean
  organizerNotified: boolean
  organizerEmailed: boolean
  adminEmailed: boolean
}

// ── Small helpers ───────────────────────────────────────────────────────────

function idOf(value: any): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value?.id === 'string') return value.id
  return null
}

function unixToIso(seconds: unknown): string | null {
  const n = Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return null
  const date = new Date(n * 1000)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toMinor(value: unknown): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/** Firestore map keys must be safe; a currency code is A–Z only. */
function currencyKey(currency: string): string {
  const safe = String(currency || '').toUpperCase().replace(/[^A-Z]/g, '')
  return safe || 'UNKNOWN'
}

export function isOpenDisputeStatus(status: string): boolean {
  return OPEN_DISPUTE_STATUSES.has(String(status || ''))
}

export function disputeOutcome(status: string): DisputeOutcome {
  const s = String(status || '')
  if (s === 'lost') return 'lost'
  if (s === 'won') return 'won'
  if (s === 'warning_closed') return 'inquiry_closed'
  if (s === 'charge_refunded') return 'refunded'
  if (OPEN_DISPUTE_STATUSES.has(s)) return 'open'
  return 'unknown'
}

/** Stripe's reason codes, in words an organizer can act on. */
const REASON_LABELS: Record<string, string> = {
  bank_cannot_process: 'the cardholder’s bank could not process the payment',
  check_returned: 'the cardholder’s cheque was returned',
  credit_not_processed: 'the cardholder says a refund they were promised was never issued',
  customer_initiated: 'the cardholder contacted their bank directly',
  debit_not_authorized: 'the cardholder says they never authorised the charge',
  duplicate: 'the cardholder says they were charged twice for the same ticket',
  fraudulent: 'the cardholder says they did not recognise or authorise this charge',
  general: 'the cardholder disputed the charge without giving a specific reason',
  incorrect_account_details: 'the account details on the payment were wrong',
  insufficient_funds: 'the cardholder had insufficient funds',
  product_not_received: 'the cardholder says they never received their ticket',
  product_unacceptable: 'the cardholder says the event was not as described',
  subscription_canceled: 'the cardholder says the payment was cancelled',
  unrecognized: 'the cardholder did not recognise the charge on their statement',
}

export function describeDisputeReason(reason: string | null): string {
  const key = String(reason || '').toLowerCase()
  return REASON_LABELS[key] || key.replace(/_/g, ' ') || 'no reason given'
}

function formatMinor(amountMinor: number, currency: string): string {
  const code = currencyKey(currency)
  const major = (Number(amountMinor) || 0) / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(major)
  } catch {
    return `${major.toFixed(2)} ${code}`
  }
}

function emptyAttribution(reason: string, lookupFailed = false): DisputeAttribution {
  return {
    attributed: false,
    unattributedReason: reason,
    lookupFailed,
    ticketId: null,
    ticketIds: [],
    eventId: null,
    eventTitle: null,
    organizerId: null,
    organizerName: null,
    organizerEmail: null,
    attendeeName: null,
    matchedField: null,
    matchedRef: null,
    multipleEvents: false,
  }
}

// ── Attribution ─────────────────────────────────────────────────────────────

/**
 * Work out WHOSE sale was disputed.
 *
 * Every Stripe ticket is stamped with the PaymentIntent id at issuance
 * (`payment_id` in both the Supabase row and the Firestore mirror; some older
 * paths used `payment_intent_id`), which is the same reference
 * /api/cron/release-payouts matches disputes against today. We query both fields
 * for both of the dispute's payment references, then walk ticket → event →
 * organizer.
 *
 * FAILURE MODE, stated plainly: a dispute we cannot match is recorded as
 * UNATTRIBUTED, never guessed onto the nearest event. That happens when
 *   - the Firestore ticket mirror was never written (the webhook logs and
 *     continues when the mirror fails, so the Supabase row can exist alone),
 *   - the dispute object carried no charge and no payment_intent,
 *   - the charge was not a ticket sale at all, or
 *   - the ticket query itself errored (`lookupFailed`) — which is NOT the same as
 *     "no such ticket" and is flagged separately so nobody reads a Firestore
 *     outage as an unattributable chargeback.
 * An unattributed dispute still gets stored and still emails the admins, because
 * the money has still left and a human has to go and find the order by hand.
 */
export async function attributeDispute(params: {
  chargeId: string | null
  paymentIntentId: string | null
}): Promise<DisputeAttribution> {
  const refs = Array.from(
    new Set([params.chargeId, params.paymentIntentId].filter((v): v is string => Boolean(v)))
  )

  if (refs.length === 0) {
    return emptyAttribution('dispute_had_no_charge_or_payment_intent')
  }

  // Firestore cannot OR across fields, so this is one equality query per field.
  // Both are single-field `in` filters, so no composite index is required.
  const results = await Promise.all(
    TICKET_PAYMENT_FIELDS.map(async (field) => {
      try {
        const snap = await adminDb
          .collection('tickets')
          .where(field, 'in', refs)
          .limit(MAX_TICKET_MATCHES)
          .get()
        return { field, snap, failed: false as const }
      } catch (error: any) {
        console.error('[disputes] ticket lookup failed', {
          field,
          refs,
          message: error?.message,
        })
        return { field, snap: null, failed: true as const }
      }
    })
  )

  const lookupFailed = results.some((r) => r.failed)

  type Match = { id: string; field: string; ref: string; data: any; purchasedAt: string }
  const matches = new Map<string, Match>()

  for (const result of results) {
    for (const doc of (result.snap?.docs || []) as any[]) {
      if (matches.has(doc.id)) continue
      const data = (doc.data() || {}) as any
      const ref = String(data[result.field] || '')
      matches.set(doc.id, {
        id: doc.id,
        field: result.field,
        ref,
        data,
        purchasedAt: String(data.purchased_at || data.created_at || ''),
      })
    }
  }

  if (matches.size === 0) {
    return emptyAttribution(
      lookupFailed ? 'ticket_lookup_failed' : 'no_ticket_matched_charge_or_payment_intent',
      lookupFailed
    )
  }

  // Deterministic primary ticket: oldest issued in the order.
  const ordered = Array.from(matches.values()).sort((a, b) =>
    a.purchasedAt.localeCompare(b.purchasedAt) || a.id.localeCompare(b.id)
  )
  const primary = ordered[0]

  const eventIds = Array.from(
    new Set(ordered.map((m) => String(m.data.event_id || m.data.eventId || '')).filter(Boolean))
  )
  const eventId = String(primary.data.event_id || primary.data.eventId || '') || eventIds[0] || null

  const attribution: DisputeAttribution = {
    attributed: true,
    unattributedReason: null,
    lookupFailed,
    ticketId: primary.id,
    ticketIds: ordered.map((m) => m.id),
    eventId,
    eventTitle: null,
    organizerId: null,
    organizerName: null,
    organizerEmail: null,
    attendeeName: primary.data.attendee_name ? String(primary.data.attendee_name) : null,
    matchedField: primary.field,
    matchedRef: primary.ref || null,
    multipleEvents: eventIds.length > 1,
  }

  if (!eventId) {
    // A matched ticket with no event id is attributed to a payment but not to a
    // show — say so rather than inventing one.
    attribution.attributed = false
    attribution.unattributedReason = 'matched_ticket_has_no_event_id'
    return attribution
  }

  try {
    const eventSnap = await adminDb.collection('events').doc(eventId).get()
    const eventData = eventSnap.exists ? ((eventSnap.data() as any) || {}) : {}
    attribution.eventTitle = eventData.title ? String(eventData.title) : null
    const organizerId = String(eventData.organizer_id || eventData.organizerId || '')
    attribution.organizerId = organizerId || null

    if (organizerId) {
      const userSnap = await adminDb.collection('users').doc(organizerId).get()
      const userData = userSnap.exists ? ((userSnap.data() as any) || {}) : {}
      attribution.organizerName = userData.full_name ? String(userData.full_name) : null
      attribution.organizerEmail = userData.email ? String(userData.email) : null
    }
  } catch (error: any) {
    // The ticket match still stands; only the decoration failed.
    console.error('[disputes] failed to decorate attribution', {
      eventId,
      message: error?.message,
    })
  }

  // Attendee name falls back to the buyer's account when the ticket carries none.
  if (!attribution.attendeeName) {
    const attendeeId = String(primary.data.attendee_id || '')
    if (attendeeId && !attendeeId.startsWith('guest_')) {
      try {
        const snap = await adminDb.collection('users').doc(attendeeId).get()
        const data = snap.exists ? ((snap.data() as any) || {}) : {}
        attribution.attendeeName = data.full_name ? String(data.full_name) : null
      } catch {
        // Best effort — a missing name never blocks recording a dispute.
      }
    }
  }

  return attribution
}

// ── Persistence ─────────────────────────────────────────────────────────────

type RecordOutcome = {
  isNew: boolean
  stale: boolean
  shouldNotifyOrganizer: boolean
  shouldEmailAdmins: boolean
  lossRecorded: boolean
  record: DisputeRecord
}

/**
 * Upsert `disputes/{stripeDisputeId}` and, when a dispute closes as LOST, add it
 * to the organizer's risk history.
 *
 * Runs as ONE transaction so concurrent deliveries of different dispute events
 * cannot both claim the notification or both count the same loss.
 *
 * Stripe does not guarantee event ORDER. A `charge.dispute.updated` sent before a
 * `charge.dispute.closed` can arrive after it, so mutable state (status, amount,
 * evidence deadline) is only written when the delivered event is at least as new
 * as the newest one this doc has already seen. Stale deliveries are still recorded
 * in the history so the audit trail stays complete.
 */
async function upsertDispute(params: {
  dispute: any
  eventType: string
  stripeEventId: string
  stripeEventCreated: number
  paymentIntentId: string | null
  attribution: DisputeAttribution
}): Promise<RecordOutcome> {
  const { dispute, eventType, stripeEventId, stripeEventCreated, attribution } = params

  const disputeId = String(dispute?.id || '')
  const status = String(dispute?.status || '')
  const outcome = disputeOutcome(status)
  const amountMinor = Math.max(0, toMinor(dispute?.amount))
  const currency = currencyKey(String(dispute?.currency || 'usd'))
  const chargeId = idOf(dispute?.charge)
  const paymentIntentId = params.paymentIntentId || idOf(dispute?.payment_intent)
  const evidence = (dispute?.evidence_details || {}) as any
  const evidenceDueBy = unixToIso(evidence?.due_by)
  const nowIso = new Date().toISOString()

  const ref = adminDb.collection(DISPUTES_COLLECTION).doc(disputeId)

  const result = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    const existing = snap.exists ? ((snap.data() as any) || {}) : null
    const isNew = !snap.exists

    const knownCreated = Number(existing?.lastEventCreated || 0)
    const stale = !isNew && Number.isFinite(knownCreated) && stripeEventCreated < knownCreated

    /**
     * The webhook's event-id claim already stops redeliveries reaching us, but that
     * claim FAILS OPEN when Firestore is unavailable — so the history is deduped on
     * the Stripe event id too rather than growing a duplicate entry per retry.
     */
    const seen: string[] = Array.isArray(existing?.seenEventIds) ? existing.seenEventIds : []
    const history = Array.isArray(existing?.history) ? existing.history.slice() : []
    if (!seen.includes(stripeEventId)) {
      history.push({
        stripeEventId,
        type: eventType,
        status,
        at: nowIso,
        eventCreated: stripeEventCreated,
      })
    }

    // An attribution is only overwritten by a BETTER one. A later delivery whose
    // ticket lookup came back empty must not erase the ticket we already found.
    const existingAttribution = (existing?.attribution || null) as DisputeAttribution | null
    const attributionToWrite =
      attribution.attributed || !existingAttribution?.attributed ? attribution : existingAttribution

    const doc: Record<string, any> = {
      disputeId,
      provider: 'stripe',
      chargeId: chargeId || existing?.chargeId || null,
      paymentIntentId: paymentIntentId || existing?.paymentIntentId || null,
      attribution: attributionToWrite,
      // Denormalised so the admin list can filter without reading a nested map.
      eventId: attributionToWrite?.eventId || null,
      organizerId: attributionToWrite?.organizerId || null,
      attributed: Boolean(attributionToWrite?.attributed),
      history: history.slice(-MAX_HISTORY_ENTRIES),
      seenEventIds: FieldValue.arrayUnion(stripeEventId),
      lastEventId: stripeEventId,
      lastEventType: eventType,
      updatedAt: nowIso,
    }

    if (isNew) {
      doc.firstSeenAt = nowIso
      doc.stripeCreatedAt = unixToIso(dispute?.created)
    }

    if (!stale) {
      doc.status = status
      doc.outcome = outcome
      doc.isOpen = isOpenDisputeStatus(status)
      doc.reason = dispute?.reason ? String(dispute.reason) : null
      doc.networkReasonCode = dispute?.network_reason_code
        ? String(dispute.network_reason_code)
        : null
      doc.amountMinor = amountMinor
      doc.currency = currency
      doc.isChargeRefundable = dispute?.is_charge_refundable === true
      doc.evidenceDueBy = evidenceDueBy
      doc.evidenceSubmitted = evidence?.has_evidence === true
      doc.evidencePastDue = evidence?.past_due === true
      doc.evidenceSubmissionCount = Math.max(0, toMinor(evidence?.submission_count))
      doc.lastEventCreated = stripeEventCreated
      if (outcome !== 'open' && !existing?.closedAt) doc.closedAt = nowIso
    }

    /**
     * `funds_withdrawn` / `funds_reinstated` are the only events that say whether
     * the money has actually LEFT our balance yet — the status alone does not.
     * They are facts about a moment, so they are stamped once and never revised,
     * and they are recorded regardless of ordering.
     */
    if (eventType === 'charge.dispute.funds_withdrawn' && !existing?.fundsWithdrawnAt) {
      doc.fundsWithdrawnAt = unixToIso(stripeEventCreated) || nowIso
    }
    if (eventType === 'charge.dispute.funds_reinstated' && !existing?.fundsReinstatedAt) {
      doc.fundsReinstatedAt = unixToIso(stripeEventCreated) || nowIso
    }

    /**
     * Notify the organizer once, while the dispute is still answerable.
     *
     * Claimed inside the transaction so two concurrent deliveries cannot both
     * send. `charge.dispute.created` is the normal trigger, but an `updated` on a
     * still-open dispute we somehow never notified about also qualifies — a
     * dropped `created` must not cost an organizer their deadline.
     */
    const alreadyHandled = Boolean(existing?.organizerNotifiedAt || existing?.notifyClaimedAt)
    const shouldNotifyOrganizer =
      !stale &&
      !alreadyHandled &&
      isOpenDisputeStatus(status) &&
      Boolean(attributionToWrite?.organizerId)
    if (shouldNotifyOrganizer) doc.notifyClaimedAt = nowIso

    // Admins hear about every newly-seen dispute, attributed or not.
    const shouldEmailAdmins = isNew && !existing?.adminNotifiedAt
    if (shouldEmailAdmins) doc.adminNotifiedAt = nowIso

    /**
     * A LOST dispute is permanent history for the organizer. Counted exactly once
     * per dispute (`lossCounted`) so the `updated`-then-`closed` pair Stripe sends
     * for the same loss cannot double-count it.
     *
     * This writes a RECORD only and reverses nothing: what a loss should cost an
     * organizer is decided in lib/payouts/**, which reads this. (The OPENING of a
     * dispute is what freezes the event and flags the organizer, below.)
     */
    const organizerId = attributionToWrite?.organizerId || null
    const lossRecorded = !stale && outcome === 'lost' && !existing?.lossCounted
    if (lossRecorded) {
      doc.lossCounted = true
      doc.lostAt = nowIso
    }

    // ONE write to the organizer doc, never two: a dispute first seen already lost
    // (a missed `created` delivery) would otherwise touch the same document twice
    // in a single transaction.
    const risk: Record<string, any> = {}
    if (isNew) {
      // Lifetime dispute count, so risk history shows disputes OPENED as well as lost.
      risk.openedCount = FieldValue.increment(1)
      risk.lastDisputeAt = nowIso
      risk.lastDisputeId = disputeId
    }
    if (lossRecorded) {
      risk.lostCount = FieldValue.increment(1)
      risk.lostAmountMinorByCurrency = { [currency]: FieldValue.increment(amountMinor) }
      risk.lastLostAt = nowIso
      risk.lastLostDisputeId = disputeId
      risk.lastLostEventId = attributionToWrite?.eventId || null
    }
    /**
     * A NEW open dispute freezes the event's payouts and flags the organizer, once
     * per dispute (`payoutsFrozenAt`), so an admin who lifts the freeze is not
     * overridden by a later `updated` delivery. Until an admin looks:
     *   - events/{id}.payouts_frozen stops withdrawals (lib/payouts/availability),
     *     the Stripe release cron (/api/cron/release-payouts) and new sales
     *     (lib/tickets/purchasable);
     *   - organizers/{id}.payoutRelease.highRisk sends every later release to review.
     * Transfers already made are NOT reversed here; that stays an admin decision.
     */
    const eventIdToFreeze = attributionToWrite?.eventId || null
    const freezeNow =
      !stale &&
      !existing?.payoutsFrozenAt &&
      isOpenDisputeStatus(status) &&
      (eventType === 'charge.dispute.created' || isNew)
    if (freezeNow && (eventIdToFreeze || organizerId)) {
      doc.payoutsFrozenAt = nowIso
    }
    // Read before any write in this transaction; never create a ghost event doc.
    const eventToFreezeExists =
      freezeNow && eventIdToFreeze
        ? Boolean((await tx.get(adminDb.collection('events').doc(eventIdToFreeze)))?.exists)
        : false
    if (freezeNow && eventIdToFreeze && eventToFreezeExists) {
      tx.set(
        adminDb.collection('events').doc(eventIdToFreeze),
        {
          payouts_frozen: true,
          payouts_frozen_reason: 'stripe_dispute',
          payouts_frozen_at: nowIso,
          payouts_frozen_dispute_id: disputeId,
        },
        { merge: true }
      )
    }

    // ONE organizer write (risk history + the dispute flag).
    const organizerPatch: Record<string, any> = {}
    if (Object.keys(risk).length > 0) organizerPatch.disputeRisk = { ...risk, updatedAt: nowIso }
    if (freezeNow) {
      organizerPatch.payoutRelease = {
        highRisk: true,
        highRiskReason: 'stripe_dispute',
        highRiskDisputeId: disputeId,
        highRiskSetAt: nowIso,
      }
    }
    if (organizerId && Object.keys(organizerPatch).length > 0) {
      tx.set(adminDb.collection('organizers').doc(organizerId), organizerPatch, { merge: true })
    }

    tx.set(ref, doc, { merge: true })

    return {
      isNew,
      stale,
      shouldNotifyOrganizer,
      shouldEmailAdmins,
      lossRecorded: lossRecorded && Boolean(organizerId),
      record: {
        disputeId,
        status: stale ? String(existing?.status || status) : status,
        outcome: stale ? disputeOutcome(String(existing?.status || status)) : outcome,
        reason: dispute?.reason ? String(dispute.reason) : null,
        amountMinor,
        currency,
        chargeId: chargeId || null,
        paymentIntentId: paymentIntentId || null,
        evidenceDueBy,
        attribution: attributionToWrite as DisputeAttribution,
      },
    } as RecordOutcome
  })

  return result
}

// ── Email ───────────────────────────────────────────────────────────────────

/** Stripe's reason codes in French and Kreyòl (English lives in REASON_LABELS). */
const REASON_LABELS_I18N: Record<'fr' | 'ht', Record<string, string>> = {
  fr: {
    bank_cannot_process: "la banque du titulaire n'a pas pu traiter le paiement",
    check_returned: 'le chèque du titulaire a été rejeté',
    credit_not_processed: "le titulaire dit qu'un remboursement promis n'a jamais été versé",
    customer_initiated: 'le titulaire a contacté directement sa banque',
    debit_not_authorized: "le titulaire dit n'avoir jamais autorisé ce débit",
    duplicate: 'le titulaire dit avoir été débité deux fois pour le même billet',
    fraudulent: "le titulaire dit ne pas reconnaître ce paiement ni l'avoir autorisé",
    general: 'le titulaire a contesté le paiement sans donner de motif précis',
    incorrect_account_details: 'les coordonnées du compte utilisées pour le paiement étaient erronées',
    insufficient_funds: "le titulaire n'avait pas assez de fonds",
    product_not_received: "le titulaire dit n'avoir jamais reçu son billet",
    product_unacceptable: "le titulaire dit que l'événement ne correspondait pas à la description",
    subscription_canceled: 'le titulaire dit que le paiement avait été annulé',
    unrecognized: 'le titulaire ne reconnaît pas ce paiement sur son relevé',
  },
  ht: {
    bank_cannot_process: 'bank moun ki gen kat la pa t ka trete peman an',
    check_returned: 'chèk moun ki gen kat la te retounen',
    credit_not_processed: 'moun ki gen kat la di yo te pwomèt li yon ranbousman li pa janm resevwa',
    customer_initiated: 'moun ki gen kat la rele bank li dirèkteman',
    debit_not_authorized: 'moun ki gen kat la di li pa t janm otorize peman sa a',
    duplicate: 'moun ki gen kat la di yo fè l peye de fwa pou menm tikè a',
    fraudulent: 'moun ki gen kat la di li pa rekonèt ni otorize peman sa a',
    general: 'moun ki gen kat la konteste peman an san li pa bay yon rezon presi',
    incorrect_account_details: 'enfòmasyon kont ki te sou peman an pa t bon',
    insufficient_funds: 'moun ki gen kat la pa t gen ase kòb',
    product_not_received: 'moun ki gen kat la di li pa janm resevwa tikè li',
    product_unacceptable: 'moun ki gen kat la di evènman an pa t jan yo te dekri l la',
    subscription_canceled: 'moun ki gen kat la di peman an te anile',
    unrecognized: 'moun ki gen kat la pa rekonèt peman sa a sou relve li',
  },
}

function describeDisputeReasonIn(reason: string | null, lang: EmailLang): string {
  const key = String(reason || '').toLowerCase()
  if (lang !== 'en') {
    const label = REASON_LABELS_I18N[lang][key]
    if (label) return label
    if (!key) return lang === 'fr' ? 'aucun motif donné' : 'okenn rezon pa bay'
    return key.replace(/_/g, ' ')
  }
  return describeDisputeReason(reason)
}

const capitalize = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v)

const DISPUTE_COPY: Record<
  EmailLang,
  {
    subject: (amount: string, event: string) => string
    yourEvent: string
    status: string
    head: string
    hello: (name: string | null) => string
    body: (amount: string, event: string) => string
    forEvent: (event: string) => string
    reason: string
    buyer: string
    ticket: string
    reference: string
    deadlineHead: string
    deadlineBody: string
    helpsHead: string
    helps: string[]
    merchant: string
    cta: string
  }
> = {
  en: {
    subject: (a, e) => `Action needed: a buyer disputed a ${a} payment for "${e}"`,
    yourEvent: 'your event',
    status: 'Action needed',
    head: 'A buyer disputed their payment',
    hello: (n) => (n ? `Hi ${n},` : 'Hi,'),
    body: (a, e) =>
      `A buyer asked their bank to reverse a ${a} ticket payment for ${e}. The bank has taken the money back while it investigates, and it gave us a deadline to answer with evidence.`,
    forEvent: (e) => `For ${e}`,
    reason: 'Stated reason',
    buyer: 'Buyer',
    ticket: 'Ticket',
    reference: 'Reference',
    deadlineHead: 'evidence deadline',
    deadlineBody:
      'Send us what you have before this date. If the deadline passes with no response, the bank decides for the cardholder automatically and the money is gone.',
    helpsHead: 'what helps us win this',
    helps: [
      'Proof the buyer showed up, such as a scan record or a signed door list',
      'Anything they sent you: messages, a name at the door, a transfer',
      'Your event page, terms and refund policy as the buyer saw them',
      'If this looks like a genuine mistake, tell us. A refund now costs less than a lost dispute',
    ],
    merchant:
      'Tikèm is the merchant of record for this sale, so we file the response to the bank. You cannot answer it directly in Stripe. Reply to this email or contact support with your evidence and we will submit it for you.',
    cta: 'Send evidence to support',
  },
  fr: {
    subject: (a, e) => `Action requise : un acheteur conteste un paiement de ${a} pour « ${e} »`,
    yourEvent: 'votre événement',
    status: 'Action requise',
    head: 'Un acheteur conteste son paiement',
    hello: (n) => (n ? `Bonjour ${n},` : 'Bonjour,'),
    body: (a, e) =>
      `Un acheteur a demandé à sa banque d'annuler un paiement de billet de ${a} pour ${e}. La banque a repris l'argent le temps de son enquête et nous a fixé une date limite pour répondre avec des preuves.`,
    forEvent: (e) => `Pour ${e}`,
    reason: 'Motif indiqué',
    buyer: 'Acheteur',
    ticket: 'Billet',
    reference: 'Référence',
    deadlineHead: 'date limite des preuves',
    deadlineBody:
      "Envoyez-nous ce que vous avez avant cette date. Sans réponse à temps, la banque tranche automatiquement en faveur du titulaire de la carte et l'argent est perdu.",
    helpsHead: 'ce qui nous aide à gagner',
    helps: [
      "Une preuve que l'acheteur est venu : un scan du billet ou une liste d'entrée signée",
      "Tout ce qu'il vous a envoyé : messages, nom donné à l'entrée, transfert",
      "Votre page d'événement, vos conditions et votre politique de remboursement telles que l'acheteur les a vues",
      "Si cela ressemble à une vraie erreur, dites-le-nous. Un remboursement maintenant coûte moins cher qu'un litige perdu",
    ],
    merchant:
      "Tikèm est le marchand officiel de cette vente : c'est nous qui répondons à la banque. Vous ne pouvez pas répondre directement dans Stripe. Répondez à cet e-mail ou contactez le support avec vos preuves et nous les transmettrons pour vous.",
    cta: 'Envoyer des preuves au support',
  },
  ht: {
    subject: (a, e) => `Aksyon nesesè: yon achtè konteste yon peman ${a} pou "${e}"`,
    yourEvent: 'evènman ou an',
    status: 'Aksyon nesesè',
    head: 'Yon achtè konteste peman li',
    hello: (n) => (n ? `Bonjou ${n},` : 'Bonjou,'),
    body: (a, e) =>
      `Yon achtè mande bank li anile yon peman tikè ${a} pou ${e}. Bank lan reprann kòb la pandan l ap fè ankèt, epi li ban nou yon dat limit pou nou reponn ak prèv.`,
    forEvent: (e) => `Pou ${e}`,
    reason: 'Rezon yo bay',
    buyer: 'Achtè',
    ticket: 'Tikè',
    reference: 'Referans',
    deadlineHead: 'dat limit pou prèv yo',
    deadlineBody:
      'Voye sa ou genyen ban nou anvan dat sa a. Si dat la pase san repons, bank lan deside an favè moun ki gen kat la otomatikman, epi kòb la pèdi.',
    helpsHead: 'sa k ap ede nou genyen',
    helps: [
      'Prèv achtè a te vini: yon tikè ki te eskane oswa yon lis antre ki siyen',
      'Nenpòt sa li te voye ba ou: mesaj, yon non nan pòt la, yon transfè',
      'Paj evènman ou, kondisyon ou ak règ ranbousman ou jan achtè a te wè yo',
      'Si sa sanble yon vrè erè, di nou sa. Yon ranbousman kounye a koute mwens pase yon diskisyon nou pèdi',
    ],
    merchant:
      'Tikèm se machann ofisyèl vant sa a, se nou ki reponn bank lan. Ou pa ka reponn dirèkteman nan Stripe. Reponn imèl sa a oswa kontakte sipò ak prèv ou yo, n ap voye yo pou ou.',
    cta: 'Voye prèv bay sipò',
  },
}

/** Subject for the organizer's chargeback email, in the organizer's language. */
export function getDisputeOpenedSubject(params: {
  amountMinor: number
  currency: string
  eventTitle: string | null
  lang?: EmailLang
}): string {
  const lang = pickLang(params.lang)
  const t = DISPUTE_COPY[lang]
  return t.subject(formatMoney((Number(params.amountMinor) || 0) / 100, currencyKey(params.currency), lang), params.eventTitle || t.yourEvent)
}

/**
 * The organizer's chargeback email.
 *
 * EVERY interpolated value that a person could have chosen — event title,
 * attendee name, the dispute reason, the organizer's own name — is escaped (the
 * kit blocks escape their text). A dispute reason is written by a cardholder's
 * bank and stored by us; treating it as trusted markup would let an outsider
 * inject live HTML into an organizer's inbox.
 */
export function getDisputeOpenedEmail(params: {
  organizerName: string | null
  eventTitle: string | null
  amountMinor: number
  currency: string
  reason: string | null
  evidenceDueBy: string | null
  attendeeName: string | null
  ticketId: string | null
  disputeId: string
  lang?: EmailLang
}): string {
  const lang = pickLang(params.lang)
  const t = DISPUTE_COPY[lang]
  const cur = currencyKey(params.currency)
  const amount = formatMoney((Number(params.amountMinor) || 0) / 100, cur, lang)
  const figure = amount.endsWith(` ${cur}`) ? amount.slice(0, -(cur.length + 1)) : amount
  const eventTitle = params.eventTitle || t.yourEvent

  const deadline = (() => {
    if (!params.evidenceDueBy) return null
    const date = new Date(params.evidenceDueBy)
    if (Number.isNaN(date.getTime())) return null
    return (
      date.toLocaleString(lang === 'en' ? 'en-US' : 'fr-FR', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'UTC',
      }) + ' UTC'
    )
  })()

  const rows: Array<{ label: string; value: string; mono?: boolean }> = []
  if (params.attendeeName) rows.push({ label: t.buyer, value: params.attendeeName })
  if (params.ticketId) rows.push({ label: t.ticket, value: params.ticketId, mono: true })
  rows.push({ label: t.reference, value: params.disputeId, mono: true })

  return renderEmail({
    lang,
    title: t.head,
    preheader: t.body(amount, eventTitle),
    status: { label: t.status, tone: 'red' },
    footer: 'organizer',
    blocks: [
      title(t.head, 34),
      gap(14),
      p(t.hello(params.organizerName)),
      p(t.body(amount, eventTitle)),
      gap(12),
      bigFigure(figure, cur, t.forEvent(eventTitle)),
      gap(24),
      quote(t.reason, capitalize(describeDisputeReasonIn(params.reason, lang))),
      gap(12),
      rowsBlock(rows),
      deadline ? gap(32) : '',
      deadline ? serifHeading(t.deadlineHead) : '',
      deadline ? paragraphHtml(strong(deadline), C.text) : '',
      deadline ? p(t.deadlineBody) : '',
      gap(deadline ? 16 : 32),
      serifHeading(t.helpsHead),
      lines(t.helps),
      gap(12),
      p(t.merchant),
      gap(12),
      button(t.cta, `${appUrl()}/support`),
    ],
  })
}

/** The admin copy — terse, and sent even when nothing could be attributed. English: admin-only. */
function getDisputeAdminEmail(record: DisputeRecord, eventType: string): string {
  const a = record.attribution
  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: 'Dispute', value: record.disputeId, mono: true },
    { label: 'Status', value: record.status || 'unknown' },
    { label: 'Amount', value: formatMinor(record.amountMinor, record.currency) },
    { label: 'Stripe event', value: eventType, mono: true },
    { label: 'Charge', value: record.chargeId || '—', mono: true },
    { label: 'PaymentIntent', value: record.paymentIntentId || '—', mono: true },
    { label: 'Evidence due', value: record.evidenceDueBy || 'not set by Stripe' },
    { label: 'Ticket', value: a.ticketId || '—', mono: true },
  ]
  const attributed = a.attributed
    ? `${a.eventTitle || a.eventId || 'event'} (organizer ${a.organizerName || a.organizerId || 'unknown'})`
    : `UNATTRIBUTED (${a.unattributedReason || 'unknown'})`

  return renderEmail({
    lang: 'en',
    title: `Chargeback ${record.status || ''}`.trim(),
    preheader: `${formatMinor(record.amountMinor, record.currency)} chargeback, ${a.attributed ? 'attributed' : 'UNATTRIBUTED'}.`,
    status: { label: 'Chargeback', tone: 'red' },
    footer: 'account',
    blocks: [
      title(`Chargeback ${record.status || ''}`.trim(), 34),
      gap(14),
      p('Tikèm is merchant of record, so this debits the PLATFORM balance.'),
      gap(4),
      rowsBlock(rows),
      gap(12),
      quote('Reason', capitalize(describeDisputeReason(record.reason))),
      gap(12),
      a.attributed
        ? quote('Attributed to', attributed)
        : `<div style="font-family:${FONT.sans};font-size:15px;font-weight:700;line-height:1.5;color:${C.red};">${escapeHtml(attributed)}</div>`,
      a.lookupFailed ? gap(16) : '',
      a.lookupFailed
        ? p(
            'A ticket lookup ERRORED while attributing this dispute, so "unattributed" here may be a Firestore failure, not a missing order.',
            C.amber
          )
        : '',
      gap(24),
      button('Open the disputes log', `${appUrl()}/admin/disputes`),
    ],
  })
}

// ── Notification ────────────────────────────────────────────────────────────

async function notifyOrganizer(record: DisputeRecord): Promise<{
  notified: boolean
  emailed: boolean
  error: string | null
}> {
  const a = record.attribution
  const organizerId = a.organizerId
  if (!organizerId) return { notified: false, emailed: false, error: 'no_organizer' }

  const amount = formatMinor(record.amountMinor, record.currency)
  const title = a.eventTitle || 'your event'
  const deadlineNote = record.evidenceDueBy
    ? ` We must respond by ${new Date(record.evidenceDueBy).toISOString().slice(0, 10)}.`
    : ''

  let notified = false
  let emailed = false
  let error: string | null = null

  // In-app first: it is the one channel that cannot bounce.
  try {
    await createNotification(
      organizerId,
      DISPUTE_NOTIFICATION_TYPE,
      '⚠️ A buyer disputed a ticket payment',
      `A buyer asked their bank to reverse a ${amount} payment for "${title}". We need your evidence to fight it.${deadlineNote}`,
      a.eventId ? `/organizer/events/${a.eventId}/earnings` : '/support',
      {
        eventId: a.eventId || undefined,
        ticketId: a.ticketId || undefined,
        disputeId: record.disputeId,
        amountMinor: record.amountMinor,
        currency: record.currency,
        evidenceDueBy: record.evidenceDueBy,
      }
    )
    notified = true
  } catch (err: any) {
    error = `notification_failed: ${err?.message || 'unknown'}`
    console.error('[disputes] failed to create organizer notification', {
      disputeId: record.disputeId,
      organizerId,
      message: err?.message,
    })
  }

  if (a.organizerEmail) {
    const lang = await resolveEmailLang({ userId: organizerId, email: a.organizerEmail })
    const sent = await sendEmail({
      to: a.organizerEmail,
      subject: getDisputeOpenedSubject({
        amountMinor: record.amountMinor,
        currency: record.currency,
        eventTitle: a.eventTitle,
        lang,
      }),
      html: getDisputeOpenedEmail({
        lang,
        organizerName: a.organizerName,
        eventTitle: a.eventTitle,
        amountMinor: record.amountMinor,
        currency: record.currency,
        reason: record.reason,
        evidenceDueBy: record.evidenceDueBy,
        attendeeName: a.attendeeName,
        ticketId: a.ticketId,
        disputeId: record.disputeId,
      }),
    })
    emailed = sent.success
    if (!sent.success) error = error || `email_failed: ${sent.code || sent.error || 'unknown'}`
  } else {
    error = error || 'organizer_has_no_email'
  }

  return { notified, emailed, error }
}

async function emailAdmins(record: DisputeRecord, eventType: string): Promise<boolean> {
  const recipients = getAdminEmails()
  if (recipients.length === 0) {
    console.warn('[disputes] ADMIN_EMAILS is not configured — no admin was emailed', {
      disputeId: record.disputeId,
    })
    return false
  }

  const amount = formatMinor(record.amountMinor, record.currency)
  const label = record.attribution.attributed
    ? `"${record.attribution.eventTitle || record.attribution.eventId}"`
    : 'an UNATTRIBUTED charge'
  const html = getDisputeAdminEmail(record, eventType)

  const results = await Promise.all(
    recipients.map((to) =>
      sendEmail({
        to,
        subject: `[Tikèm] Chargeback opened: ${amount} on ${label}`,
        html,
      }).catch((err) => {
        console.error('[disputes] admin email failed', { to, message: err?.message })
        return { success: false } as { success: boolean }
      })
    )
  )
  return results.some((r) => r.success)
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Handle one verified Stripe dispute webhook event end to end.
 *
 * Never throws. The Stripe webhook treats a throw as a failed delivery and
 * retries it, so a Firestore hiccup or a bounced email must not put a dispute
 * event into a retry loop — every failure is logged and reported in the result.
 *
 * @param paymentIntentId Resolved by the caller when the dispute object omits it
 *                        (older Stripe API versions), since only the caller holds
 *                        the Stripe client.
 */
export async function handleStripeDisputeEvent(params: {
  dispute: any
  eventType: string
  stripeEventId: string
  stripeEventCreated: number
  paymentIntentId?: string | null
}): Promise<HandleDisputeResult> {
  const { dispute, eventType, stripeEventId, stripeEventCreated } = params
  const disputeId = String(dispute?.id || '')

  const failed: HandleDisputeResult = {
    disputeId,
    status: String(dispute?.status || ''),
    outcome: disputeOutcome(String(dispute?.status || '')),
    isNew: false,
    stale: false,
    attributed: false,
    lossRecorded: false,
    organizerNotified: false,
    organizerEmailed: false,
    adminEmailed: false,
  }

  if (!disputeId) {
    console.error('[disputes] dispute event carried no dispute id; nothing recorded', { eventType })
    return failed
  }

  const chargeId = idOf(dispute?.charge)
  const paymentIntentId = params.paymentIntentId || idOf(dispute?.payment_intent)

  let attribution: DisputeAttribution
  try {
    attribution = await attributeDispute({ chargeId, paymentIntentId })
  } catch (error: any) {
    console.error('[disputes] attribution threw; recording as unattributed', {
      disputeId,
      message: error?.message,
    })
    attribution = emptyAttribution('attribution_threw', true)
  }

  let recorded: RecordOutcome
  try {
    recorded = await upsertDispute({
      dispute,
      eventType,
      stripeEventId,
      stripeEventCreated,
      paymentIntentId,
      attribution,
    })
  } catch (error: any) {
    // Losing the dispute record is the one thing worth shouting about: without it
    // nobody knows the money left.
    console.error('[disputes] FAILED to persist dispute — no record exists for this chargeback', {
      disputeId,
      eventType,
      message: error?.message,
    })
    return { ...failed, attributed: attribution.attributed }
  }

  const { record } = recorded
  const result: HandleDisputeResult = {
    disputeId,
    status: record.status,
    outcome: record.outcome,
    isNew: recorded.isNew,
    stale: recorded.stale,
    attributed: record.attribution.attributed,
    lossRecorded: recorded.lossRecorded,
    organizerNotified: false,
    organizerEmailed: false,
    adminEmailed: false,
  }

  if (recorded.shouldNotifyOrganizer) {
    const { notified, emailed, error } = await notifyOrganizer(record)
    result.organizerNotified = notified
    result.organizerEmailed = emailed

    // If neither channel worked, RELEASE the notify claim so the next dispute
    // event on this chargeback tries again — the organizer's deadline is real.
    const reached = notified || emailed
    await adminDb
      .collection(DISPUTES_COLLECTION)
      .doc(disputeId)
      .set(
        reached
          ? {
              organizerNotifiedAt: new Date().toISOString(),
              organizerNotifiedInApp: notified,
              organizerNotifiedEmail: emailed,
              notifyError: error,
            }
          : { notifyClaimedAt: null, notifyError: error },
        { merge: true }
      )
      .catch((err: any) =>
        console.error('[disputes] failed to record notification outcome', {
          disputeId,
          message: err?.message,
        })
      )
  }

  if (recorded.shouldEmailAdmins) {
    result.adminEmailed = await emailAdmins(record, eventType)
  }

  console.log('[disputes] recorded', {
    disputeId,
    eventType,
    status: result.status,
    outcome: result.outcome,
    attributed: result.attributed,
    eventId: record.attribution.eventId,
    organizerId: record.attribution.organizerId,
    lossRecorded: result.lossRecorded,
    stale: result.stale,
  })

  return result
}
