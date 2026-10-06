import { adminDb } from '@/lib/firebase/admin'
import { findEventEarningsDocInTransaction } from '@/lib/earnings'
import { loadEventAvailabilityInput } from '@/lib/payouts/availability-server'
import { computeEventAvailability, type EventAvailabilityInput } from '@/lib/payouts/availability'
import { refundFaceAmount } from '@/lib/tickets/refundPlan'

/**
 * THE REFUND GATE: can the organizer's remaining money with Tikèm cover this
 * refund, or would Tikèm be paying it out of its own pocket?
 *
 * Owner decision (2026-10): when a refund of Tikèm-held money (platform Stripe,
 * MonCash, NatCash, SogePay) is larger than what the organizer still has
 * unwithdrawn for the event, it goes to a Tikèm admin for review instead of
 * being funded silently. computeEventAvailability floors every balance at 0, so
 * before this gate a refund after a withdrawal simply came out of Tikèm's funds.
 *
 * Not gated (the caller skips this):
 *   - event cancellation: the buyer is refunded regardless
 *   - Stripe destination charges: reverse_transfer pulls the money back out of
 *     the organizer's own Stripe balance, never Tikèm's
 *
 * Everything is in the EVENT currency, minor units. Availability is computed
 * from face values in the event currency, so a card refund charged in USD for an
 * HTG event is never compared in USD.
 *
 * What the refund costs the organizer is the drop in their ceiling (the shared
 * "what Tikèm owes this organizer for this event" figure) when this ticket goes
 * from live to refunding: its face, less the share of the platform fee Tikèm
 * gives up on a refunded ticket. The shortfall is how much of that cost is not
 * covered by what is still unwithdrawn:
 *
 *   deficit(x)  = max(0, withdrawn − ceilingRaw(x))
 *   shortfall   = deficit(after) − deficit(before)
 *
 * "before" treats the ticket as live with NO pending request: a buyer request
 * already holds the ticket's net out of the ceiling, and counting that hold as
 * "before" would make a refund requested after a withdrawal look covered.
 * Unfloored ceilings are used so an organizer already in deficit still has the
 * whole cost of a new refund counted.
 */

export type RefundCoverage = {
  currency: string
  /** This ticket's face value, event currency (refundFaceAmount). */
  faceMinor: number
  /** What the refund takes out of the organizer's ceiling (face less fee Tikèm gives up). */
  organizerCostMinor: number
  /** What the organizer still had unwithdrawn for the event before this refund. */
  coverageMinor: number
  /** The part of organizerCostMinor Tikèm would be funding. 0 = covered. */
  shortfallMinor: number
  /** withdrawnAmount on the ledger row, as read inside the claim transaction. */
  withdrawnMinor: number
}

/**
 * Pure: the coverage of ONE ticket's refund, given the availability facts with
 * the tickets and the primary ledger row's withdrawn amount as read inside the
 * caller's transaction.
 */
export function computeRefundCoverage(
  input: EventAvailabilityInput,
  ticketId: string,
  primaryWithdrawnMinor: number
): RefundCoverage {
  const tickets = input.tickets || []
  const ticket = tickets.find((t) => String(t?.id) === String(ticketId)) || null
  const primary = Math.max(0, Math.round(Number(primaryWithdrawnMinor) || 0))

  // The ledger as the transaction saw it: the primary row's withdrawn amount is
  // replaced, the other (duplicate) rows keep what the loader read.
  const ledger = input.ledger
    ? (() => {
        const loadedPrimary =
          input.ledger.primaryWithdrawnMinor != null ? input.ledger.primaryWithdrawnMinor : input.ledger.withdrawnMinor
        const others = Math.max(0, (Number(input.ledger.withdrawnMinor) || 0) - (Number(loadedPrimary) || 0))
        return { ...input.ledger, withdrawnMinor: others + primary, primaryWithdrawnMinor: primary }
      })()
    : primary > 0
      ? { withdrawnMinor: primary, primaryWithdrawnMinor: primary }
      : null

  const withTicket = (patch: Record<string, any>) =>
    tickets.map((t) => (String(t?.id) === String(ticketId) ? { ...t, ...patch } : t))

  // release: null - the ceiling does not depend on release timing.
  const before = computeEventAvailability({ ...input, ledger, release: null, tickets: withTicket({ refund_status: null }) })
  const after = computeEventAvailability({
    ...input,
    ledger,
    release: null,
    tickets: withTicket({ refund_status: 'processing' }),
  })

  const deficit = (ceilingRaw: number) => Math.max(0, primary - ceilingRaw)
  const shortfallMinor = Math.max(0, deficit(after.ceilingRawMinor) - deficit(before.ceilingRawMinor))
  return {
    currency: before.currency,
    faceMinor: ticket ? Math.round(refundFaceAmount(ticket) * 100) : 0,
    organizerCostMinor: Math.max(0, before.ceilingRawMinor - after.ceilingRawMinor),
    coverageMinor: Math.max(0, before.ceilingRawMinor - primary),
    shortfallMinor,
    withdrawnMinor: primary,
  }
}

/**
 * Loaded OUTSIDE the claim transaction: everything availability needs except
 * the two facts that race (tickets, withdrawn), which readInTransaction reads.
 */
export type RefundCoverageContext = {
  eventId: string
  input: EventAvailabilityInput
}

export async function loadRefundCoverageContext(eventId: string): Promise<RefundCoverageContext> {
  const input = await loadEventAvailabilityInput({ eventId })
  if (!input) throw new Error('event_not_found')
  return { eventId, input }
}

/**
 * Inside the claim transaction (reads only, before any write): re-read the
 * event's tickets and the ledger row withdrawals debit, then judge. A
 * withdrawal that debited first is seen here; one that commits after has its
 * own transaction conflict on the ledger row this read.
 */
export async function coverageInTransaction(
  tx: any,
  ctx: RefundCoverageContext,
  ticketId: string,
  ticketData: Record<string, any>
): Promise<RefundCoverage> {
  const ticketsSnap = await tx.get(adminDb.collection('tickets').where('event_id', '==', ctx.eventId))
  const tickets: Array<{ id: string; [k: string]: any }> = (ticketsSnap?.docs || []).map((d: any) => ({
    id: String(d.id),
    ...((d.data && d.data()) || {}),
  }))
  // The ticket as THIS transaction read it, whatever the query returned.
  const idx = tickets.findIndex((t) => t.id === ticketId)
  if (idx >= 0) tickets[idx] = { id: ticketId, ...ticketData }
  else tickets.push({ id: ticketId, ...ticketData })

  const ledgerRow = await findEventEarningsDocInTransaction(tx, ctx.eventId)
  const withdrawn = Math.max(0, Number(ledgerRow?.data?.withdrawnAmount || 0) || 0)
  return computeRefundCoverage({ ...ctx.input, tickets }, ticketId, withdrawn)
}
