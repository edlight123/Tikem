// Shared ticket-fulfillment pipeline.
//
// Turns a PAID `pending_transactions` row (looked up by order_id) into issued tickets,
// updated inventory, earnings, and buyer notifications — exactly once.
//
// This generalizes the logic that the MonCash Button return handler performs after it has
// verified a payment, so other providers (e.g. Sogepay) can fulfill consistently without
// re-implementing currency handling, the idempotency claim, inventory increments, etc.
//
// IMPORTANT: callers MUST verify the payment with the provider BEFORE calling fulfillPaidOrder.
// This module does not talk to any payment gateway; it trusts that the order is paid.

import { fundsRailForPaymentMethod } from '@/lib/payouts/funds-rail'
import { createHmac } from 'node:crypto'
import { createClient } from '@/lib/firebase-db/server'
import { adminDb } from '@/lib/firebase/admin'
import {
  buildTierSoldIncrements,
  convertSeatHold,
} from '@/lib/tickets/inventory'
import { releaseSeatHold } from '@/lib/tickets/seatHolds'
import { addTicketToEarnings } from '@/lib/earnings'
import { sendTicketConfirmation } from '@/lib/tickets/confirmation'
import {
  notifyTicketPurchase as notifyTicketPurchaseNotification,
  notifyOrganizerTicketSale,
} from '@/lib/notifications/helpers'
import { onSaleCompleted } from '@/lib/notifications/campaigns'
import { promoBuyerKey, redeemPromoInTransaction } from '@/lib/promo-codes'
import { recordPromoterSale } from '@/lib/promoters'
import { sanitizeAttribution, ticketAttributionFields, withResolvedPromoter } from '@/lib/attribution'
import { recordAttributedSale } from '@/lib/tracking-links'
import { recordInvitePurchase } from '@/lib/invites/server'
import { guestRecipientFromOrder } from '@/lib/guest/checkout'
import { attachTicketsToGuestOrder, isGuestId } from '@/lib/guest/identity'
import { validateStoredOrderLines } from '@/lib/tickets/purchasable'
import {
  recordFreeClaimTickets,
  releaseUnusedFreeClaimForOrder,
  takeFreeClaimForOrder,
  type FreeClaimant,
} from '@/lib/tickets/free-claim-policy'
import {
  addOnIncrements,
  addOnLabel,
  purchasedAddOnsFor,
  type PurchasedAddOn,
} from '@/lib/addons/addOns'

// Window after which a stuck "processing" claim is considered stale and may be re-claimed
// (e.g. if a previous fulfillment attempt crashed mid-way).
const FULFILLMENT_CLAIM_STALE_MS = 90_000

export type FulfillmentClaim =
  | { outcome: 'claimed' }
  | { outcome: 'already_completed'; ticketId: string | null }
  | { outcome: 'in_progress' }
  | { outcome: 'not_found' }
  | { outcome: 'refused'; reason: string }

/**
 * Order states that must NEVER be fulfilled, whatever the gateway now says.
 *
 * `needs_refund` is set when a paid order could not be honoured (sold out, amount
 * mismatch, invalid order). Fulfilling it later — e.g. the buyer reloads the return
 * URL after a seat freed up — would issue tickets AND leave the order in the refund
 * queue, so the buyer gets both.
 */
export function fulfillmentBlockedReason(data: Record<string, any> | null | undefined): string | null {
  if (!data) return null
  if (data.needs_refund === true) return 'needs_refund'
  const status = String(data.status || '').toLowerCase()
  if (status === 'refunded' || status === 'cancelled' || status === 'canceled') return status
  return null
}

/**
 * Atomically claim a pending transaction (looked up by order_id) for fulfillment.
 * Uses a Firestore transaction so only ONE concurrent request creates tickets for a given
 * paid order. Prevents duplicate tickets / double-counted earnings when a return/callback is
 * hit more than once.
 */
