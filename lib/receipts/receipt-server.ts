/**
 * Server side of buyer receipts: load an order's tickets, event and organizer
 * and build the model (lib/receipts/receipt.ts).
 *
 * Who the buyer is: the account ids on the order's tickets that were never
 * transferred (a transfer rewrites attendee_id AND user_id to the recipient,
 * who must not see what the original buyer paid for the whole order).
 */
import { adminDb } from '@/lib/firebase/admin'
import { orgDisplayName } from '@/lib/organizer/context'
import { buildReceipt, type ReceiptModel, type ReceiptTicket } from './receipt'

export interface LoadedReceipt {
  model: ReceiptModel
  /** Account uids that bought the order (for access checks). */
  buyerIds: string[]
  organizerId: string | null
}

/** Buyer uids from an order's ticket docs (pure, tested). */
export function receiptBuyerIds(tickets: Array<Record<string, any>>): string[] {
  const ids = tickets
    .filter((t) => !(Number(t.transfer_count) > 0))
    .flatMap((t) => [t.attendee_id, t.user_id, t.buyer_id, t.purchaser_id])
    .filter((v) => typeof v === 'string' && v && !v.startsWith('guest_'))
    .map(String)
  return Array.from(new Set(ids))
}

/** Null when there is no paid order with that id. */
export async function loadReceipt(paymentId: string): Promise<LoadedReceipt | null> {
  const id = String(paymentId || '').trim()
  if (!id || id.length > 200) return null
  const ticketSnap = await adminDb.collection('tickets').where('payment_id', '==', id).limit(120).get()
  const tickets: ReceiptTicket[] = ticketSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
  if (tickets.length === 0) return null

  const eventId = String(tickets[0]?.event_id || '')
  const eventSnap = eventId ? await adminDb.collection('events').doc(eventId).get() : null
  const event = eventSnap?.exists ? eventSnap.data() || {} : null
  const organizerId = String(event?.organizer_id || '') || null
  const organizerName = organizerId ? await orgDisplayName(organizerId).catch(() => '') : ''

  const model = buildReceipt({ paymentId: id, tickets, event, organizerName })
  if (!model) return null
  return { model, buyerIds: receiptBuyerIds(tickets), organizerId }
}
