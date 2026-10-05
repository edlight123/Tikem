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
 * No clawback. No payout decision. Nothing here reverses a transfer or touches
 * `payoutRelease` on an organizer, because "should this organizer still get paid"
 * is decided in lib/payouts/**. This module records the facts and tells the humans;
 * the money logic reads those facts elsewhere.
 */

import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { escapeHtml, sendEmail } from '@/lib/email'
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
     * This writes a RECORD only. It does not set `payoutRelease.highRisk` and does
     * not reverse anything: what a loss should cost an organizer is decided in
     * lib/payouts/**, which reads this.
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
    if (organizerId && Object.keys(risk).length > 0) {
      tx.set(
        adminDb.collection('organizers').doc(organizerId),
        { disputeRisk: { ...risk, updatedAt: nowIso } },
        { merge: true }
      )
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

const BRAND_ERROR = '#ef4444'

/**
 * The organizer's chargeback email.
 *
 * EVERY interpolated value that a person could have chosen — event title,
 * attendee name, the dispute reason, the organizer's own name — goes through
 * escapeHtml. A dispute reason is written by a cardholder's bank and stored by us;
 * treating it as trusted markup would let an outsider inject live HTML into an
 * organizer's inbox.
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
}): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
  const supportUrl = `${appUrl}/support`
  const amount = escapeHtml(formatMinor(params.amountMinor, params.currency))
  const eventTitle = escapeHtml(params.eventTitle || 'your event')
  const greeting = escapeHtml(params.organizerName || 'there')
  const reason = escapeHtml(describeDisputeReason(params.reason))
  const attendee = params.attendeeName ? escapeHtml(params.attendeeName) : null
  const ticketId = params.ticketId ? escapeHtml(params.ticketId) : null
  const disputeId = escapeHtml(params.disputeId)

  const deadline = (() => {
    if (!params.evidenceDueBy) return null
    const date = new Date(params.evidenceDueBy)
    if (Number.isNaN(date.getTime())) return null
    return escapeHtml(
      date.toLocaleString('en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'UTC',
      }) + ' UTC'
    )
  })()

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>A ticket buyer disputed a payment</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0f172a; -webkit-font-smoothing: antialiased;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 48px 16px;">
              <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">

                <tr>
                  <td style="padding: 0;">
                    <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 50%, #b91c1c 100%); padding: 50px 40px; text-align: center;">
                      <div style="font-size: 64px; line-height: 1;">⚠️</div>
                      <div style="margin-top: 20px; font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">
                        A ticket buyer disputed their payment
                      </div>
                      <div style="margin-top: 8px; font-size: 14px; color: rgba(255, 255, 255, 0.85);">Tikèm</div>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td style="padding: 40px;">
                    <div style="font-size: 22px; font-weight: 800; color: #0f172a; margin-bottom: 12px;">
                      Hi ${greeting},
                    </div>
                    <div style="font-size: 16px; color: #64748b; line-height: 1.7; margin-bottom: 28px;">
                      A buyer has asked their bank to reverse a ${amount} ticket payment for
                      <strong style="color: #0f172a;">${eventTitle}</strong>. Their bank has taken the money back
                      while it investigates, and it has given us a deadline to answer with evidence.
                    </div>

                    <div style="background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border-radius: 14px; padding: 20px; border-left: 4px solid ${BRAND_ERROR}; margin-bottom: 24px;">
                      <div style="font-size: 14px; font-weight: 700; color: #991b1b; margin-bottom: 10px;">The dispute</div>
                      <table role="presentation" style="width: 100%; border-collapse: collapse; font-size: 14px; color: #b91c1c;">
                        <tr><td style="padding: 3px 0; width: 130px;">Amount</td><td style="padding: 3px 0; font-weight: 700;">${amount}</td></tr>
                        <tr><td style="padding: 3px 0;">Event</td><td style="padding: 3px 0; font-weight: 700;">${eventTitle}</td></tr>
                        <tr><td style="padding: 3px 0;">Stated reason</td><td style="padding: 3px 0;">${reason}</td></tr>
                        ${attendee ? `<tr><td style="padding: 3px 0;">Buyer</td><td style="padding: 3px 0;">${attendee}</td></tr>` : ''}
                        ${ticketId ? `<tr><td style="padding: 3px 0;">Ticket</td><td style="padding: 3px 0; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px;">${ticketId}</td></tr>` : ''}
                        <tr><td style="padding: 3px 0;">Reference</td><td style="padding: 3px 0; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px;">${disputeId}</td></tr>
                      </table>
                    </div>

                    ${
                      deadline
                        ? `
                    <div style="background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border-radius: 14px; padding: 20px; border-left: 4px solid #f59e0b; margin-bottom: 24px;">
                      <div style="font-size: 14px; font-weight: 700; color: #92400e; margin-bottom: 6px;">⏰ Evidence deadline</div>
                      <div style="font-size: 15px; color: #b45309; font-weight: 700;">${deadline}</div>
                      <div style="font-size: 13px; color: #b45309; margin-top: 6px; line-height: 1.6;">
                        Send us what you have before this date. If the deadline passes with no response, the bank
                        decides for the cardholder automatically and the money is gone.
                      </div>
                    </div>`
                        : ''
                    }

                    <div style="background: #f8fafc; border-radius: 14px; padding: 20px; margin-bottom: 28px;">
                      <div style="font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">What helps us win this</div>
                      <ul style="margin: 0; padding-left: 18px; font-size: 14px; color: #475569; line-height: 1.9;">
                        <li>Proof the buyer showed up, such as a scan record or a signed door list</li>
                        <li>Anything they sent you: messages, a name at the door, a transfer</li>
                        <li>Your event page, terms and refund policy as the buyer saw them</li>
                        <li>If this looks like a genuine mistake, tell us. A refund now costs less than a lost dispute</li>
                      </ul>
                    </div>

                    <div style="font-size: 14px; color: #64748b; line-height: 1.7; margin-bottom: 24px;">
                      Tikèm is the merchant of record for this sale, so we file the response to the bank.
                      You cannot answer it directly in Stripe. Reply to this email or contact support with your
                      evidence and we will submit it for you.
                    </div>

                    <div style="text-align: center;">
                      <a href="${supportUrl}" style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, ${BRAND_ERROR} 0%, #c53030 100%); color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 14px; letter-spacing: 0.3px;">
                        Send evidence to support
                      </a>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td style="padding: 24px 40px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
                    <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.6;">
                      © ${new Date().getFullYear()} Tikèm. All rights reserved.<br>
                      <a href="${appUrl}/support" style="color: #94a3b8; text-decoration: underline;">Help &amp; support</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}

/** The admin copy — terse, and sent even when nothing could be attributed. */
function getDisputeAdminEmail(record: DisputeRecord, eventType: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
  const a = record.attribution
  const rows: [string, string][] = [
    ['Dispute', escapeHtml(record.disputeId)],
    ['Status', escapeHtml(record.status || 'unknown')],
    ['Amount', escapeHtml(formatMinor(record.amountMinor, record.currency))],
    ['Reason', escapeHtml(describeDisputeReason(record.reason))],
    ['Stripe event', escapeHtml(eventType)],
    ['Charge', escapeHtml(record.chargeId || '—')],
    ['PaymentIntent', escapeHtml(record.paymentIntentId || '—')],
    ['Evidence due', escapeHtml(record.evidenceDueBy || 'not set by Stripe')],
    [
      'Attributed to',
      a.attributed
        ? `${escapeHtml(a.eventTitle || a.eventId || 'event')} (organizer ${escapeHtml(
            a.organizerName || a.organizerId || 'unknown'
          )})`
        : `<strong style="color:#b91c1c">UNATTRIBUTED (${escapeHtml(
            a.unattributedReason || 'unknown'
          )})</strong>`,
    ],
    ['Ticket', escapeHtml(a.ticketId || '—')],
  ]

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;color:#0f172a">
  <h2 style="color:#ef4444;margin:0 0 4px">Chargeback ${escapeHtml(record.status || '')}</h2>
  <p style="margin:0 0 16px;color:#64748b;font-size:14px">Tikèm is merchant of record, so this debits the PLATFORM balance.</p>
  <table style="border-collapse:collapse;font-size:14px">
    ${rows
      .map(
        ([label, value]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${escapeHtml(label)}</td><td style="padding:4px 0">${value}</td></tr>`
      )
      .join('')}
  </table>
  ${
    a.lookupFailed
      ? `<p style="margin:16px 0 0;color:#b45309;font-size:13px">⚠️ A ticket lookup ERRORED while attributing this dispute, so "unattributed" here may be a Firestore failure, not a missing order.</p>`
      : ''
  }
  <p style="margin:20px 0 0"><a href="${appUrl}/admin/disputes" style="color:#ef4444;font-weight:600">Open the disputes log</a></p>
</div>`
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
    const sent = await sendEmail({
      to: a.organizerEmail,
      subject: `Action needed: a buyer disputed a ${amount} payment for "${a.eventTitle || 'your event'}"`,
      html: getDisputeOpenedEmail({
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
