import { adminDb } from '@/lib/firebase/admin'
import {
  eventEndsAt,
  isRefundInFlight,
  isRefundedTicket,
  ticketPriceMinor,
  ticketPurchasedAt,
  toDateOrNull,
} from '@/lib/payouts/availability'
import { isLiveTicketStatus } from '@/lib/tickets/status'

/**
 * "Completed events" for the release ladder's ESTABLISHED tier (fewer hold hours).
 *
 * This used to count every non-cancelled event whose `end_datetime` had passed.
 * That field is organizer-editable, so three zero-sale drafts backdated to last
 * week made a brand-new organizer "established" and shortened their hold. An event
 * now counts only when it was PUBLISHED, still stands (not cancelled or frozen),
 * sold at least one PAID ticket that is still live, and has ended by its effective
 * end: the later of the doc's end and what the server-stamped tickets say (their
 * end/start as sold, and the purchase time). Backdating the doc therefore cannot
 * make an event with recent sales look over.
 */

/** Most recent ended-looking events whose tickets are read per call. */
const MAX_EVENTS_CHECKED = 25

const TICKET_FIELDS = [
  'status',
  'refund_status',
  'price_paid',
  'pricePaid',
  'end_datetime',
  'start_datetime',
  'event_date',
  'purchased_at',
  'purchasedAt',
  'created_at',
  'createdAt',
]

function eventStillStands(event: Record<string, any>): boolean {
  if (event.is_published !== true) return false
  if (String(event.status || '').toLowerCase() === 'cancelled' || event.cancelled_at) return false
  if (event.payouts_frozen === true) return false
  return true
}

/** Pure: does this event (with its tickets) count as a completed, paid event at `now`? */
export function isCompletedPaidEvent(
  event: Record<string, any>,
  tickets: Array<Record<string, any>>,
  now: Date
): boolean {
  if (!eventStillStands(event)) return false
  const docEnd = eventEndsAt(event)
  // No end date: not shown to have happened.
  if (!docEnd) return false

  let effectiveEnd = docEnd.getTime()
  let paidLive = false
  for (const ticket of tickets) {
    for (const moment of [
      toDateOrNull(ticket.end_datetime),
      toDateOrNull(ticket.start_datetime ?? ticket.event_date),
      ticketPurchasedAt(ticket),
    ]) {
      if (moment && moment.getTime() > effectiveEnd) effectiveEnd = moment.getTime()
    }
    if (
      ticketPriceMinor(ticket) > 0 &&
      isLiveTicketStatus(ticket.status) &&
      !isRefundedTicket(ticket) &&
      !isRefundInFlight(ticket)
    ) {
      paidLive = true
    }
  }
  return paidLive && effectiveEnd <= now.getTime()
}

/** Ids of the organizer's completed, paid events (see above). */
export async function loadCompletedPaidEventIds(organizerId: string, now: Date = new Date()): Promise<Set<string>> {
  const eventsSnap = await adminDb
    .collection('events')
    .where('organizer_id', '==', organizerId)
    .select('end_datetime', 'endDateTime', 'status', 'is_published', 'cancelled_at', 'payouts_frozen')
    .get()

  // Cheap pre-filter on the doc alone: the effective end is never before the doc's.
  const candidates = eventsSnap.docs
    .map((doc: any) => ({ id: String(doc.id), data: (doc.data() || {}) as Record<string, any> }))
    .filter(({ data }: { data: Record<string, any> }) => {
      const end = eventEndsAt(data)
      return eventStillStands(data) && !!end && end.getTime() <= now.getTime()
    })
    .sort(
      (a: { data: Record<string, any> }, b: { data: Record<string, any> }) =>
        (eventEndsAt(b.data)?.getTime() ?? 0) - (eventEndsAt(a.data)?.getTime() ?? 0)
    )
    .slice(0, MAX_EVENTS_CHECKED)

  const completed = new Set<string>()
  await Promise.all(
    candidates.map(async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const ticketsSnap = await adminDb
        .collection('tickets')
        .where('event_id', '==', id)
        .select(...TICKET_FIELDS)
        .get()
      const tickets = ticketsSnap.docs.map((d: any) => (d.data() || {}) as Record<string, any>)
      if (isCompletedPaidEvent(data, tickets, now)) completed.add(id)
    })
  )
  return completed
}
