/**
 * Which events an organizer may DELETE: drafts that never sold anything.
 *
 * Organizers could edit a draft (an import they didn't want, a test) but had
 * no way to remove it, on web or in the app. Deleting is for drafts only: a
 * published event keeps its page, links and guests, and has Cancel (which
 * refunds and tells buyers, lib/events/cancel). Anything that ever had a
 * ticket of any kind, a printed batch, a door-team request, an add-on sale, an
 * order in flight, a seat hold or a money row keeps its record.
 *
 * Pure, so the matrix is unit-tested. The server collects the signals that
 * live outside the event doc (lib/events/draftDeleteServer) and the route
 * (app/api/events/[id]/delete-draft) has the last word. The Expo app keeps a
 * parity-tested copy in mobile/lib/draftDelete.ts (THIS file is that copy:
 * keep both in step; __tests__/draft-delete.test.ts compares them).
 */

export type DraftDeleteBlock =
  | 'not_found'
  | 'published'
  | 'cancelled'
  | 'frozen'
  | 'has_tickets'
  | 'has_add_ons'
  | 'has_guests'
  | 'has_printed'
  | 'has_door_team'
  | 'has_orders'
  | 'has_holds'
  | 'has_money'

/** What the server found outside the event doc (all optional: absent = none). */
export interface DraftDeleteSignals {
  /** Ticket docs of any status: paid, free, comp, guest, refunded, printed. */
  tickets?: number
  /** Sum of the tiers' sold_quantity counters. */
  soldOnTiers?: number
  /** Guest-list entries, attend requests and waitlist entries. */
  guests?: number
  /** Printed (physical) ticket batches, in any state. */
  printedBatches?: number
  /** Door-team service requests, in any state. */
  doorTeamRequests?: number
  /** MonCash / SogePay orders that did not fail, and sold seat reservations. */
  orders?: number
  /** Seat holds still live at checkout. */
  holds?: number
  /** Earnings, payout releases, withdrawals, promoter commissions. */
  moneyRows?: number
}

/** A draft: never published, and not in a terminal or live status. */
export function isDraftEvent(e: Record<string, any> | null | undefined): boolean {
  if (!e) return false
  if (e.is_published === true) return false
  const status = String(e.status || '').toLowerCase()
  return status === '' || status === 'draft' || status === 'pending' || status === 'unpublished'
}

const count = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Add-on units sold, from the event's rollup (events/{id}.add_ons_sold). */
function addOnsSold(e: Record<string, any>): number {
  const m = e.add_ons_sold
  if (!m || typeof m !== 'object') return 0
  return Object.values(m).reduce((s: number, v) => s + count(v), 0)
}

/** Why this event may not be deleted, or null when it may. */
export function draftDeleteBlock(
  e: Record<string, any> | null | undefined,
  s: DraftDeleteSignals = {},
): DraftDeleteBlock | null {
  if (!e) return 'not_found'
  const status = String(e.status || '').toLowerCase()
  if (status === 'cancelled' || status === 'canceled' || e.cancelled_at) return 'cancelled'
  if (e.payouts_frozen === true) return 'frozen'
  if (!isDraftEvent(e)) return 'published'
  if (count(e.tickets_sold) + count(s.tickets) + count(s.soldOnTiers) > 0) return 'has_tickets'
  if (addOnsSold(e) > 0) return 'has_add_ons'
  if (count(s.printedBatches) > 0) return 'has_printed'
  if (count(s.doorTeamRequests) > 0) return 'has_door_team'
  if (count(s.orders) > 0) return 'has_orders'
  if (count(s.holds) > 0) return 'has_holds'
  if (count(s.moneyRows) > 0) return 'has_money'
  if (count(s.guests) > 0) return 'has_guests'
  return null
}

/** Server-side English messages (the UI shows its own translated reason). */
export const DRAFT_DELETE_MESSAGES: Record<DraftDeleteBlock, string> = {
  not_found: 'Event not found.',
  published: 'Only drafts can be deleted. Unpublish it first, or cancel it if people have tickets.',
  cancelled: 'This event was cancelled and keeps its record.',
  frozen: 'This event is under review and cannot be deleted.',
  has_tickets: 'This draft has tickets, so it cannot be deleted.',
  has_add_ons: 'This draft has add-on sales, so it cannot be deleted.',
  has_guests: 'This draft has guests or requests, so it cannot be deleted.',
  has_printed: 'This draft has printed tickets, so it cannot be deleted.',
  has_door_team: 'This draft has a door team request, so it cannot be deleted.',
  has_orders: 'This draft has orders, so it cannot be deleted.',
  has_holds: 'Someone is checking out on this draft. Try again in a few minutes.',
  has_money: 'This draft has payments on record, so it cannot be deleted.',
}
