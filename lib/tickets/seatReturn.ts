/**
 * A refunded ticket gives its seat back (payment audit, 2026-11-17).
 *
 * Seats are counted on the sharded inventory (lib/tickets/inventoryShards),
 * per reservation: one order's reservation holds all its seats. A refund used to
 * leave that seat counted as sold forever, so a refunded seat could never be
 * sold again. This releases ONE seat (event bucket + the ticket's tier) from
 * the order's reservation.
 *
 * Exactly once per ticket: the ticket is stamped `seat_returned_at` in a
 * transaction BEFORE the seat is released. A crash in between undersells by
 * one seat (recoverable); it can never release twice. Never throws.
 */
import { adminDb } from '@/lib/firebase/admin'
import { releaseSeats } from '@/lib/tickets/inventoryShards'
import { addOnIncrements, ticketAddOns } from '@/lib/addons/addOns'

// Same derivations as lib/tickets/fulfillment (orderReservationId) and
// lib/tickets/stripe-fulfillment (stripeOrderDocId / stripeReservationId),
// repeated here so the refund code does not import the fulfilment pipelines.
const HOLD_ID = /^hold_[a-f0-9]{32}$/
const stripeOrderDocId = (paymentId: string) => String(paymentId).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 1400)
const stripeReservationId = (_m: unknown, paymentId: string) => `stripe_${stripeOrderDocId(paymentId)}`
const orderReservationId = (order: { seat_hold_id?: unknown }, orderId: string) => {
  const hold = String(order?.seat_hold_id || '')
  return HOLD_ID.test(hold) ? hold : `order_${String(orderId).replace(/[^A-Za-z0-9_-]/g, '_')}`
}

/** The order reservation a ticket's seat was counted under, or null when unknown. */
export async function reservationIdForTicket(ticket: Record<string, any>): Promise<string | null> {
  if (ticket.reservation_id) return String(ticket.reservation_id)
  const paymentId = String(ticket.payment_id || '').trim()
  if (!paymentId) return null
  const method = String(ticket.payment_method || '').toLowerCase()

  if (method.startsWith('stripe') || method === 'card' || paymentId.startsWith('pi_') || paymentId.startsWith('cs_')) {
    const snap = await adminDb.collection('stripe_orders').doc(stripeOrderDocId(paymentId)).get()
    const data: any = snap.exists ? snap.data() || {} : null
    const recorded = data?.steps?.inventory?.reservation_id
    if (recorded) return String(recorded)
    return data ? stripeReservationId({}, paymentId) : null
  }

  // Mobile money: payment_id is the gateway transaction id, else the order id.
  for (const field of ['order_id', 'transaction_id']) {
    const q = await adminDb.collection('pending_transactions').where(field, '==', paymentId).limit(1).get()
    if (!q.empty) {
      const order = q.docs[0].data() || {}
      return orderReservationId(order, String(order.order_id || paymentId))
    }
  }
  return null
}

export async function returnSeatForRefundedTicket(
  ticketId: string,
  opts: { logPrefix?: string } = {}
): Promise<'returned' | 'already' | 'skipped'> {
  const logPrefix = opts.logPrefix || '[seat-return]'
  try {
    const ref = adminDb.collection('tickets').doc(String(ticketId))
    const snap = await ref.get()
    if (!snap.exists) return 'skipped'
    const ticket = snap.data() || {}
    if (ticket.seat_returned_at) return 'already'
    if (String(ticket.status || '').toLowerCase() !== 'refunded') return 'skipped'

    const reservationId = await reservationIdForTicket(ticket)
    if (!reservationId) return 'skipped'

    const claimed = await adminDb.runTransaction(async (tx: any) => {
      const cur = await tx.get(ref)
      if (!cur.exists || cur.data()?.seat_returned_at) return false
      tx.set(ref, { seat_returned_at: new Date().toISOString(), seat_reservation_id: reservationId }, { merge: true })
      return true
    })
    if (!claimed) return 'already'

    const tierId = String(ticket.tier_id || '').trim()
    // The order's first ticket carries its add-ons (lib/addons/addOns.ts): a
    // refund of it returns them, so their stock goes back too.
    const addOns = addOnIncrements(ticketAddOns(ticket).map((a) => ({ addOnId: a.id, quantity: a.quantity })))
    const res = await releaseSeats({
      reservationId,
      quantity: 1,
      tierIncrements: tierId ? [{ tierId, quantity: 1 }] : [],
      ...(addOns.length > 0 ? { addOnIncrements: addOns } : {}),
      logPrefix,
    })
    if (!res.released) {
      console.warn(`${logPrefix} seat not released`, { ticketId, reservationId, state: res.state, error: res.error })
    }
    return 'returned'
  } catch (err: any) {
    console.error(`${logPrefix} could not return the seat of a refunded ticket`, { ticketId, message: err?.message })
    return 'skipped'
  }
}
