/**
 * Server side of add-ons after purchase: what the door hands over, the
 * "picked up" toggle, and the organizer's sales summary.
 *
 * The add-ons of an order live on its first ticket (`add_ons`); every other
 * ticket of the order points at it (`add_ons_ticket_id`). Tickets are never
 * written by a client (firestore.rules), so the pickup toggle is a door route
 * on the Admin SDK, inside a transaction.
 */
import { adminDb } from '@/lib/firebase/admin'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { summarizeAddOnSales, ticketAddOns, type AddOnSalesSummary, type PurchasedAddOn } from '@/lib/addons/addOns'

export interface DoorAddOn {
  index: number
  id: string
  name: string
  option: string | null
  quantity: number
  pickedUp: boolean
  pickedUpAt: string | null
}

export interface OrderAddOns {
  /** The ticket that carries the order's add-ons. */
  ticketId: string
  items: DoorAddOn[]
}

/** A refunded / cancelled first ticket gave its add-ons back; a checked-in one still owes them. */
function addOnsStillOwed(ticket: Record<string, any>): boolean {
  const status = String(ticket?.status || '').toLowerCase()
  if (['refunded', 'cancelled', 'canceled', 'refund_pending', 'transferred'].includes(status)) return false
  return isLiveTicketStatus(status) || ticket?.checked_in === true
}

export function doorAddOns(addOns: PurchasedAddOn[]): DoorAddOn[] {
  return addOns.map((a, index) => ({
    index,
    id: a.id,
    name: a.name,
    option: a.option,
    quantity: a.quantity,
    pickedUp: Boolean(a.picked_up_at),
    pickedUpAt: a.picked_up_at || null,
  }))
}

/** The ticket that carries this ticket's order add-ons (itself, or its order's first ticket). */
function carrierIdOf(ticketId: string, ticket: Record<string, any>): string | null {
  if (ticketAddOns(ticket).length > 0) return ticketId
  const pointer = String(ticket?.add_ons_ticket_id || '').trim()
  return pointer || null
}

/**
 * The add-ons to hand over for a scanned ticket, or null when its order has
 * none. Only for a ticket of `eventId` (never leaks another event's order).
 */
export async function orderAddOnsForTicket(eventId: string, ticketId: string): Promise<OrderAddOns | null> {
  if (!ticketId) return null
  const snap = await adminDb.collection('tickets').doc(String(ticketId)).get()
  if (!snap.exists) return null
  const ticket = snap.data() || {}
  if (String(ticket.event_id || '') !== String(eventId)) return null
  const carrierId = carrierIdOf(String(ticketId), ticket)
  if (!carrierId) return null
  const carrier =
    carrierId === String(ticketId) ? ticket : (await adminDb.collection('tickets').doc(carrierId).get()).data() || null
  if (!carrier || String(carrier.event_id || '') !== String(eventId)) return null
  // A refunded first ticket gave its add-ons back: nothing to hand over.
  if (!addOnsStillOwed(carrier)) return null
  const items = doorAddOns(ticketAddOns(carrier))
  return items.length > 0 ? { ticketId: carrierId, items } : null
}

export type PickupResult =
  | { ok: true; order: OrderAddOns }
  | { ok: false; status: number; error: string; code: string }

/** Mark one add-on line handed over (or not). Idempotent; transactional. */
export async function setAddOnPickedUp(params: {
  eventId: string
  ticketId: string
  index: number
  pickedUp: boolean
  uid: string
}): Promise<PickupResult> {
  const { eventId, index } = params
  if (!Number.isInteger(index) || index < 0 || index > 50) {
    return { ok: false, status: 400, error: 'Invalid add-on.', code: 'invalid_index' }
  }
  const first = await adminDb.collection('tickets').doc(String(params.ticketId)).get()
  if (!first.exists) return { ok: false, status: 404, error: 'Ticket not found.', code: 'not_found' }
  const firstData = first.data() || {}
  if (String(firstData.event_id || '') !== String(eventId)) {
    return { ok: false, status: 404, error: 'Ticket not found.', code: 'not_found' }
  }
  const carrierId = carrierIdOf(String(params.ticketId), firstData)
  if (!carrierId) return { ok: false, status: 404, error: 'This order has no add-ons.', code: 'no_add_ons' }
  const ref = adminDb.collection('tickets').doc(carrierId)

  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { ok: false, status: 404, error: 'Ticket not found.', code: 'not_found' } as PickupResult
    const ticket = snap.data() || {}
    if (String(ticket.event_id || '') !== String(eventId)) {
      return { ok: false, status: 404, error: 'Ticket not found.', code: 'not_found' } as PickupResult
    }
    const raw: any[] = Array.isArray(ticket.add_ons) ? ticket.add_ons.map((a: any) => ({ ...a })) : []
    if (!raw[index]) return { ok: false, status: 404, error: 'Add-on not found.', code: 'not_found' } as PickupResult
    if (String(ticket.status || '').toLowerCase() === 'refunded') {
      return { ok: false, status: 409, error: 'This order was refunded.', code: 'refunded' } as PickupResult
    }
    const nowIso = new Date().toISOString()
    raw[index] = params.pickedUp
      ? { ...raw[index], picked_up_at: raw[index].picked_up_at || nowIso, picked_up_by: raw[index].picked_up_by || params.uid }
      : { ...raw[index], picked_up_at: null, picked_up_by: null }
    tx.update(ref, { add_ons: raw, updated_at: nowIso })
    return { ok: true, order: { ticketId: carrierId, items: doorAddOns(ticketAddOns({ add_ons: raw })) } } as PickupResult
  })
}

/** Add-on sales for the organizer dashboard, from the event's tickets. */
export async function addOnSalesForEvent(eventId: string): Promise<AddOnSalesSummary> {
  const docs = await loadTicketDocsForEvent(String(eventId))
  const tickets = docs.map((d: any) => d.data() || {})
  return summarizeAddOnSales(tickets, addOnsStillOwed)
}
