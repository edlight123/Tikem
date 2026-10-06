import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { ticketQrVersionOf } from '@/lib/scan/doorRules'
import { verifyScannedTicketCode } from '@/lib/tickets/qr'

/**
 * Why the scanned code itself refuses entry, or null when it is the ticket's
 * current code (lib/tickets/qr.ts). A scan with no raw code is judged as a
 * legacy bare id, so a ticket that has changed hands only admits by its new
 * signed code or by a manual pick.
 */
function codeBlockReason(
  ticketId: string,
  ticketData: Record<string, any>,
  code: string | null | undefined,
  method: 'scan' | 'manual'
): 'TRANSFERRED' | 'INVALID_CODE' | null {
  if (code && String(code).trim()) {
    const check = verifyScannedTicketCode(code, ticketId, ticketData)
    return check === 'OK' ? null : check
  }
  if (method === 'scan' && ticketQrVersionOf(ticketData) >= 1) return 'TRANSFERRED'
  return null
}

/**
 * The name the door sees — a NAME, never a contact detail.
 *
 * The ticket document is the authority — it already carries `attendee_name`, stamped
 * at issuance. That matters for GUEST tickets, whose `attendee_id` is a `guest_…` id
 * with no `users/{id}` document behind it: without this, every guest would scan in as
 * a nameless "Guest". The user lookup remains as the fallback for older account
 * tickets that were written before the name was denormalized onto them.
 *
 * Door staff may hold check-in permission WITHOUT viewAttendees, so this used to
 * leak the buyer's email (profile email, then guest_email) whenever no name was
 * on file. It no longer falls back to any address: no name means "Guest".
 */
async function resolveAttendeeName(ticketData: any): Promise<string> {
  const onTicket = String(ticketData?.attendee_name || '').trim()
  if (onTicket) return onTicket

  const attendeeId = ticketData?.attendee_id
  if (attendeeId && !String(attendeeId).startsWith('guest_')) {
    const userDoc = await adminDb.collection('users').doc(String(attendeeId)).get()
    if (userDoc.exists) {
      const name = String(userDoc.data()?.full_name || '').trim()
      if (name) return name
    }
  }

  return 'Guest'
}

/**
 * Why this ticket must NOT be admitted, or null when its status admits it.
 *
 * An ALLOWLIST (lib/tickets/status isLiveTicketStatus: valid | confirmed | active,
 * or a legacy empty status), not a denylist: the old checks named refunded,
 * cancelled and pending one by one, so `refund_pending` — a mobile-money ticket
 * already voided and queued for a refund — walked straight in. A ticket whose
 * refund is in flight or done (refund_status processing / approved /
 * manual_required / admin_review) is refused too, even if its status has not
 * caught up yet. admin_review is a refund waiting on a Tikèm admin: the buyer
 * asked for (or was promised) their money back, so the ticket must not also
 * be used.
 *
 * A status of `checked_in` is passed through: the caller's already-checked-in
 * branch answers it.
 *
 * Shared by the normal scan and the re-entry override, so the override can never
 * re-admit a refunded or cancelled ticket.
 */
export function ticketBlockReason(
  ticketData: Record<string, any>
): 'REFUNDED' | 'CANCELLED' | 'PENDING_PAYMENT' | null {
  const status = String(ticketData?.status ?? '').toLowerCase().trim()
  const refundStatus = String(ticketData?.refund_status ?? '').toLowerCase().trim()

  if (status === 'refunded' || status === 'refund_pending') return 'REFUNDED'
  if (
    refundStatus === 'processing' ||
    refundStatus === 'approved' ||
    refundStatus === 'manual_required' ||
    refundStatus === 'admin_review'
  ) {
    return 'REFUNDED'
  }
  if (status === 'pending') return 'PENDING_PAYMENT'
  if (status === 'checked_in') return null
  if (!isLiveTicketStatus(status)) return 'CANCELLED'
  return null
}

export type CheckInResult = 
  | { success: true; type: 'VALID'; attendeeName: string; ticketType: string; quantity: number; entryPoint: string }
  | { success: false; type: 'ALREADY_CHECKED_IN'; attendeeName: string; checkedInAt: string; entryPoint: string; allowReentry: boolean }
  | {
      success: false
      type: 'INVALID'
      reason: 'NOT_FOUND' | 'WRONG_EVENT' | 'REFUNDED' | 'CANCELLED' | 'PENDING_PAYMENT' | 'TRANSFERRED' | 'INVALID_CODE'
    }

export interface CheckInParams {
  ticketId: string
  eventId: string
  entryPoint: string
  /** How the attendee was admitted. Defaults to 'scan' so existing callers keep
      their meaning; the manual-lookup path must pass 'manual' explicitly. */
  checkInMethod?: 'scan' | 'manual'
  scannedBy: string
  /** The raw string the camera read, so its QR version and signature can be judged. */
  code?: string | null
}

/**
 * Perform transactional check-in for a ticket
 * Prevents duplicate check-ins through Firestore transaction
 */
