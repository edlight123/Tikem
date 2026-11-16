import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

/**
 * Undo a check-in: the ticket reads "not in" again and can be scanned anew.
 *
 * Check-ins feed payout review (check_in_method, scan rate), so an undo is
 * never silent: the ticket keeps who undid it, when and why, and an entry is
 * appended to `events/{id}/check_in_undos`. Only the event's owner side
 * (owner/admin/manager, or a platform admin) may call it; door staff cannot
 * take back an admission.
 *
 * A refund request that was auto-denied by the check-in stays denied: the
 * holder can ask again if they really did not attend.
 */

export const UNDO_REASONS = ['mistake', 'wrong_person', 'testing'] as const
export type UndoReason = (typeof UNDO_REASONS)[number]

export function parseUndoReason(v: unknown): UndoReason | null {
  return typeof v === 'string' && (UNDO_REASONS as readonly string[]).includes(v) ? (v as UndoReason) : null
}

export type UndoResult =
  | { ok: true; ticketId: string }
  | { ok: false; code: 'not_found' | 'wrong_event' | 'not_checked_in' }

export async function undoCheckIn(params: {
  eventId: string
  ticketId: string
  uid: string
  reason: UndoReason
}): Promise<UndoResult> {
  const { eventId, ticketId, uid, reason } = params
  const ticketRef = adminDb.collection('tickets').doc(ticketId)
  const eventRef = adminDb.collection('events').doc(eventId)

  const result = await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(ticketRef)
    if (!snap.exists) return { ok: false, code: 'not_found' } as UndoResult
    const t = snap.data() || {}
    if (String(t.event_id || '') !== eventId) return { ok: false, code: 'wrong_event' } as UndoResult
    if (!(t.checked_in === true || t.checked_in_at)) return { ok: false, code: 'not_checked_in' } as UndoResult

    tx.update(ticketRef, {
      checked_in: false,
      checked_in_at: null,
      checked_in_by: null,
      checked_in_via: null,
      check_in_method: null,
      entry_point: null,
      // A legacy path wrote status 'checked_in'; a live status again.
      ...(String(t.status || '').toLowerCase() === 'checked_in' ? { status: 'valid' } : {}),
      check_in_undone_at: FieldValue.serverTimestamp(),
      check_in_undone_by: uid,
      check_in_undo_reason: reason,
      updated_at: FieldValue.serverTimestamp(),
    })
    tx.set(eventRef.collection('check_in_undos').doc(), {
      ticket_id: ticketId,
      reason,
      undone_by: uid,
      undone_at: FieldValue.serverTimestamp(),
      was_checked_in_at: t.checked_in_at ?? null,
      was_checked_in_by: t.checked_in_by ?? null,
      was_method: t.check_in_method ?? null,
    })
    return { ok: true, ticketId } as UndoResult
  })

  // A guest-list guest carries its own checked_in flag, which the guest list
  // ORs with its tickets: clear it too or the guest still reads "in" there.
  if (result.ok) {
    try {
      const guests = await eventRef.collection('guests').where('ticket_ids', 'array-contains', ticketId).limit(5).get()
      await Promise.all(
        guests.docs
          .filter((g: any) => g.data()?.checked_in === true)
          .map((g: any) => g.ref.update({ checked_in: false, updated_at: FieldValue.serverTimestamp() }))
      )
    } catch (error) {
      console.error('[undoCheckIn] guest flag clear failed', error)
    }
  }
  return result
}
