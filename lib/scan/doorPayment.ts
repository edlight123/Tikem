// Marking a pay-at-the-door ticket paid: door staff take the cash
// and tap "Mark paid". Tikem never handles the money; this only records it, on
// door_* fields, never price_paid, so no fee, ledger or payout path sees it.
// Server-side only (Admin SDK): the tickets rules never let a client write it.

import { adminDb } from '@/lib/firebase/admin'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { toDoorRow, type DoorRow } from '@/lib/scan/doorRules'

export type DoorPaymentCode = 'not_door_ticket' | 'not_live' | 'not_found' | 'wrong_event'

/**
 * The write for one tap, or null when there is nothing to change. Idempotent:
 * a second "paid" from another phone keeps the first record (who and when).
 */
export function doorPaymentPatch(
  ticket: Record<string, any>,
  opts: { paid: boolean; staffUid: string; now: string }
): { ok: true; patch: Record<string, any> | null } | { ok: false; code: DoorPaymentCode } {
  if (ticket?.payment_method !== 'pay_at_door') return { ok: false, code: 'not_door_ticket' }
  if (!isLiveTicketStatus(ticket.status)) return { ok: false, code: 'not_live' }
  const already = ticket.door_paid === true
  if (opts.paid) {
    if (already) return { ok: true, patch: null }
    return {
      ok: true,
      patch: {
        door_paid: true,
        door_amount: Number(ticket.door_price) || 0,
        door_paid_at: opts.now,
        door_paid_by: opts.staffUid,
        updated_at: opts.now,
      },
    }
  }
  if (!already) return { ok: true, patch: null }
  return { ok: true, patch: { door_paid: false, door_amount: null, door_paid_at: null, door_paid_by: null, updated_at: opts.now } }
}

/** Apply one tap in a transaction, so two phones at the door cannot race. */
export async function markDoorPaid(params: {
  eventId: string
  ticketId: string
  staffUid: string
  paid: boolean
}): Promise<{ ok: true; row: DoorRow } | { ok: false; code: DoorPaymentCode }> {
  const ref = adminDb.collection('tickets').doc(params.ticketId)
  return adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return { ok: false as const, code: 'not_found' as const }
    const ticket = (snap.data() || {}) as Record<string, any>
    if (String(ticket.event_id) !== String(params.eventId)) return { ok: false as const, code: 'wrong_event' as const }
    const res = doorPaymentPatch(ticket, { paid: params.paid, staffUid: params.staffUid, now: new Date().toISOString() })
    if (!res.ok) return res
    if (res.patch) tx.update(ref, res.patch)
    return { ok: true as const, row: toDoorRow(snap.id, { ...ticket, ...(res.patch || {}) }) }
  })
}