export async function checkInTicket(params: CheckInParams): Promise<CheckInResult> {
  const { ticketId, eventId, entryPoint, scannedBy, checkInMethod = 'scan', code } = params

  try {
    const ticketRef = adminDb.collection('tickets').doc(ticketId)
    const eventRef = adminDb.collection('events').doc(eventId)

    // Run in transaction to prevent race conditions
    const result = await adminDb.runTransaction(async (transaction: any) => {
      const [ticketDoc, eventDoc] = await Promise.all([
        transaction.get(ticketRef),
        transaction.get(eventRef),
      ])
      const allowReentry = Boolean(eventDoc.exists && eventDoc.data()?.allow_reentry)

      // Check if ticket exists
      if (!ticketDoc.exists) {
        return {
          success: false,
          type: 'INVALID',
          reason: 'NOT_FOUND',
        } as CheckInResult
      }

      const ticketData = ticketDoc.data()!

      // Check if ticket belongs to this event
      if (ticketData.event_id !== eventId) {
        return {
          success: false,
          type: 'INVALID',
          reason: 'WRONG_EVENT',
        } as CheckInResult
      }

      // A code from before a transfer, or a forged one, before anything else:
      // "transferred" must not read as "already checked in".
      const codeBlocked = codeBlockReason(ticketId, ticketData, code, checkInMethod)
      if (codeBlocked) {
        return { success: false, type: 'INVALID', reason: codeBlocked } as CheckInResult
      }

      // Check ticket status (allowlist — see ticketBlockReason)
      const blocked = ticketBlockReason(ticketData)
      if (blocked) {
        return {
          success: false,
          type: 'INVALID',
          reason: blocked,
        } as CheckInResult
      }

      // Check if already checked in
      if (ticketData.checked_in === true || ticketData.checked_in_at) {
        // Name for display — off the ticket, so guest tickets are not anonymous.
        const attendeeName = await resolveAttendeeName(ticketData)

        return {
          success: false,
          type: 'ALREADY_CHECKED_IN',
          attendeeName,
          checkedInAt: ticketData.checked_in_at?.toDate?.()?.toISOString() || new Date().toISOString(),
          entryPoint: ticketData.entry_point || 'Unknown',
          allowReentry,
        } as CheckInResult
      }

      // Fetch attendee info
      const attendeeName = await resolveAttendeeName(ticketData)

      // A refund the holder asked for but nobody has acted on yet is DENIED by
      // walking in: attending and then being refunded is the abuse this closes.
      // Admitting (rather than refusing at the door) is deliberate: the request
      // window closes 24h before the event, so a buyer who changed their mind
      // and came anyway would otherwise be stuck at a door staff cannot fix.
      // Refunds already moving (processing / admin_review / approved) are
      // refused above by ticketBlockReason.
      const pendingRefundRequest =
        String(ticketData.refund_status ?? '').toLowerCase().trim() === 'requested'
          ? {
              refund_status: 'denied',
              refund_denied_reason: 'checked_in',
              refund_processed_at: new Date().toISOString(),
            }
          : {}

      // Perform check-in - update ticket
      transaction.update(ticketRef, {
        ...pendingRefundRequest,
        checked_in: true,
        checked_in_at: FieldValue.serverTimestamp(),
        checked_in_by: scannedBy,
        entry_point: entryPoint,
        // 'scan' vs 'manual' must be recorded AT WRITE TIME. Every path used to
        // write identical fields, so a hand-picked attendee was indistinguishable
        // from a scanned QR and the payout review trigger had nothing to read.
        check_in_method: checkInMethod,
        updated_at: FieldValue.serverTimestamp(),
      })

      return {
        success: true,
        type: 'VALID',
        attendeeName,
        ticketType: ticketData.ticket_type || 'General Admission',
        quantity: ticketData.quantity || 1,
        entryPoint,
      } as CheckInResult
    })

    return result
  } catch (error) {
    console.error('Check-in transaction error:', error)
    return {
      success: false,
      type: 'INVALID',
      reason: 'NOT_FOUND',
    }
  }
}

/**
 * Override check-in for re-entry: admits a ticket that is ALREADY checked in.
 *
 * It overrides the "already in" verdict only. It used to skip every status check,
 * so a refunded, cancelled or refund-pending ticket could be re-admitted with one
 * tap; the same ticketBlockReason gate as the normal scan now runs first, inside
 * a transaction so a refund landing mid-tap is seen.
 */
export async function overrideCheckIn(params: CheckInParams): Promise<CheckInResult> {
  const { ticketId, eventId, entryPoint, scannedBy, code } = params

  try {
    const ticketRef = adminDb.collection('tickets').doc(ticketId)

    return await adminDb.runTransaction(async (transaction: any) => {
      const ticketDoc = await transaction.get(ticketRef)

      if (!ticketDoc.exists) {
        return { success: false, type: 'INVALID', reason: 'NOT_FOUND' } as CheckInResult
      }

      const ticketData = ticketDoc.data()!

      if (ticketData.event_id !== eventId) {
        return { success: false, type: 'INVALID', reason: 'WRONG_EVENT' } as CheckInResult
      }

      const codeBlocked = codeBlockReason(ticketId, ticketData, code, params.checkInMethod ?? 'scan')
      if (codeBlocked) {
        return { success: false, type: 'INVALID', reason: codeBlocked } as CheckInResult
      }

      const blocked = ticketBlockReason(ticketData)
      if (blocked) {
        return { success: false, type: 'INVALID', reason: blocked } as CheckInResult
      }

      const attendeeName = await resolveAttendeeName(ticketData)

      transaction.update(ticketRef, {
        checked_in: true,
        checked_in_at: FieldValue.serverTimestamp(),
        checked_in_by: scannedBy,
        entry_point: entryPoint,
        reentry_override: true,
        updated_at: FieldValue.serverTimestamp(),
      })

      return {
        success: true,
        type: 'VALID',
        attendeeName,
        ticketType: ticketData.ticket_type || 'General Admission',
        quantity: ticketData.quantity || 1,
        entryPoint,
      } as CheckInResult
    })
  } catch (error) {
    console.error('Override check-in error:', error)
    return {
      success: false,
      type: 'INVALID',
      reason: 'NOT_FOUND',
    }
  }
}
