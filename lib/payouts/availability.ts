/**
 * WHAT AN ORGANIZER CAN WITHDRAW — the one definition.
 *
 * Before this module there were two independent balance engines that disagreed
 * by any amount:
 *
 *  - `event_earnings` (lib/earnings.ts) — an incrementally-written ledger with an
 *    uncapped fee, never decremented on refund, settled off a 0-day hold. The
 *    per-event MonCash / bank routes validated against it.
 *  - tickets × events (the old getOrganizerBalance in lib/firestore/payout.ts) —
 *    a flat uncapped 10%, a hard-coded 7-day delay, `new Date(Timestamp)` (which
 *    is Invalid Date, so every Timestamp-dated event stayed "pending" forever),
 *    and a "paid" set that ignored `approved` payouts and every per-event
 *    withdrawal. The finance page and the batch request validated against it.
 *
 * This function replaces both as the answer to "how much may be withdrawn from
 * ONE event, right now, in ITS currency". It is PURE: the caller loads the facts
 * (lib/payouts/availability-server.ts) and every display surface and every
 * validating route goes through the same arithmetic.
 *
 * The rules, in order:
 *
 *  1. Earned net comes from the TICKETS, not from a stored running total.
 *     Live = lib/tickets/status.ts (valid | confirmed | active | empty). A
 *     refunded ticket (status 'refunded' or refund_status 'approved') and one
 *     whose refund is in flight (refund_status 'processing' | 'manual_required')
 *     earn nothing. Free and comp tickets earn nothing but still count as sold.
 *  2. The platform fee is the one checkout charges: the location's rate, the
 *     PLATFORM_FEE_MIN floor per order, and the per-ticket cap in the event's own
 *     currency, scaled by the order's ticket count (lib/fees.ts
 *     calculateCappedPlatformFee — the same function checkout calls). Under
 *     BUYER incidence (stamped on each ticket at purchase) the buyer paid it on
 *     top, so the organizer nets face value. Tickets carry no stored fee or net
 *     amount, so this is a recomputation from the stamped incidence — never from
 *     the event's current setting, which would rewrite past sales.
 *  3. Stripe Connect (destination charge) tickets were paid straight into the
 *     organizer's own Stripe account. Tikèm does not hold that money, so it is
 *     reported as `heldByStripeMinor` and is never withdrawable here.
 *  4. Funded promoter commission is the promoter's money and is deducted.
 *  5. Already paid = the per-event ledger's `withdrawnAmount` (debited atomically
 *     at request time by every live path, credited back when a request fails)
 *     PLUS legacy batch payouts that never debited that ledger. A batch payout in
 *     ANY non-void status (pending, approved, processing, completed) reserves its
 *     tickets — `approved` used to be ignored, which re-opened paid tickets.
 *  6. Release timing is lib/payouts/release-rules.ts and nothing else (no 7-day
 *     constant, no SETTLEMENT_HOLD_DAYS): the same decideRelease() the Haiti gate
 *     and the Stripe cron call, with the same inputs, plus the admin review queue
 *     status. A cancelled / payout-frozen event, or an earnings row held for a
 *     currency review, releases nothing.
 *
 * Money is per currency: one event has one currency and nothing here adds two
 * currencies together. `summarizeAvailability` keeps them in separate buckets.
 */

import { calculateCappedPlatformFee } from '@/lib/fees'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import {
  decideRelease,
  holdHoursFor,
  type OrganizerHistory,
  type ReleaseDecision,
  type ReleaseTier,
} from '@/lib/payouts/release-rules'
import type { PayoutReleaseConfig } from '@/types/platform-settings'
import type { EarningsSummary, SettlementStatus } from '@/types/earnings'

// ── Small, shared parsers ───────────────────────────────────────────────────

/**
 * Any of the date shapes stored across the collections: a Firestore Timestamp
 * (`toDate()`), a serialized one (`_seconds` / `seconds`), an ISO string, epoch
 * millis or a Date. `new Date(timestamp)` — what the old engine did — yields
 * Invalid Date, which silently kept every Timestamp-dated event "pending".
 */