export async function claimOrderForFulfillment(orderId: string): Promise<FulfillmentClaim> {
  const snap = await adminDb
    .collection('pending_transactions')
    .where('order_id', '==', orderId)
    .limit(1)
    .get()

  if (snap.empty) return { outcome: 'not_found' }
  const ref = snap.docs[0].ref

  return adminDb.runTransaction(async (tx: any) => {
    const doc = await tx.get(ref)
    if (!doc.exists) return { outcome: 'not_found' } as FulfillmentClaim

    const data = doc.data() || {}

    if (data.status === 'completed' && data.ticket_id) {
      return { outcome: 'already_completed', ticketId: String(data.ticket_id) } as FulfillmentClaim
    }

    // Checked INSIDE the transaction so a refund flag set concurrently is honoured.
    const blocked = fulfillmentBlockedReason(data)
    if (blocked) {
      return { outcome: 'refused', reason: blocked } as FulfillmentClaim
    }

    if (data.status === 'processing' && data.fulfillment_started_at) {
      const startedAt = new Date(data.fulfillment_started_at).getTime()
      if (Number.isFinite(startedAt) && Date.now() - startedAt < FULFILLMENT_CLAIM_STALE_MS) {
        return { outcome: 'in_progress' } as FulfillmentClaim
      }
    }

    tx.update(ref, {
      status: 'processing',
      fulfillment_started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    return { outcome: 'claimed' } as FulfillmentClaim
  })
}

/** Deterministic, unguessable id for the n-th ticket of a mobile-money order. */
export function orderTicketId(orderId: string, index: number): string {
  const secret = process.env.TICKET_ID_SECRET || process.env.MONCASH_SECRET_KEY || process.env.STRIPE_SECRET_KEY || 'tikem'
  const tag = createHmac('sha256', secret).update(`order:${orderId}:${index}`).digest('hex').slice(0, 16)
  const safe = String(orderId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'order'
  return `mm_${safe}_${index}_${tag}`
}

/**
 * Write one ticket under its deterministic id. A ticket that already exists
 * (written by an earlier, interrupted run) is adopted as it is.
 */
async function writeOrderTicket(
  id: string,
  ticketData: Record<string, any>
): Promise<{ data: Record<string, any> | null; error: any }> {
  try {
    const ref = adminDb.collection('tickets').doc(id)
    const created = await adminDb.runTransaction(async (tx: any) => {
      const existing = await tx.get(ref)
      if (existing.exists) return { id, ...(existing.data() || {}), qr_code_data: existing.data()?.qr_code_data || id }
      const nowIso = new Date().toISOString()
      const doc = { ...ticketData, id, qr_code_data: id, created_at: nowIso, updated_at: nowIso }
      tx.set(ref, doc)
      return doc
    })
    return { data: created, error: null }
  } catch (error) {
    return { data: null, error }
  }
}

/**
 * Take a one-time bookkeeping step for an order (earnings, promo redemption).
 * True exactly once per order and step; never throws (false on error, so a
 * failure under-counts rather than double-counts).
 */
async function takeOrderStep(orderId: string, step: 'earnings' | 'promo'): Promise<boolean> {
  try {
    const snap = await adminDb.collection('pending_transactions').where('order_id', '==', orderId).limit(1).get()
    if (snap.empty) return false
    const ref = snap.docs[0].ref
    return await adminDb.runTransaction(async (tx: any) => {
      const doc = await tx.get(ref)
      const field = `fulfillment_step_${step}`
      if (doc.data()?.[field]) return false
      tx.set(ref, { [field]: new Date().toISOString() }, { merge: true })
      return true
    })
  } catch (err: any) {
    console.error(`[fulfillment] could not take the ${step} step`, { orderId, message: err?.message })
    return false
  }
}

/**
 * Release a fulfillment claim so the order can be retried later (used when ticket creation
 * fails after the claim was taken).
 */
export async function releaseOrderClaim(orderId: string): Promise<void> {
  try {
    const snap = await adminDb
      .collection('pending_transactions')
      .where('order_id', '==', orderId)
      .limit(1)
      .get()
    if (snap.empty) return
    await snap.docs[0].ref.set(
      { status: 'pending', fulfillment_started_at: null, updated_at: new Date().toISOString() },
      { merge: true }
    )
  } catch (err) {
    console.error('[fulfillment] failed to release fulfillment claim', err)
  }
}

export interface FulfillPaidOrderResult {
  outcome:
    | 'fulfilled'
    | 'already_completed'
    | 'in_progress'
    | 'not_found'
    | 'ticket_creation_failed'
    /**
     * Paid, but the seats could not be confirmed yet (inventory contention). The claim was
     * handed back and a retry (callback, reconcile cron) finishes it: show the buyer a
     * "confirming" page, never "failed".
     */
    | 'confirming'
    | 'capacity_exceeded'
    /** The order is flagged for refund (or refunded/cancelled): never issue tickets. */
    | 'refused'
    /** The stored order is malformed (e.g. a fractional quantity): flagged for refund. */
    | 'invalid_order'
  ticketId: string | null
  /** Set when outcome === 'refused' | 'invalid_order'. */
  reason?: string
  /** Set when outcome === 'capacity_exceeded' so the caller can refund/flag the paid order. */
  capacity?: { reason?: string; tierId?: string | null; remaining?: number }
}

interface TierSelection {
  tierId?: string | null
  tierName?: string
  quantity: number
  unitPrice: number
  originalUnitPrice?: number
  /** LIST price before promo, event currency (stamped by initiate since the free-claim rules). */
  listUnitPrice?: number
}

/**
 * The inventory reservation a mobile-money order converts: the seat hold its
 * initiate placed, or (an order from before seat holds) one keyed by the order.
 */
export function orderReservationId(order: { seat_hold_id?: unknown }, orderId: string): string {
  const hold = String(order?.seat_hold_id || '')
  return /^hold_[a-f0-9]{32}$/.test(hold) ? hold : `order_${String(orderId).replace(/[^A-Za-z0-9_-]/g, '_')}`
}

/**
 * Is this stored line a FREE line (list price 0)? Decided on the list price the
 * order recorded at initiate, so a promo that zeroed a paid line is not a free
 * claim. An order written before the list price was stamped is free only when
 * the line cost nothing and no promo was applied to the order.
 */
export function isFreeOrderLine(selection: TierSelection, order: { promo_code_id?: unknown }): boolean {
  const list = selection?.listUnitPrice
  if (typeof list === 'number' && Number.isFinite(list)) return list <= 0
  return Number(selection?.unitPrice || 0) <= 0 && !order?.promo_code_id
}

/** The claim-lock `source` for a rail's order (lib/tickets/free-claim-policy). */
function freeClaimSourceFor(paymentMethod: string): string {
  const m = String(paymentMethod || '').toLowerCase()
  if (m === 'sogepay') return 'sogepay_order'
  if (m === 'moncash') return 'moncash_order'
  return `${m || 'mobile_money'}_order`
}

/**
 * Fulfill a paid order: create tickets, increment inventory, update earnings, notify the buyer,
 * and mark the pending transaction completed. Idempotent via claimOrderForFulfillment.
 *
 * @param params.orderId        The gateway order id stored on the pending transaction.
 * @param params.paymentMethod  Normalized payment-method label written onto tickets/earnings.
 * @param params.transactionId  Provider transaction id (used as payment_id; falls back to orderId).
 * @param params.payer          Optional payer identifier to persist for auditing.
 * @param params.logPrefix      Log namespace, e.g. "[sogepay]".
 */
export async function fulfillPaidOrder(params: {
  orderId: string
  paymentMethod: string
  transactionId?: string | null
  payer?: string | null
  logPrefix?: string
  /**
   * Extra provider fields written onto the order when it is marked completed (e.g.
   * MonCash's `moncash_trans_number`). Never used for anything the fulfillment
   * itself decides on.
   */
  completionFields?: Record<string, unknown>
}): Promise<FulfillPaidOrderResult> {
  const { orderId, paymentMethod } = params
  // Where the money sits (lib/payouts/funds-rail): MonCash (NatCash over the
  // MonCash Button gateway settles there too) or Sogepay.
  const fundsRail = fundsRailForPaymentMethod(paymentMethod)
  const transactionId = params.transactionId || null
  const logPrefix = params.logPrefix || '[fulfillment]'

  const claim = await claimOrderForFulfillment(orderId)
  if (claim.outcome === 'already_completed') {
    return { outcome: 'already_completed', ticketId: claim.ticketId }
  }
  if (claim.outcome === 'in_progress') {
    return { outcome: 'in_progress', ticketId: null }
  }
  if (claim.outcome === 'not_found') {
    return { outcome: 'not_found', ticketId: null }
  }
  if (claim.outcome === 'refused') {
    console.warn(`${logPrefix} refusing to fulfil a blocked order`, { orderId, reason: claim.reason })
    return { outcome: 'refused', ticketId: null, reason: claim.reason }
  }
  // claim.outcome === 'claimed': we own fulfillment for this order from here on.

  const supabase = await createClient()

  const { data: pendingTx } = await supabase
    .from('pending_transactions')
    .select('*')
    .eq('order_id', orderId)
    .single()

  if (!pendingTx) {
    await releaseOrderClaim(orderId)
    return { outcome: 'not_found', ticketId: null }
  }

  const { data: eventDetails } = await supabase
    .from('events')
    .select('*')
    .eq('id', pendingTx.event_id)
    .single()

  // WHO gets this ticket.
  //
  // For an account purchase this is `users/{uid}`, unchanged. For a GUEST there is no
  // user document at all — the buyer's name/email/phone were captured at checkout and
  // stored on this very order, so they are read from here. Reading them from the order
  // (not from whatever the confirming request carries) is what keeps a forged callback
  // from redirecting a stranger's ticket.
  const guestRecipient = guestRecipientFromOrder(pendingTx)
  const isGuestOrder = Boolean(guestRecipient)

  const { data: accountAttendee } = isGuestOrder
    ? { data: null }
    : await supabase.from('users').select('*').eq('id', pendingTx.user_id).single()

  const attendee = guestRecipient
    ? {
        email: guestRecipient.email,
        full_name: guestRecipient.name,
        phone: guestRecipient.phone,
        is_guest: true,
      }
    : accountAttendee

  const tierSelections: TierSelection[] =
    Array.isArray(pendingTx.tier_selections) && pendingTx.tier_selections.length > 0
      ? pendingTx.tier_selections
      : [
          {
            tierId: pendingTx.tier_id || null,
            tierName: pendingTx.tier_name || 'General Admission',
            quantity: pendingTx.quantity || 1,
            unitPrice: (pendingTx.amount || 0) / Math.max(1, pendingTx.quantity || 1),
          },
        ]

  // Re-validate the stored order before anything is issued: every line a whole
  // number of tickets, adding up to the order's quantity. Initiate refuses these
  // now, but an order written before that (or by any future path) must not turn a
  // 0.01-ticket payment into a whole ticket. Paid, so it is flagged for refund.
  const lineCheck = validateStoredOrderLines(tierSelections, pendingTx.quantity ?? 1)
  if (!lineCheck.ok) {
    console.error(`${logPrefix} refusing to fulfil an order with an invalid quantity`, {
      orderId,
      quantity: pendingTx.quantity,
    })
    await supabase
      .from('pending_transactions')
      .update({ status: 'failed', failure_reason: 'invalid_quantity', needs_refund: true })
      .eq('order_id', orderId)
    // Never issued, so its seat hold goes back on sale.
    await releaseSeatHold(pendingTx.seat_hold_id, { logPrefix })
    return { outcome: 'invalid_order', ticketId: null, reason: 'invalid_quantity' }
  }

  // FREE lines (list price 0) are the buyer's one free claim for this event,
  // under the same lock the free-claim route and the card rail use
  // (lib/tickets/free-claim-policy). Initiate refused a buyer who had already
  // claimed, but two orders paid side by side would both have passed that check:
  // the lock is taken HERE, atomically, keyed by this order. A claim held by
  // another order means this order's free lines are not issued — they cost
  // nothing, so neither the amount, the fee nor the earnings change, and the
  // buyer is owed nothing for them — and the paid lines are issued as normal.
  // The decision is stored on the order so a retry issues exactly the same set.
  const freeClaimant: FreeClaimant = {
    isGuest: isGuestOrder || pendingTx.is_guest === true,
    id: String(pendingTx.user_id || ''),
    email: guestRecipient?.email || pendingTx.guest_email || null,
  }
  const isFreeSelection = (sel: TierSelection) => isFreeOrderLine(sel, pendingTx)
  const hasFreeLines = tierSelections.some(isFreeSelection)
  let freeClaimDecision: string | null = hasFreeLines ? pendingTx.free_claim_decision || null : null
  if (hasFreeLines && !freeClaimDecision) {
    let held: boolean
    try {
      held = await takeFreeClaimForOrder(
        String(pendingTx.event_id),
        freeClaimant,
        orderId,
        freeClaimSourceFor(paymentMethod)
      )
    } catch (err: any) {
      console.error(`${logPrefix} could not take the free-claim lock; releasing for retry`, {
        orderId,
        message: err?.message || String(err),
      })
      await releaseOrderClaim(orderId)
      return { outcome: 'ticket_creation_failed', ticketId: null }
    }
    freeClaimDecision = held ? 'kept' : 'dropped'
    const dropped = held ? [] : tierSelections.filter(isFreeSelection)
    if (!held) {
      console.warn(`${logPrefix} free lines not issued: the buyer's free claim for this event is already used`, {
        orderId,
      })
    }
    await supabase
      .from('pending_transactions')
      .update({
        free_claim_decision: freeClaimDecision,
        ...(dropped.length ? { free_lines_dropped: dropped, free_lines_dropped_reason: 'already_claimed' } : {}),
      })
      .eq('order_id', orderId)
  }
  /** The lines actually issued: every line, or only the paid ones when the free claim is held elsewhere. */
  const issuedSelections: TierSelection[] =
    freeClaimDecision === 'dropped' ? tierSelections.filter((sel) => !isFreeSelection(sel)) : tierSelections
  /**
   * Tickets this order issues. Equal to the order's quantity unless free lines
   * were dropped; every per-ticket split (the buyer fee share) and every count
   * (inventory, earnings, promo, confirmation) uses it, so the issued tickets'
   * charged_amount still adds up to what the buyer paid.
   */
  const issuedQuantity = hasFreeLines
    ? issuedSelections.reduce((sum, sel) => sum + (Number(sel.quantity) || 0), 0)
    : Number(pendingTx.quantity || 1)

  // ADD-ONS (lib/addons/addOns.ts), priced and stored on the order at initiate:
  // booked on the order's FIRST ticket, their stock converted with the seats.
  const orderAddOnLines = storedAddOnLines(pendingTx)
  const hasAddOnLines = orderAddOnLines.length > 0
  if (hasAddOnLines && issuedSelections.length === 0) {
    // A free ticket + add-ons order whose free claim went to another order has no
    // ticket left to carry the add-ons. Never sell add-ons alone: refund it.
    console.warn(`${logPrefix} no ticket left to carry the add-ons (free claim already used) — flagging for refund`, {
      orderId,
    })
    await supabase
      .from('pending_transactions')
      .update({ status: 'failed', failure_reason: 'already_claimed', needs_refund: true })
      .eq('order_id', orderId)
    await releaseSeatHold(pendingTx.seat_hold_id, { logPrefix })
    return { outcome: 'invalid_order', ticketId: null, reason: 'already_claimed' }
  }

  const eventCurrency =
    String(pendingTx.original_currency || pendingTx.currency || 'HTG').toUpperCase() === 'USD' ? 'USD' : 'HTG'
  const chargedCurrency = String(pendingTx.currency || 'HTG').toUpperCase() === 'USD' ? 'USD' : 'HTG'
  const fxRate = pendingTx.exchange_rate_used != null ? Number(pendingTx.exchange_rate_used) : null
  const fxBaseRate = pendingTx.exchange_rate_base != null ? Number(pendingTx.exchange_rate_base) : null
  const fxSpreadPercent =
    pendingTx.exchange_rate_spread_percent != null ? Number(pendingTx.exchange_rate_spread_percent) : null
  const fxProvider = pendingTx.exchange_rate_provider != null ? String(pendingTx.exchange_rate_provider) : null
  const fxFetchedAt = pendingTx.exchange_rate_fetched_at != null ? String(pendingTx.exchange_rate_fetched_at) : null
  // 'live' | 'snapshot_fallback' (lib/fx/usd-htg.ts) — which rule produced the rate.
  const fxSource = pendingTx.exchange_rate_source != null ? String(pendingTx.exchange_rate_source) : null

  // WHO paid the platform fee — read from the ORDER, which recorded it when the
  // buyer was charged (moncash-button/initiate and sogepay/initiate price pass-on
  // exactly like the card path). Never from the event's current, client-editable
  // `fee_incidence`: that could be flipped after the sale. An order without the
  // stamp (every order before pass-on reached the Haitian rails) charged the face
  // value only, so the organizer absorbed the fee.
  const orderBuyerFee = Number(pendingTx.buyer_fee || 0)
  const orderChargedBuyerFeeTotal =
    pendingTx.fee_incidence === 'buyer' && Number.isFinite(orderBuyerFee) && orderBuyerFee > 0 ? orderBuyerFee : 0
  // The add-ons' share of that fee rides on the first ticket with them; the
  // tickets split the rest exactly as before.
  const addOnFeeCharged =
    hasAddOnLines && orderChargedBuyerFeeTotal > 0
      ? Math.min(orderChargedBuyerFeeTotal, positiveAmount(pendingTx.add_ons_buyer_fee))
      : 0
  const orderChargedBuyerFee = Math.round((orderChargedBuyerFeeTotal - addOnFeeCharged) * 100) / 100
  const orderQuantityForFee = Math.max(1, issuedQuantity)
  /** The buyer fee carried by ONE ticket, in the charged currency. */
  const perTicketBuyerFee =
    orderChargedBuyerFee > 0 ? Math.round((orderChargedBuyerFee / orderQuantityForFee) * 100) / 100 : 0
  // The same fee in the EVENT currency (initiate records it as buyer_fee_original;
  // when nothing was converted the charged figure is already in it).
  const orderBuyerFeeOriginal = (() => {
    if (orderChargedBuyerFee <= 0) return 0
    const recorded = Number(pendingTx.buyer_fee_original)
    if (Number.isFinite(recorded) && recorded > 0) {
      const addOnShare = hasAddOnLines ? positiveAmount(pendingTx.add_ons_buyer_fee_original) : 0
      return Math.max(0, Math.round((recorded - addOnShare) * 100) / 100)
    }
    return eventCurrency === chargedCurrency ? orderChargedBuyerFee : 0
  })()
  /**
   * Server-only proof the buyer was charged the fee: ONE ticket's share of it,
   * in event-currency minor units (the units lib/payouts/availability.ts works
   * in). The payout engine honours a 'buyer' stamp off the Stripe rails only
   * with this > 0 (lib/payouts/fee-incidence.ts), so the organizer is not
   * charged the fee a second time. Clients cannot write it (firestore.rules).
   */
  const buyerFeeChargedMinor =
    orderBuyerFeeOriginal > 0 ? Math.max(1, Math.round((orderBuyerFeeOriginal * 100) / orderQuantityForFee)) : 0
  /** The add-ons' fee share, event-currency minor units: added to the first ticket's proof. */
  const addOnFeeOriginalMinor =
    addOnFeeCharged > 0
      ? Math.round(
          (positiveAmount(pendingTx.add_ons_buyer_fee_original) ||
            (eventCurrency === chargedCurrency ? addOnFeeCharged : 0)) * 100
        )
      : 0
  const feeIncidence: 'buyer' | 'organizer' =
    buyerFeeChargedMinor > 0 || addOnFeeOriginalMinor > 0 ? 'buyer' : 'organizer'

  // What the first ticket carries for the add-ons: each line's charge is its
  // face in the charge currency plus its share of the add-on fee, adding up to
  // exactly what the buyer paid for them, so the per-ticket refund returns them.
  const purchasedAddOns: PurchasedAddOn[] = hasAddOnLines
    ? purchasedAddOnsFor(
        orderAddOnLines.map((l) => ({ ...l, unitPrice: l.chargeUnitPrice })),
        { addOnFeeCents: Math.round(addOnFeeCharged * 100) }
      ).map((a, i) => ({
        ...a,
        // Face stays in the EVENT currency (what the organizer sold).
        unit_price: orderAddOnLines[i].unitPrice,
        face_total: Math.round(orderAddOnLines[i].unitPrice * orderAddOnLines[i].quantity * 100) / 100,
      }))
    : []
  const addOnFaceOriginal = hasAddOnLines
    ? Math.round(orderAddOnLines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0) * 100) / 100
    : 0
  const addOnChargedAmount = Math.round(purchasedAddOns.reduce((sum, a) => sum + a.charged_amount, 0) * 100) / 100
  const firstTicketId = orderTicketId(orderId, 0)
  /** Fields the add-ons put on one ticket of the order (none when it has no add-ons). */
  const addOnTicketFields = (
    index: number,
    base: { charged: number; buyerFee: number; buyerFeeMinor: number }
  ): Record<string, any> =>
    !hasAddOnLines
      ? {}
      : index === 0
        ? {
            add_ons: purchasedAddOns,
            add_ons_charged_amount: addOnChargedAmount,
            add_ons_face_total: addOnFaceOriginal,
            charged_amount: Math.round((base.charged + addOnChargedAmount) * 100) / 100,
            buyer_fee_charged_amount: Math.round((base.buyerFee + addOnFeeCharged) * 100) / 100,
            ...(addOnFeeOriginalMinor > 0 ? { buyer_fee_charged: base.buyerFeeMinor + addOnFeeOriginalMinor } : {}),
          }
        : { add_ons_ticket_id: firstTicketId }
  // Visit attribution stored on the order at initiate (already re-resolved there).
  // Orders created before attribution existed still carry their promoter code.
  const attribution = withResolvedPromoter(
    sanitizeAttribution(pendingTx.attribution),
    pendingTx.promoter_code || null
  )

  // Authoritative oversell gate, BEFORE any ticket is issued. The seats were HELD
  // at initiate (seat_hold_id) and the hold converts into a sale here; an order
  // without a usable hold (it expired, or the order predates seat holds) reserves
  // fresh, atomically. Keyed by the hold / order, so a retry never counts twice.
  // If it refuses, the order is paid but can't be honored — mark it for refund and
  // do NOT create tickets.
  const tierIncrements = buildTierSoldIncrements(issuedSelections)
  const reservationId = orderReservationId(pendingTx, orderId)
  const reservation = await convertSeatHold({
    eventId: String(pendingTx.event_id),
    quantity: issuedQuantity,
    tierIncrements,
    // Add-on stock held at initiate, converted in the same transaction.
    ...(hasAddOnLines
      ? { addOnIncrements: addOnIncrements(orderAddOnLines.map((l) => ({ addOnId: l.addOnId, quantity: l.quantity }))) }
      : {}),
    reservationId,
    logPrefix,
  })
  if (!reservation.ok && reservation.reason === 'busy') {
    // Contention, not a sell-out: nothing was reserved. Hand the claim back so the
    // callback retry / the reconcile cron fulfils it later — never issue unchecked.
    console.error(`${logPrefix} could not confirm seats for a paid order (contention); will retry`, { orderId })
    await releaseOrderClaim(orderId)
    return { outcome: 'confirming', ticketId: null, reason: 'inventory_busy' }
  }
  if (!reservation.ok) {
    console.error(`${logPrefix} capacity exceeded after payment — refusing to issue tickets`, {
      orderId,
      reason: reservation.reason,
      tierId: reservation.tierId,
      remaining: reservation.remaining,
    })
    await supabase
      .from('pending_transactions')
      .update({ status: 'failed', failure_reason: 'capacity_exceeded', needs_refund: true })
      .eq('order_id', orderId)
    // The order is refunded, never issued: hand back the free claim it took, so
    // the buyer may still claim their free ticket elsewhere.
    if (freeClaimDecision === 'kept') {
      await releaseUnusedFreeClaimForOrder(String(pendingTx.event_id), freeClaimant, orderId).catch((err: any) =>
        console.error(`${logPrefix} could not release the free-claim lock`, err?.message || err)
      )
    }
    return {
      outcome: 'capacity_exceeded',
      ticketId: null,
      capacity: { reason: reservation.reason, tierId: reservation.tierId, remaining: reservation.remaining },
    }
  }

  const createdTickets: any[] = []
  const createdFreeTicketIds: string[] = []
  // Position of the ticket within the order: its id is derived from it, so a
  // retry after a partial failure (or a stale-claim re-run) finds the tickets
  // already written and adopts them instead of issuing a second set.
  let ticketIndex = 0

  for (const selection of issuedSelections) {
    const selectionQty = selection.quantity || 0
    for (let i = 0; i < selectionQty; i++) {
      const thisIndex = ticketIndex++
      const ticketId = orderTicketId(orderId, thisIndex)
      const baseCharged = Math.round((Number(selection.unitPrice) + perTicketBuyerFee) * 100) / 100
      const addOnFields = addOnTicketFields(thisIndex, {
        charged: baseCharged,
        buyerFee: perTicketBuyerFee,
        buyerFeeMinor: buyerFeeChargedMinor,
      })
      const organizerUnitPrice = (() => {
        if (eventCurrency === 'USD') {
          const raw = selection.originalUnitPrice
          // A free (or promo-zeroed) line converts to 0 and is recorded as 0 — not
          // as the order's average, which would make a free ticket look paid.
          if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw
          const fallback = Number(pendingTx.original_amount || 0) / Math.max(1, issuedQuantity || 1)
          return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
        }
        return selection.unitPrice
      })()

      const ticketData = {
        event_id: pendingTx.event_id,
        attendee_id: pendingTx.user_id,
        attendee_name: attendee?.full_name || attendee?.email || 'Guest',
        price_paid: organizerUnitPrice,
        // WHO paid the platform fee, stamped from the PAYMENT (see feeIncidence),
        // with its server-only proof (see buyerFeeChargedMinor).
        fee_incidence: feeIncidence,
        buyer_fee_charged: buyerFeeChargedMinor,
        currency: eventCurrency,
        original_currency: eventCurrency,
        exchange_rate_used: fxRate,
        // What the buyer actually paid for this ticket: face + its share of any fee
        // passed on to them.
        charged_amount: Math.round((Number(selection.unitPrice) + perTicketBuyerFee) * 100) / 100,
        charged_currency: chargedCurrency,
        // The buyer service fee inside charged_amount, charged currency: a
        // refund returns the face value without it (lib/tickets/refundPlan.ts).
        buyer_fee_charged_amount: perTicketBuyerFee,
        payment_method: paymentMethod,
        funds_rail: fundsRail,
        payment_id: transactionId || orderId,
        // The inventory reservation this seat is counted under, so a refund can
        // give the seat back (lib/tickets/seatReturn).
        reservation_id: reservationId,
        // Promoter attribution: opaque ids only; the commission economics live in
        // the server-only promoter_sales ledger.
        promoter_id: pendingTx.promoter_id || null,
        promoter_code: pendingTx.promoter_code || null,
        ...ticketAttributionFields(attribution),
        status: 'valid',
        purchased_at: new Date().toISOString(),
        tier_name: selection.tierName || 'General Admission',
        tier_id: selection.tierId || '',
        start_datetime: eventDetails?.start_datetime || null,
        end_datetime: eventDetails?.end_datetime || null,
        event_date: eventDetails?.start_datetime || null,
        venue_name: eventDetails?.venue_name || null,
        city: eventDetails?.city || null,
        // Guest tickets carry the buyer's own contact details so support and refunds
        // can find the order by email or phone without a uid to join on.
        ...(guestRecipient
          ? {
              is_guest: true,
              guest_email: guestRecipient.email,
              guest_phone: guestRecipient.phone || null,
            }
          : {}),
        ...addOnFields,
      }

      const insertResult = await writeOrderTicket(ticketId, ticketData)

      if (insertResult.error) {
        console.error(`${logPrefix} failed to create ticket`, insertResult.error)
        // Keep the seats: the tickets already written hold some of them, and the
        // retry converts the same reservation idempotently, adopts the written
        // tickets (deterministic ids) and writes only the rest. Releasing here
        // let a written, scannable ticket's seat sell twice (audit, 2026-11-17).
        // Only the claim is released, so the retry can run.
        await releaseOrderClaim(orderId)
        return { outcome: 'ticket_creation_failed', ticketId: null }
      }

      const createdTicket = insertResult.data
      if (createdTicket) {
        createdTickets.push(createdTicket)
        if (isFreeSelection(selection)) createdFreeTicketIds.push(String(createdTicket.id))

        // Mirror into Firestore for organizer earnings and admin analytics.
        try {
          await adminDb.collection('tickets').doc(String(createdTicket.id)).set(
            {
              event_id: pendingTx.event_id,
              attendee_id: pendingTx.user_id,
              user_id: pendingTx.user_id,
              // Status deliberately NOT set here. This is a merge onto the
              // ticket the insert already created as 'valid', and writing
              // 'confirmed' downgraded it into a value the payout engine's
              // filter did not accept — which made these sales impossible to
              // withdraw. The mirror carries data, not status.
              ticket_type: selection.tierName || 'General Admission',
              tier_id: selection.tierId || '',
              price_paid: organizerUnitPrice,
              // WHO paid the platform fee, stamped from the PAYMENT (see feeIncidence),
              // with its server-only proof (see buyerFeeChargedMinor).
              fee_incidence: feeIncidence,
              buyer_fee_charged: buyerFeeChargedMinor,
              currency: eventCurrency,
              ...(guestRecipient
                ? {
                    is_guest: true,
                    guest_email: guestRecipient.email,
                    guest_phone: guestRecipient.phone || null,
                    attendee_name: guestRecipient.name,
                  }
                : {}),
              exchange_rate_used: fxRate,
              exchange_rate_base: fxBaseRate,
              exchange_rate_spread_percent: fxSpreadPercent,
              exchange_rate_provider: fxProvider,
              exchange_rate_fetched_at: fxFetchedAt,
              exchange_rate_source: fxSource,
              charged_amount: Math.round((Number(selection.unitPrice) + perTicketBuyerFee) * 100) / 100,
              charged_currency: chargedCurrency,
              buyer_fee_charged_amount: perTicketBuyerFee,
              payment_method: paymentMethod,
              funds_rail: fundsRail,
              payment_id: transactionId || orderId,
              promoter_id: pendingTx.promoter_id || null,
              promoter_code: pendingTx.promoter_code || null,
              ...ticketAttributionFields(attribution),
              purchased_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              // The add-on list itself is written once, with the ticket, so a
              // re-run never resets a picked-up flag.
              ...omitKey(addOnFields, 'add_ons'),
            },
            { merge: true }
          )
        } catch (e) {
          console.warn(`${logPrefix} failed to mirror ticket to Firestore`, {
            ticketId: createdTicket.id,
            message: (e as any)?.message,
          })
        }
      }
    }
  }

  // Record which tickets the free claim issued, so the claim can be shown void later
  // (a refunded free ticket frees the buyer's claim again).
  if (freeClaimDecision === 'kept' && createdFreeTicketIds.length > 0) {
    await recordFreeClaimTickets(String(pendingTx.event_id), freeClaimant, createdFreeTicketIds).catch((err: any) =>
      console.error(`${logPrefix} could not record free-claim tickets`, err?.message || err)
    )
  }

  // Redeem the promo code atomically (Firestore) — the SINGLE redemption point for any order
  // fulfilled through this shared pipeline (currently Sogepay). We hold the exclusive fulfillment
  // claim (claimOrderForFulfillment) from here on, so this runs exactly once per paid order.
  // pendingTx.promo_code_id is the resolved promo doc id, stamped at initiate only when a discount
  // was applied. If the "first N buyers" cap filled between initiate and confirm we keep the
  // issued tickets and only log the over-cap; redemption never throws.
  if (createdTickets.length > 0 && pendingTx.promo_code_id && (await takeOrderStep(orderId, 'promo'))) {
    try {
      const redeem = await redeemPromoInTransaction({
        promoId: String(pendingTx.promo_code_id),
        qty: issuedQuantity || createdTickets.length || 1,
        userId: pendingTx.user_id ? String(pendingTx.user_id) : null,
        // A guest's user_id on the order is minted per order, so it can't carry a
        // per-buyer cap; the email captured on the order can.
        buyerKey: promoBuyerKey({
          isGuest: Boolean(pendingTx.is_guest),
          id: pendingTx.user_id ? String(pendingTx.user_id) : null,
          email: pendingTx.guest_email,
          phone: pendingTx.guest_phone,
        }),
        eventId: pendingTx.event_id ? String(pendingTx.event_id) : null,
        discountApplied:
          pendingTx.promo_discount_total != null ? Number(pendingTx.promo_discount_total) : null,
      })
      if (redeem.capReached) {
        console.warn(`${logPrefix} promo cap reached at confirm; tickets kept, not over-counted`, {
          promoId: String(pendingTx.promo_code_id),
          eventId: pendingTx.event_id,
        })
      }
    } catch (promoErr) {
      console.error(`${logPrefix} promo redemption failed`, (promoErr as any)?.message)
    }
  }

  // Attribute the sale to its promoter — same exclusive fulfillment claim as the
  // promo redemption above; a bookkeeping failure never breaks the sale. The
  // recorded commission is withheld from the organizer's earnings below.
  let promoterCommissionCents = 0
  if (createdTickets.length > 0 && pendingTx.promoter_id) {
    const promoterSale = await recordPromoterSale({
      promoterId: String(pendingTx.promoter_id),
      eventId: String(pendingTx.event_id),
      ticketIds: createdTickets.map((t: any) => String(t.id)),
      quantity: issuedQuantity || createdTickets.length || 1,
      // Organizer-facing gross in event currency — same base as the earnings write.
      orderGrossCents: Math.round(Number(pendingTx.original_amount || pendingTx.amount || 0) * 100),
      currency: eventCurrency,
      paymentMethod,
      paymentId: transactionId || orderId,
      buyerUserId: pendingTx.is_guest ? null : pendingTx.user_id ? String(pendingTx.user_id) : null,
      buyerEmail: pendingTx.guest_email || attendee?.email || null,
    })
    if (promoterSale.recorded) promoterCommissionCents = promoterSale.commissionCents
  }

  // Count the order on its tracking link — idempotent per (link, order id), so a
  // gateway callback and the reconcile cron racing on one order count it once.
  if (createdTickets.length > 0) {
    await recordAttributedSale(attribution, {
      eventId: String(pendingTx.event_id),
      orderKey: orderId,
      quantity: issuedQuantity || createdTickets.length || 1,
      revenueCents:
        Math.round(Number(pendingTx.original_amount || pendingTx.amount || 0) * 100) + Math.round(addOnFaceOriginal * 100),
      currency: eventCurrency,
      paymentMethod,
    })
  }

  // Friend-invite credit (lib/invites): stamps invite_inviter_uid on the tickets
  // and the order. Never throws, never blocks; a guest has no account to credit.
  if (createdTickets.length > 0 && pendingTx.user_id && !pendingTx.is_guest && !isGuestId(pendingTx.user_id)) {
    await recordInvitePurchase({
      buyerUid: String(pendingTx.user_id),
      eventId: String(pendingTx.event_id),
      ticketIds: createdTickets.map((t: any) => String(t.id)),
      orderKey: orderId,
      orderRefs: async () => {
        const snap = await adminDb.collection('pending_transactions').where('order_id', '==', orderId).limit(1).get()
        return snap.docs.map((d: any) => d.ref)
      },
    })
  }

  // Update Firestore earnings in event currency — once per order, even when a
  // stale claim re-runs fulfilment (the step is taken BEFORE booking: a crash
  // in between under-counts, which an admin can see, rather than paying out twice).
  if (await takeOrderStep(orderId, 'earnings')) try {
    // Add-ons are part of what the organizer sold (event currency).
    const grossEventCents =
      Math.round(Number(pendingTx.original_amount || pendingTx.amount || 0) * 100) + Math.round(addOnFaceOriginal * 100)
    await addTicketToEarnings(pendingTx.event_id, grossEventCents, issuedQuantity || 1, {
      currency: eventCurrency,
      paymentMethod,
      chargedAmountCents: Math.round(Number(pendingTx.amount || 0) * 100),
      fxRate,
      chargedCurrency,
      // Pass-on: the buyer paid the fee on top, so the organizer nets the face value.
      feeIncidence,
      promoterCommissionCents,
    })
  } catch (e) {
    console.warn(`${logPrefix} failed to update earnings`, { message: (e as any)?.message })
  }

  const ticket = createdTickets[0]
    ? { ...createdTickets[0], event: eventDetails, attendee }
    : null

  // Mark the transaction completed.
  await supabase
    .from('pending_transactions')
    .update({
      status: 'completed',
      ticket_id: ticket?.id || null,
      transaction_id: transactionId || null,
      payer: params.payer || null,
      ...(params.completionFields || {}),
    })
    .eq('order_id', orderId)

  // NOTE: the seats were already converted / reserved up front by convertSeatHold (the oversell
  // gate), so we intentionally do NOT increment again here.

  // QR + buyer notifications (best-effort; never fail an already-paid order on notify errors).
  if (ticket?.id) {
    try {
      // Record the issued tickets against the guest order so the buyer's retrieval
      // link renders them.
      if (guestRecipient && pendingTx.guest_order_key) {
        await attachTicketsToGuestOrder(
          String(pendingTx.guest_order_key),
          createdTickets.map((t) => String(t.id))
        )
      }

      // In-app notifications need an account to land in; a guest has none.
      if (
        pendingTx.user_id &&
        !isGuestId(pendingTx.user_id) &&
        pendingTx.event_id &&
        eventDetails?.title
      ) {
        try {
          await notifyTicketPurchaseNotification(
            String(pendingTx.user_id),
            String(pendingTx.event_id),
            String(eventDetails.title),
            createdTickets.length || (pendingTx.quantity || 1)
          )
        } catch (error) {
          console.error(`${logPrefix} failed to send purchase notification`, error)
        }
      }

      // The organizer hears about MonCash/SogePay sales too (the card rail and
      // free claims already notify them). Guest buyers included: the audience
      // is the organizer, not the buyer.
      if (eventDetails?.organizer_id && pendingTx.event_id) {
        try {
          const paid = createdTickets.reduce((sum, t) => sum + (Number(t?.charged_amount) || 0), 0)
          await notifyOrganizerTicketSale(
            String(eventDetails.organizer_id),
            String(pendingTx.event_id),
            String(eventDetails.title || 'Event'),
            createdTickets.length || Number(pendingTx.quantity) || 1,
            Math.round(paid * 100) / 100,
            attendee?.full_name || undefined,
            chargedCurrency,
            pendingTx.user_id ? String(pendingTx.user_id) : null
          )
        } catch (error) {
          console.error(`${logPrefix} failed to notify the organizer`, error)
        }
      }

      // Sale-driven notifications: "filling fast" to people watching the event,
      // and the sales milestone to the organizer. Outside the block above on
      // purpose — these fire for GUEST purchases too, since the audience being
      // notified is other people, not the buyer.
      if (pendingTx.event_id) {
        await onSaleCompleted({
          eventId: String(pendingTx.event_id),
          buyerId: pendingTx.user_id ? String(pendingTx.user_id) : null,
        })
      }

      if (ticket.attendee && ticket.event) {
        await sendTicketConfirmation({
          ticketId: String(ticket.id),
          qrPayload: ticket.qr_code_data || ticket.id,
          event: ticket.event,
          recipient: {
            email: ticket.attendee.email,
            name: ticket.attendee.full_name,
            phone: ticket.attendee.phone,
            isGuest: isGuestOrder,
          },
          quantity: issuedQuantity || 1,
          guestToken: guestRecipient?.guestToken || null,
          ...(purchasedAddOns.length > 0 ? { addOns: purchasedAddOns.map(addOnLabel) } : {}),
          logPrefix,
        })
      }
    } catch (error) {
      console.error(`${logPrefix} post-fulfillment notification error`, error)
    }
  }

  return { outcome: 'fulfilled', ticketId: ticket?.id || null }
}

function positiveAmount(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function omitKey(obj: Record<string, any>, key: string): Record<string, any> {
  const rest = { ...obj }
  delete rest[key]
  return rest
}

/** One add-on line as stored on a MonCash order at initiate. */
export interface StoredAddOnLine {
  addOnId: string
  name: string
  option: string | null
  quantity: number
  /** Stored price, event currency. */
  unitPrice: number
  /** The same price in the charge currency (HTG). */
  chargeUnitPrice: number
}

/**
 * The add-on lines a pending order carries (`add_on_lines`, written by
 * /api/moncash-button/initiate from the event's stored add-ons). Junk lines are
 * dropped; an order without any reads as none.
 */
export function storedAddOnLines(order: Record<string, any> | null | undefined): StoredAddOnLine[] {
  const raw = order?.add_on_lines
  if (!Array.isArray(raw)) return []
  const out: StoredAddOnLine[] = []
  for (const l of raw) {
    const quantity = Number(l?.quantity)
    const unitPrice = Number(l?.unitPrice)
    const chargeUnitPrice = Number(l?.chargeUnitPrice ?? l?.unitPrice)
    if (!l?.addOnId || !Number.isInteger(quantity) || quantity <= 0) continue
    if (!(unitPrice > 0) || !(chargeUnitPrice > 0)) continue
    out.push({
      addOnId: String(l.addOnId),
      name: String(l.name || 'Add-on'),
      option: l.option ? String(l.option) : null,
      quantity,
      unitPrice,
      chargeUnitPrice,
    })
  }
  return out
}
