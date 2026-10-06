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

import { createClient } from '@/lib/firebase-db/server'
import { adminDb } from '@/lib/firebase/admin'
import {
  buildTierSoldIncrements,
  reserveInventoryAtomic,
  releaseInventoryReservation,
} from '@/lib/tickets/inventory'
import { addTicketToEarnings } from '@/lib/earnings'
import { sendTicketConfirmation } from '@/lib/tickets/confirmation'
import { notifyTicketPurchase as notifyTicketPurchaseNotification } from '@/lib/notifications/helpers'
import { onSaleCompleted } from '@/lib/notifications/campaigns'
import { promoBuyerKey, redeemPromoInTransaction } from '@/lib/promo-codes'
import { recordPromoterSale } from '@/lib/promoters'
import { sanitizeAttribution, ticketAttributionFields, withResolvedPromoter } from '@/lib/attribution'
import { recordAttributedSale } from '@/lib/tracking-links'
import { guestRecipientFromOrder } from '@/lib/guest/checkout'
import { attachTicketsToGuestOrder, isGuestId } from '@/lib/guest/identity'
import { validateStoredOrderLines } from '@/lib/tickets/purchasable'

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
    return { outcome: 'invalid_order', ticketId: null, reason: 'invalid_quantity' }
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

  // WHO paid the platform fee — read from the ORDER, which recorded it when the
  // buyer was charged (moncash-button/initiate and sogepay/initiate price pass-on
  // exactly like the card path). Never from the event's current, client-editable
  // `fee_incidence`: that could be flipped after the sale. An order without the
  // stamp (every order before pass-on reached the Haitian rails) charged the face
  // value only, so the organizer absorbed the fee.
  const orderBuyerFee = Number(pendingTx.buyer_fee || 0)
  const orderChargedBuyerFee =
    pendingTx.fee_incidence === 'buyer' && Number.isFinite(orderBuyerFee) && orderBuyerFee > 0 ? orderBuyerFee : 0
  const orderQuantityForFee = Math.max(1, Number(pendingTx.quantity || 1))
  /** The buyer fee carried by ONE ticket, in the charged currency. */
  const perTicketBuyerFee =
    orderChargedBuyerFee > 0 ? Math.round((orderChargedBuyerFee / orderQuantityForFee) * 100) / 100 : 0
  // The same fee in the EVENT currency (initiate records it as buyer_fee_original;
  // when nothing was converted the charged figure is already in it).
  const orderBuyerFeeOriginal = (() => {
    if (orderChargedBuyerFee <= 0) return 0
    const recorded = Number(pendingTx.buyer_fee_original)
    if (Number.isFinite(recorded) && recorded > 0) return recorded
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
  const feeIncidence: 'buyer' | 'organizer' = buyerFeeChargedMinor > 0 ? 'buyer' : 'organizer'
  // Visit attribution stored on the order at initiate (already re-resolved there).
  // Orders created before attribution existed still carry their promoter code.
  const attribution = withResolvedPromoter(
    sanitizeAttribution(pendingTx.attribution),
    pendingTx.promoter_code || null
  )

  // Authoritative oversell gate: atomically re-check capacity and reserve inventory BEFORE issuing
  // any tickets. Under load this is what actually prevents overselling (the initiate-time check is
  // only a fast-fail UX hint). If it refuses, the order is paid but can't be honored — mark it for
  // refund and do NOT create tickets.
  const tierIncrements = buildTierSoldIncrements(tierSelections)
  const reservation = await reserveInventoryAtomic({
    eventId: String(pendingTx.event_id),
    quantity: Number(pendingTx.quantity || 1),
    tierIncrements,
    logPrefix,
  })
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
    return {
      outcome: 'capacity_exceeded',
      ticketId: null,
      capacity: { reason: reservation.reason, tierId: reservation.tierId, remaining: reservation.remaining },
    }
  }

  const createdTickets: any[] = []

  for (const selection of tierSelections) {
    const selectionQty = selection.quantity || 0
    for (let i = 0; i < selectionQty; i++) {
      const organizerUnitPrice = (() => {
        if (eventCurrency === 'USD') {
          const raw = selection.originalUnitPrice
          if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
          const fallback = Number(pendingTx.original_amount || 0) / Math.max(1, pendingTx.quantity || 1)
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
        payment_id: transactionId || orderId,
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
      }

      const insertResult = await supabase.from('tickets').insert([ticketData]).select()

      if (insertResult.error) {
        console.error(`${logPrefix} failed to create ticket`, insertResult.error)
        // Return the inventory we reserved (above) and release the claim so a later retry can
        // re-reserve and re-attempt fulfillment for this paid order.
        await releaseInventoryReservation({
          eventId: String(pendingTx.event_id),
          quantity: Number(pendingTx.quantity || 1),
          tierIncrements,
          logPrefix,
        })
        await releaseOrderClaim(orderId)
        return { outcome: 'ticket_creation_failed', ticketId: null }
      }

      const createdTicket = insertResult.data?.[0]
      if (createdTicket) {
        await supabase.from('tickets').update({ qr_code_data: createdTicket.id }).eq('id', createdTicket.id)
        createdTicket.qr_code_data = createdTicket.id
        createdTickets.push(createdTicket)

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
              charged_amount: Math.round((Number(selection.unitPrice) + perTicketBuyerFee) * 100) / 100,
              charged_currency: chargedCurrency,
              buyer_fee_charged_amount: perTicketBuyerFee,
              payment_method: paymentMethod,
              payment_id: transactionId || orderId,
              promoter_id: pendingTx.promoter_id || null,
              promoter_code: pendingTx.promoter_code || null,
              ...ticketAttributionFields(attribution),
              purchased_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
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

  // Redeem the promo code atomically (Firestore) — the SINGLE redemption point for any order
  // fulfilled through this shared pipeline (currently Sogepay). We hold the exclusive fulfillment
  // claim (claimOrderForFulfillment) from here on, so this runs exactly once per paid order.
  // pendingTx.promo_code_id is the resolved promo doc id, stamped at initiate only when a discount
  // was applied. If the "first N buyers" cap filled between initiate and confirm we keep the
  // issued tickets and only log the over-cap; redemption never throws.
  if (createdTickets.length > 0 && pendingTx.promo_code_id) {
    try {
      const redeem = await redeemPromoInTransaction({
        promoId: String(pendingTx.promo_code_id),
        qty: Number(pendingTx.quantity || createdTickets.length || 1),
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
      quantity: Number(pendingTx.quantity || createdTickets.length || 1),
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
      quantity: Number(pendingTx.quantity || createdTickets.length || 1),
      revenueCents: Math.round(Number(pendingTx.original_amount || pendingTx.amount || 0) * 100),
      currency: eventCurrency,
      paymentMethod,
    })
  }

  // Update Firestore earnings in event currency.
  try {
    const grossEventCents = Math.round(Number(pendingTx.original_amount || pendingTx.amount || 0) * 100)
    await addTicketToEarnings(pendingTx.event_id, grossEventCents, Number(pendingTx.quantity || 1), {
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

  // NOTE: inventory was already incremented up front by reserveInventoryAtomic (the oversell gate),
  // so we intentionally do NOT increment again here.

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
          quantity: pendingTx.quantity || 1,
          guestToken: guestRecipient?.guestToken || null,
          logPrefix,
        })
      }
    } catch (error) {
      console.error(`${logPrefix} post-fulfillment notification error`, error)
    }
  }

  return { outcome: 'fulfilled', ticketId: ticket?.id || null }
}