export function toDateOrNull(value: any): Date | null {
  if (value === null || value === undefined || value === '') return null
  try {
    if (typeof value?.toDate === 'function') {
      const d = value.toDate()
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
    }
    if (typeof value === 'object' && !(value instanceof Date)) {
      const seconds = value._seconds ?? value.seconds
      if (typeof seconds === 'number' && Number.isFinite(seconds)) {
        const nanos = Number(value._nanoseconds ?? value.nanoseconds ?? 0) || 0
        return new Date(seconds * 1000 + Math.floor(nanos / 1e6))
      }
      return null
    }
    const d = value instanceof Date ? value : new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

/** The moment a ticket was bought, whichever spelling this doc used. */
export function ticketPurchasedAt(ticket: any): Date | null {
  return (
    toDateOrNull(ticket?.purchased_at) ||
    toDateOrNull(ticket?.purchasedAt) ||
    toDateOrNull(ticket?.created_at) ||
    toDateOrNull(ticket?.createdAt)
  )
}

/** Event end. The release ladder accepts the end date and nothing else. */
export function eventEndsAt(event: any): Date | null {
  return toDateOrNull(event?.end_datetime ?? event?.endDateTime)
}

export function normalizeCurrencyCode(raw: unknown): 'HTG' | 'USD' | 'CAD' | 'EUR' {
  const upper = String(raw || '').toUpperCase()
  if (upper === 'USD' || upper === 'CAD' || upper === 'EUR') return upper
  return 'HTG'
}

/** Major-unit money (ticket prices are stored in major units) → minor units. */
function majorToMinor(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

function nonNegativeMinor(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

// ── Ticket classification ───────────────────────────────────────────────────

/** Refund has been paid back to the buyer. */
export function isRefundedTicket(ticket: any): boolean {
  const status = String(ticket?.status ?? '').toLowerCase().trim()
  const refundStatus = String(ticket?.refund_status ?? '').toLowerCase().trim()
  return status === 'refunded' || refundStatus === 'approved'
}

/**
 * A refund is being executed (claimed, or handed to a human). The money is on
 * its way back to the buyer, so it is not the organizer's to withdraw — even
 * though the ticket's status still reads live until the refund lands.
 */
export const REFUND_IN_FLIGHT_STATUSES = ['processing', 'manual_required'] as const

export function isRefundInFlight(ticket: any): boolean {
  const refundStatus = String(ticket?.refund_status ?? '').toLowerCase().trim()
  return (REFUND_IN_FLIGHT_STATUSES as readonly string[]).includes(refundStatus)
}

/** Paid straight into the organizer's own Stripe account (destination charge). */
export function isStripeConnectTicket(ticket: any): boolean {
  return String(ticket?.payment_method ?? '').toLowerCase().trim() === 'stripe_connect'
}

export function ticketPriceMinor(ticket: any): number {
  return majorToMinor(ticket?.price_paid ?? ticket?.pricePaid)
}

/**
 * Who paid the platform fee. 'buyer' is honoured ONLY on the Stripe rails —
 * the only checkout that prices a fee on top of face value. MonCash, MonCash
 * button and SogePay charge face value, so a 'buyer' stamp there (which the
 * MonCash callback used to copy from the client-editable event setting) would
 * waive a fee nobody paid.
 */
const BUYER_FEE_RAILS = new Set(['stripe', 'stripe_connect'])
function ticketIncidence(ticket: any): 'buyer' | 'organizer' {
  const stamped = String(ticket?.fee_incidence ?? ticket?.feeIncidence ?? '').toLowerCase()
  const rail = String(ticket?.payment_method ?? '').toLowerCase().trim()
  return stamped === 'buyer' && BUYER_FEE_RAILS.has(rail) ? 'buyer' : 'organizer'
}

/**
 * The currency a ticket was SOLD in, as the payment path stamped it
 * (original_currency, else currency). Null when absent.
 */
export function ticketSaleCurrency(ticket: any): string | null {
  const raw = String(ticket?.original_currency ?? ticket?.currency ?? '').trim().toUpperCase()
  return raw || null
}

/**
 * Attendance and refund facts, computed EXACTLY as the Haiti withdrawal gate
 * computes them (lib/payouts/withdrawal-gate.ts loadTicketFacts delegates
 * here), so a screen and the gate feed decideRelease() identical numbers.
 *
 * Note this deliberately keeps the gate's own definition of "live" for the
 * ATTENDANCE ratio ('valid' | 'confirmed' | empty) — it is a review signal, not
 * money, and changing it would move a review threshold.
 */
export type TicketFacts = {
  liveTickets: number
  checkedInTickets: number
  manualCheckIns: number
  methodKnownCheckIns: number
  refundedMinor: number
}

export function ticketFactsFromDocs(tickets: any[]): TicketFacts {
  const facts: TicketFacts = {
    liveTickets: 0,
    checkedInTickets: 0,
    manualCheckIns: 0,
    methodKnownCheckIns: 0,
    refundedMinor: 0,
  }
  for (const data of tickets) {
    const status = String(data?.status || '').toLowerCase()
    const refundStatus = String(data?.refund_status || '').toLowerCase()

    if (status === 'refunded' || refundStatus === 'approved') {
      facts.refundedMinor += majorToMinor(data?.refund_amount ?? data?.price_paid ?? data?.pricePaid)
      continue
    }

    if (status && status !== 'valid' && status !== 'confirmed') continue

    facts.liveTickets += 1
    if (data?.checked_in === true) {
      facts.checkedInTickets += 1
      const method = String(data?.check_in_method || '').toLowerCase()
      if (method === 'manual' || method === 'scan') {
        facts.methodKnownCheckIns += 1
        if (method === 'manual') facts.manualCheckIns += 1
      }
    }
  }
  return facts
}

// ── Inputs ──────────────────────────────────────────────────────────────────

/** The fee rule checkout applied to this event: rate + per-ticket cap. */
export type FeeRule = {
  /** e.g. 0.10 */
  platformFeePercentage: number
  /** Per-ticket ceiling in the EVENT currency's minor units; null = uncapped. */
  capMinorPerTicket: number | null
}

/** A legacy batch payout (organizers/{id}/payouts). */
export type BatchPayout = {
  id: string
  status: string
  ticketIds: string[]
  /** Per-event amounts actually paid, minor units — written since this module. */
  eventAmounts?: Record<string, number> | null
  /**
   * True when the request also debited event_earnings.withdrawnAmount (every
   * batch written since this module). Its money is then already inside
   * `withdrawnMinor`, and counting it again here would subtract it twice.
   */
  debitedEventEarnings?: boolean
}

/** Statuses in which a batch payout reserves nothing — it was refused or undone. */
export const VOID_BATCH_PAYOUT_STATUSES = ['cancelled', 'canceled', 'declined', 'rejected', 'failed'] as const

export function batchPayoutReserves(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase().trim()
  return !(VOID_BATCH_PAYOUT_STATUSES as readonly string[]).includes(s)
}

export type ReleaseInputs = {
  history: OrganizerHistory
  config: PayoutReleaseConfig
  /** payout_review_queue/{eventId}.status, or null when never queued. */
  reviewStatus: string | null
}

export type EventAvailabilityInput = {
  event: { id: string; [k: string]: any }
  /** Every ticket doc for the event, `{ id, ...data }`. Filtering happens here. */
  tickets: Array<{ id: string; [k: string]: any }>
  fee: FeeRule
  /** Funded promoter commission for this event, minor units. */
  promoterCommissionMinor?: number
  /**
   * The per-event ledger (event_earnings) — only its `withdrawnAmount` is
   * money truth here. Null when the event has no row yet (nothing withdrawn).
   */
  ledger?: {
    /** withdrawnAmount summed across EVERY earnings row of this event. */
    withdrawnMinor: number
    /**
     * withdrawnAmount of the ONE row debits land on (findEventEarningsDoc's).
     * Defaults to withdrawnMinor. Differs only when duplicate rows exist.
     */
    primaryWithdrawnMinor?: number
    /** Stored row is in another currency than the event: hold everything. */
    currencyBlocked?: boolean
    /**
     * The server-written running gross (event_earnings.grossSales), event
     * currency minor units, refund-inclusive. A defence-in-depth CAP: the
     * ticket-derived gross may never exceed what the payment paths recorded.
     * Undefined/null when the row has no such figure.
     */
    grossMinor?: number | null
    /** lib/events/cancel.ts stamped the ledger: the event was cancelled server-side. */
    cancelled?: boolean
  } | null
  /** All of this organizer's batch payouts; ones for other events are ignored. */
  batchPayouts?: BatchPayout[]
  /**
   * Sum of this event's live withdrawal_requests (pending / processing /
   * completed — reservedCents, else amount). An independent record of what was
   * paid: withdrawn is the larger of it (plus ledger-debited batches) and the
   * ledger, so a lost or duplicated ledger row can only under-state the balance.
   */
  liveRequestsMinor?: number
  /** Release ladder facts. Null → cannot judge → nothing released (fail closed). */
  release: ReleaseInputs | null
  now?: Date
}

export type AvailabilityReason =
  | ReleaseDecision['reason']
  | 'payouts_frozen'
  | 'event_cancelled'
  | 'earnings_currency_review'
  | 'ticket_currency_review'
  | 'ledger_gross_exceeded'
  | 'payout_under_review'
  | 'release_unknown'
  | 'nothing_owed'

export type EventAvailability = {
  eventId: string
  currency: 'HTG' | 'USD' | 'CAD' | 'EUR'

  /** Paid tickets Tikèm holds money for, INCLUDING refunded ones (minor units). */
  grossMinor: number
  /** Refunds paid back to buyers. */
  refundedMinor: number
  /** Refunds being executed right now — held, not withdrawable. */
  refundInFlightMinor: number
  /** Platform fee on the live (un-refunded) Tikèm-held tickets. */
  platformFeeMinor: number
  promoterCommissionMinor: number
  /** Live gross − platform fee − promoter commission. What the organizer earned. */
  netMinor: number
  /** Stripe Connect sales: already in the organizer's own Stripe account. */
  heldByStripeGrossMinor: number
  /** …and what the organizer netted from them there (after the capped fee). */
  heldByStripeMinor: number

  /** Per-event ledger withdrawals (pending + processing + completed). */
  withdrawnMinor: number
  /** Legacy batch payouts that did not debit the ledger. */
  batchReservedMinor: number
  /**
   * The ceiling a debit is judged against: net − legacy batch reservations.
   * Debits compare `ceilingMinor − withdrawnAmount` read INSIDE their
   * transaction, so a concurrent request still sees the reduced figure.
   */
  ceilingMinor: number
  /** Owed and not yet paid, regardless of timing: max(0, ceiling − withdrawn). */
  balanceMinor: number

  /** Withdrawable RIGHT NOW. The one number a button may be gated on. */
  availableNowMinor: number
  /** Owed but not yet released (hold, review, no end date…). */
  pendingMinor: number

  releasedNow: boolean
  reason: AvailabilityReason
  tier: ReleaseTier | null
  holdHours: number | null
  /** When the hold lifts, ISO. Null when there is no date to promise. */
  availableAt: string | null
  reviewStatus: string | null

  ticketsSold: number
  /** Live, un-reserved ticket ids — the idempotency set a batch payout records. */
  unpaidTicketIds: string[]
  /** Earliest/latest purchase among unpaidTicketIds, ISO. */
  periodStart: string | null
  periodEnd: string | null

  /** What decideRelease() was given, for the gate to be called identically. */
  gateInputs: { grossMinor: number; refundedMinor: number; availableMinor: number }
  /**
   * The event end the hold counted from (ISO), see effective end above. Callers
   * hand it to the gate as end_datetime so both judge the same moment.
   */
  effectiveEndsAt: string | null
}

// ── The function ────────────────────────────────────────────────────────────

export function computeEventAvailability(input: EventAvailabilityInput): EventAvailability {
  const now = input.now || new Date()
  const event = input.event || ({ id: '' } as any)
  const eventId = String(event.id || '')
  const currency = normalizeCurrencyCode(event.currency)

  const reservedTicketIds = new Set<string>()
  let batchReservedMinor = 0
  const legacyBatchTickets = new Set<string>()
  for (const payout of input.batchPayouts || []) {
    if (!batchPayoutReserves(payout?.status)) continue
    for (const id of payout?.ticketIds || []) reservedTicketIds.add(String(id))
    if (payout?.debitedEventEarnings) continue // already inside withdrawnMinor
    const recorded = payout?.eventAmounts?.[eventId]
    if (typeof recorded === 'number' && Number.isFinite(recorded)) {
      batchReservedMinor += Math.max(0, Math.round(recorded))
    } else {
      // Legacy payout with no per-event split: value its tickets with the same
      // fee maths below. That can only over-estimate what was paid (the old
      // engine deducted an uncapped fee), which under-states — never over-pays.
      for (const id of payout?.ticketIds || []) legacyBatchTickets.add(String(id))
    }
  }

  // ── classify tickets ─────────────────────────────────────────────────────
  type Order = { grossMinor: number; count: number; incidence: 'buyer' | 'organizer'; legacyGrossMinor: number; legacyCount: number }
  const orders = new Map<string, Order>()
  const connectOrders = new Map<string, { grossMinor: number; count: number; incidence: 'buyer' | 'organizer' }>()
  let grossMinor = 0
  let refundedMinor = 0
  let refundInFlightMinor = 0
  let ticketsSold = 0
  const unpaid: Array<{ id: string; at: Date | null }> = []

  const eventCurrencyCode = currency
  let currencyMismatchTickets = 0
  // The latest moment any ticket says the event runs to (server-stamped at
  // purchase: end/start of the event as sold, and the purchase itself).
  let latestTicketMoment: Date | null = null
  const later = (d: Date | null) => {
    if (d && (!latestTicketMoment || d.getTime() > latestTicketMoment.getTime())) latestTicketMoment = d
  }

  for (const ticket of input.tickets || []) {
    if (!ticket) continue
    const id = String(ticket.id || '')
    const price = ticketPriceMinor(ticket)

    // A paid ticket must have been SOLD in the event's currency. The event doc
    // is organizer-editable; the ticket's currency was stamped by the payment
    // path. Missing or different → the whole event goes to review.
    if (price > 0 && ticketSaleCurrency(ticket) !== eventCurrencyCode) currencyMismatchTickets += 1
    later(toDateOrNull(ticket.end_datetime))
    later(toDateOrNull(ticket.start_datetime ?? ticket.event_date))
    later(ticketPurchasedAt(ticket))

    if (isRefundedTicket(ticket)) {
      if (!isStripeConnectTicket(ticket)) {
        grossMinor += price
        refundedMinor += majorToMinor(ticket.refund_amount ?? ticket.price_paid ?? ticket.pricePaid)
      }
      continue
    }
    if (!isLiveTicketStatus(ticket.status)) continue // cancelled, transferred away…

    ticketsSold += 1
    if (isRefundInFlight(ticket)) {
      if (!isStripeConnectTicket(ticket)) refundInFlightMinor += price
      continue
    }
    if (price <= 0) {
      // Free / comp: sold, earns nothing. Still part of the idempotency set so a
      // batch can never be re-asked to "pay" it.
      if (!reservedTicketIds.has(id)) unpaid.push({ id, at: ticketPurchasedAt(ticket) })
      continue
    }
    // One payment is one order: the fee floor applies once and the cap scales
    // with its ticket count, exactly as checkout priced it. A ticket with no
    // payment id is its own order (the conservative reading: floor per ticket).
    const paymentId = String(ticket.payment_id ?? ticket.paymentId ?? '').trim()
    const orderKey = paymentId ? `pay:${paymentId}` : `ticket:${id}`

    if (isStripeConnectTicket(ticket)) {
      const c = connectOrders.get(orderKey) || { grossMinor: 0, count: 0, incidence: ticketIncidence(ticket) }
      c.grossMinor += price
      c.count += 1
      if (ticketIncidence(ticket) === 'organizer') c.incidence = 'organizer'
      connectOrders.set(orderKey, c)
      continue
    }

    grossMinor += price
    if (!reservedTicketIds.has(id)) unpaid.push({ id, at: ticketPurchasedAt(ticket) })

    const key = orderKey
    const order = orders.get(key) || { grossMinor: 0, count: 0, incidence: ticketIncidence(ticket), legacyGrossMinor: 0, legacyCount: 0 }
    order.grossMinor += price
    order.count += 1
    // Should one order's tickets ever disagree, take the fee-bearing reading:
    // under-paying is recoverable, over-paying is not.
    if (ticketIncidence(ticket) === 'organizer') order.incidence = 'organizer'
    if (legacyBatchTickets.has(id)) {
      order.legacyGrossMinor += price
      order.legacyCount += 1
    }
    orders.set(key, order)
  }

  const feeFor = (gross: number, count: number, incidence: 'buyer' | 'organizer') => {
    if (incidence === 'buyer' || gross <= 0) return 0
    return calculateCappedPlatformFee(gross, input.fee.platformFeePercentage, {
      capMinorPerTicket: input.fee.capMinorPerTicket,
      quantity: count,
    })
  }

  let liveGrossMinor = 0
  let platformFeeMinor = 0
  for (const order of Array.from(orders.values())) {
    liveGrossMinor += order.grossMinor
    platformFeeMinor += feeFor(order.grossMinor, order.count, order.incidence)
    if (order.legacyCount > 0) {
      // Proportional share of the order's fee for the legacy-paid tickets.
      const orderFee = feeFor(order.grossMinor, order.count, order.incidence)
      const legacyFee = Math.floor((orderFee * order.legacyGrossMinor) / Math.max(1, order.grossMinor))
      batchReservedMinor += Math.max(0, order.legacyGrossMinor - legacyFee)
    }
  }

  // Connect sales are reported as what the organizer netted in their own Stripe
  // account (face − the capped application fee), never as withdrawable here.
  let heldByStripeGrossMinor = 0
  let heldByStripeMinor = 0
  for (const order of Array.from(connectOrders.values())) {
    heldByStripeGrossMinor += order.grossMinor
    heldByStripeMinor += Math.max(0, order.grossMinor - feeFor(order.grossMinor, order.count, order.incidence))
  }

  const promoterCommissionMinor = nonNegativeMinor(input.promoterCommissionMinor)
  const netMinor = Math.max(0, liveGrossMinor - platformFeeMinor - promoterCommissionMinor)
  // What has been paid out per-event: the larger of the ledger (all rows) and
  // the independent records (live requests + batches that debited the ledger).
  let debitedBatchMinor = 0
  for (const payout of input.batchPayouts || []) {
    if (!batchPayoutReserves(payout?.status) || !payout?.debitedEventEarnings) continue
    const amt = payout?.eventAmounts?.[eventId]
    if (typeof amt === 'number' && Number.isFinite(amt)) debitedBatchMinor += Math.max(0, Math.round(amt))
  }
  const ledgerWithdrawn = nonNegativeMinor(input.ledger?.withdrawnMinor)
  const withdrawnMinor = Math.max(ledgerWithdrawn, nonNegativeMinor(input.liveRequestsMinor) + debitedBatchMinor)
  const primaryWithdrawn = input.ledger?.primaryWithdrawnMinor != null
    ? nonNegativeMinor(input.ledger.primaryWithdrawnMinor)
    : ledgerWithdrawn
  // Debits compare against the PRIMARY row's withdrawnAmount (read in their
  // transaction), so anything paid beyond it is taken off the ceiling here.
  const paidElsewhere = Math.max(0, withdrawnMinor - primaryWithdrawn)
  const ceilingMinor = Math.max(0, netMinor - batchReservedMinor - paidElsewhere)
  const balanceMinor = Math.max(0, ceilingMinor - primaryWithdrawn)

  unpaid.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))
  const dated = unpaid.filter((u) => u.at)
  const periodStart = dated[0]?.at?.toISOString() ?? null
  const periodEnd = dated[dated.length - 1]?.at?.toISOString() ?? null

  const gateInputs = { grossMinor, refundedMinor, availableMinor: balanceMinor }
  const base = {
    eventId,
    currency,
    grossMinor,
    refundedMinor,
    refundInFlightMinor,
    platformFeeMinor,
    promoterCommissionMinor,
    netMinor,
    heldByStripeGrossMinor,
    heldByStripeMinor,
    withdrawnMinor,
    batchReservedMinor,
    ceilingMinor,
    balanceMinor,
    ticketsSold,
    unpaidTicketIds: unpaid.map((u) => u.id),
    periodStart,
    periodEnd,
    gateInputs,
  }

  /**
   * The event end the HOLD counts from: the later of the event doc's end (which
   * the organizer can edit) and everything the tickets — server-written and
   * client-immutable — say about it: the end and start stamped at purchase, and
   * the purchase time itself (an event cannot have ended before its tickets
   * were sold). Moving end_datetime earlier therefore cannot release money
   * early; postponing it still delays. No event end at all → no_end_date.
   */
  const docEnd = eventEndsAt(event)
  const latest = latestTicketMoment as Date | null
  const endsAt = docEnd && latest && latest.getTime() > docEnd.getTime() ? latest : docEnd
  const held = (
    reason: AvailabilityReason,
    extra: Partial<Pick<EventAvailability, 'tier' | 'holdHours' | 'availableAt' | 'reviewStatus'>> = {}
  ): EventAvailability => ({
    ...base,
    effectiveEndsAt: endsAt ? endsAt.toISOString() : null,
    availableNowMinor: 0,
    pendingMinor: balanceMinor,
    releasedNow: false,
    reason,
    tier: extra.tier ?? null,
    holdHours: extra.holdHours ?? null,
    availableAt: extra.availableAt ?? null,
    reviewStatus: extra.reviewStatus ?? input.release?.reviewStatus ?? null,
  })

  // ── hard stops, before any ladder ────────────────────────────────────────
  if (event.payouts_frozen === true) return held('payouts_frozen')
  if (String(event.status || '') === 'cancelled' || input.ledger?.cancelled) return held('event_cancelled')
  if (input.ledger?.currencyBlocked) return held('earnings_currency_review')
  if (currencyMismatchTickets > 0) return held('ticket_currency_review')
  const ledgerGross = input.ledger?.grossMinor
  if (typeof ledgerGross === 'number' && Number.isFinite(ledgerGross) && ledgerGross >= 0) {
    // Paid, un-refunded Tikèm-held money per the tickets (refunds in flight
    // included) vs the server's running gross, which only ever grows.
    const ticketGross = Math.max(0, grossMinor - refundedMinor) + refundInFlightMinor
    if (ticketGross > Math.round(ledgerGross)) {
      console.warn('[payouts/availability] ticket gross exceeds ledger gross; holding for review', {
        eventId,
        ticketGross,
        ledgerGross,
      })
      return held('ledger_gross_exceeded')
    }
  }
  if (!input.release) return held('release_unknown')

  // ── the release ladder, exactly as the gate asks it ──────────────────────
  const { history, config, reviewStatus } = input.release
  const facts = ticketFactsFromDocs(input.tickets || [])
  const decision = decideRelease({
    event: {
      eventId,
      organizerId: String(event.organizer_id || event.organizerId || ''),
      endsAt: endsAt ? endsAt.toISOString() : null,
      status: event.status ? String(event.status) : null,
      // Same fallback the gate applies to a row that records no gross.
      grossMinor: grossMinor > 0 ? grossMinor : balanceMinor + refundedMinor,
      currency,
      rail: 'moncash',
      checkedInRatio: facts.liveTickets > 0 ? facts.checkedInTickets / facts.liveTickets : null,
      manualCheckInRatio:
        facts.methodKnownCheckIns > 0 ? facts.manualCheckIns / facts.methodKnownCheckIns : null,
      refundedMinor,
      hasOpenDispute: false,
    },
    history,
    availableMinor: balanceMinor,
    config,
    now,
  })

  const holdHours = holdHoursFor(history, config)
  const availableAt = endsAt && holdHours >= 0 ? new Date(endsAt.getTime() + holdHours * 3_600_000).toISOString() : null
  const heldByReview =
    (decision.release === 'review' && reviewStatus !== 'released') || reviewStatus === 'pending'

  if (decision.release === 'hold' || heldByReview) {
    return held(
      decision.release === 'hold'
        ? balanceMinor <= 0 && decision.reason === 'nothing_available_yet'
          ? 'nothing_owed'
          : decision.reason
        : 'payout_under_review',
      { tier: decision.tier, holdHours, availableAt, reviewStatus }
    )
  }

  const availableNowMinor = Math.max(0, Math.min(balanceMinor, decision.releasableMinor))
  return {
    ...base,
    effectiveEndsAt: endsAt ? endsAt.toISOString() : null,
    availableNowMinor,
    pendingMinor: Math.max(0, balanceMinor - availableNowMinor),
    releasedNow: availableNowMinor > 0,
    reason: decision.reason,
    tier: decision.tier,
    holdHours,
    availableAt,
    reviewStatus,
  }
}

// ── Organizer-level roll-up, per currency ───────────────────────────────────

export type CurrencyTotals = {
  currency: string
  availableNowMinor: number
  pendingMinor: number
  netMinor: number
  grossMinor: number
  withdrawnMinor: number
  heldByStripeMinor: number
  /** Earliest date a pending amount in this currency is promised. */
  nextAvailableAt: string | null
}

/**
 * Totals PER CURRENCY. An HTG balance and a USD balance are two figures with
 * two payout paths; adding their minor units would be arithmetic fiction.
 * HTG first, then alphabetical — a stable order for screens.
 */
export function summarizeAvailability(events: EventAvailability[]): CurrencyTotals[] {
  const map = new Map<string, CurrencyTotals>()
  for (const e of events) {
    // An event that never sold and was never paid out says nothing about any
    // currency — without this, one unsold CAD draft adds a "CAD 0.00" balance.
    if (!(e.ticketsSold > 0 || e.withdrawnMinor > 0 || e.batchReservedMinor > 0 || e.heldByStripeGrossMinor > 0)) continue
    const t =
      map.get(e.currency) ||
      ({
        currency: e.currency,
        availableNowMinor: 0,
        pendingMinor: 0,
        netMinor: 0,
        grossMinor: 0,
        withdrawnMinor: 0,
        heldByStripeMinor: 0,
        nextAvailableAt: null,
      } as CurrencyTotals)
    t.availableNowMinor += e.availableNowMinor
    t.pendingMinor += e.pendingMinor
    t.netMinor += e.netMinor
    t.grossMinor += e.grossMinor
    t.withdrawnMinor += e.withdrawnMinor
    t.heldByStripeMinor += e.heldByStripeMinor
    if (e.pendingMinor > 0 && e.availableAt) {
      if (!t.nextAvailableAt || e.availableAt < t.nextAvailableAt) t.nextAvailableAt = e.availableAt
    }
    map.set(e.currency, t)
  }
  return Array.from(map.values()).sort((a, b) =>
    a.currency === b.currency ? 0 : a.currency === 'HTG' ? -1 : b.currency === 'HTG' ? 1 : a.currency.localeCompare(b.currency)
  )
}

// ── The row every earnings screen reads ─────────────────────────────────────

/**
 * The per-event earnings payload (web per-event page, mobile per-event screen,
 * mobile Earnings hub) built from the shared availability, so `net − withdrawn`
 * on any screen equals the balance a withdrawal is judged against, and
 * `availableToWithdraw` is exactly what may be requested now.
 */
export function toEarningsRow(a: EventAvailability, now: Date = new Date()) {
  const withdrawnAmount = a.withdrawnMinor + a.batchReservedMinor
  const settlementStatus = a.releasedNow ? 'ready' : a.balanceMinor > 0 ? 'pending' : withdrawnAmount > 0 ? 'locked' : 'pending'
  return {
    availableToWithdraw: a.availableNowMinor,
    grossSales: Math.max(0, a.grossMinor - a.refundedMinor) + a.heldByStripeGrossMinor,
    totalEarned: Math.max(0, a.grossMinor - a.refundedMinor) + a.heldByStripeGrossMinor,
    netAmount: a.netMinor,
    withdrawnAmount,
    ticketsSold: a.ticketsSold,
    platformFee: a.platformFeeMinor,
    promoterCommission: a.promoterCommissionMinor,
    refundedAmount: a.refundedMinor,
    refundInFlightAmount: a.refundInFlightMinor,
    heldByStripeAmount: a.heldByStripeMinor,
    currency: a.currency,
    settlementStatus,
    settlementReadyDate: a.availableAt,
    lastCalculatedAt: now.toISOString(),
    dataSource: 'availability' as const,
    release: {
      releasedNow: a.releasedNow,
      releasableMinor: a.availableNowMinor,
      availableAt: a.availableAt,
      holdHours: a.holdHours ?? 0,
      reason: a.reason,
      tier: a.tier ?? 'new',
      reviewStatus: a.reviewStatus,
    },
    // Any hold that needs the payouts team: screens show "needs review", not 0.
    withdrawalBlocked:
      a.reason === 'earnings_currency_review' || a.reason === 'ticket_currency_review' || a.reason === 'ledger_gross_exceeded'
        ? { code: a.reason, eventCurrency: a.currency }
        : null,
  }
}

/**
 * The organizer finance page's summary, built from the shared availability
 * rather than the event_earnings aggregate — so its per-event "available"
 * column, its totals and its withdraw button are one set of numbers. Events
 * that never sold and never paid out are left out. Totals stay per currency
 * (`totalsByCurrency`) whenever more than one currency is present.
 */
export function summaryFromAvailability(
  events: Array<EventAvailability & { title?: string; eventDate?: string | null }>
): EarningsSummary {
  const relevant = events.filter((e) => e.ticketsSold > 0 || e.withdrawnMinor > 0 || e.batchReservedMinor > 0)
  const totalsByCurrency: NonNullable<EarningsSummary['totalsByCurrency']> = {}
  for (const e of relevant) {
    const row = toEarningsRow(e)
    const t =
      totalsByCurrency[e.currency] ||
      (totalsByCurrency[e.currency] = {
        totalGrossSales: 0,
        totalNetAmount: 0,
        totalAvailableToWithdraw: 0,
        totalWithdrawn: 0,
        totalPlatformFees: 0,
        totalProcessingFees: 0,
      })
    t.totalGrossSales += row.grossSales
    t.totalNetAmount += row.netAmount
    t.totalAvailableToWithdraw += row.availableToWithdraw
    t.totalWithdrawn += row.withdrawnAmount
    t.totalPlatformFees += row.platformFee
  }
  const currencies = Object.keys(totalsByCurrency) as Array<keyof typeof totalsByCurrency>
  const single = currencies.length <= 1 ? totalsByCurrency[currencies[0]] : undefined
  return {
    totalGrossSales: single?.totalGrossSales ?? 0,
    totalNetAmount: single?.totalNetAmount ?? 0,
    totalAvailableToWithdraw: single?.totalAvailableToWithdraw ?? 0,
    totalWithdrawn: single?.totalWithdrawn ?? 0,
    totalPlatformFees: single?.totalPlatformFees ?? 0,
    totalProcessingFees: 0,
    currency: currencies.length > 1 ? 'mixed' : (currencies[0] || 'HTG'),
    totalsByCurrency: currencies.length > 1 ? totalsByCurrency : undefined,
    events: relevant
      .map((e) => {
        const row = toEarningsRow(e)
        return {
          eventId: e.eventId,
          eventTitle: e.title || 'Event',
          eventDate: e.eventDate || '',
          grossSales: row.grossSales,
          netAmount: row.netAmount,
          availableToWithdraw: row.availableToWithdraw,
          settlementStatus: row.settlementStatus as SettlementStatus,
          currency: e.currency,
        }
      })
      .sort((a, b) => new Date(b.eventDate || 0).getTime() - new Date(a.eventDate || 0).getTime()),
  }
}

// ── Hand-off to the withdrawal routes ───────────────────────────────────────

/**
 * The event as the release gate must judge it: the server-authoritative end
 * (effectiveEndsAt) and a server-side cancellation, overriding whatever the
 * organizer-editable event doc says now.
 */
export function gateEventData(eventData: any, a: EventAvailability): any {
  return {
    ...(eventData || {}),
    ...(a.effectiveEndsAt ? { end_datetime: a.effectiveEndsAt } : {}),
    ...(a.reason === 'event_cancelled' ? { status: 'cancelled' } : {}),
    ...(a.reason === 'payouts_frozen' ? { payouts_frozen: true } : {}),
  }
}

/**
 * Integrity holds that refuse a withdrawal outright (409, for admin review):
 * the money inputs disagree with what the payment paths recorded.
 */
export function integrityRefusal(
  a: EventAvailability
): { status: number; body: { error: string; code: string; needsAdminReview: true } } | null {
  if (a.reason === 'ticket_currency_review') {
    return {
      status: 409,
      body: {
        error:
          "This event's ticket sales were recorded in a different currency than the event now shows. The Tikèm payouts team needs to review it before anything can be withdrawn.",
        code: 'ticket_currency_review',
        needsAdminReview: true,
      },
    }
  }
  if (a.reason === 'ledger_gross_exceeded') {
    return {
      status: 409,
      body: {
        error:
          "This event's ticket records don't match its payment records. The Tikèm payouts team needs to review it before anything can be withdrawn.",
        code: 'ledger_gross_exceeded',
        needsAdminReview: true,
      },
    }
  }
  return null
}
