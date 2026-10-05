import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { findEventEarningsDocInTransaction } from '@/lib/earnings'
import { requireAdmin } from '@/lib/auth'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { logAdminAction } from '@/lib/admin/audit-log'

/**
 * Decline a payout request (admin only)
 * 
 * IDEMPOTENCY: Uses Firestore transaction to prevent double-decline
 */
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAdmin()
    if (error || !user) return adminError('Unauthorized', 401)

    // Parse request
    const body = await request.json()
    const { organizerId, payoutId, reason } = body
    // Cancelling an APPROVED batch is allowed only with an explicit statement
    // that no money was sent for it: approval is the step before an admin moves
    // the money by hand, and crediting the ledger back after a transfer that did
    // go out would let the organizer withdraw the same money again.
    const confirmNotPaid = body?.confirmNotPaid === true

    if (!organizerId || !payoutId || !reason) {
      return adminError('Missing required fields', 400)
    }

    // Use transaction for atomic decline
    const payoutRef = adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('payouts')
      .doc(payoutId)

    const result = await adminDb.runTransaction(async (transaction: any) => {
      const payoutDoc = await transaction.get(payoutRef)

      if (!payoutDoc.exists) throw new Error('Payout not found')

      const payoutData = payoutDoc.data()!

      // Idempotency: declining an already-cancelled payout returns success.
      if (payoutData.status === 'cancelled') {
        return { idempotent: true, payout: { id: payoutDoc.id, ...payoutData } }
      }

      // Concurrency-safe transitions: pending -> cancelled, and approved ->
      // cancelled when the admin confirms nothing was paid.
      if (payoutData.status === 'approved' && !confirmNotPaid) {
        return { needsConfirmation: true, payout: { id: payoutDoc.id, ...payoutData } }
      }
      if (payoutData.status !== 'pending' && payoutData.status !== 'approved') {
        return { conflict: true, payout: { id: payoutDoc.id, ...payoutData } }
      }

      // A batch written since the shared availability ledger debited each
      // event's event_earnings.withdrawnAmount at request time. Declining it
      // must credit those amounts back — in this same transaction, and only on
      // the pending → cancelled transition, so it can happen once. (Reads first:
      // Firestore transactions refuse a read after a write.)
      const credits: Array<{ ref: any; withdrawn: number; amount: number }> = []
      if (payoutData.debitedEventEarnings === true && payoutData.eventAmounts) {
        for (const [eventId, raw] of Object.entries(payoutData.eventAmounts as Record<string, number>)) {
          const amount = Math.max(0, Math.round(Number(raw) || 0))
          if (!amount) continue
          const found = await findEventEarningsDocInTransaction(transaction, eventId)
          if (!found) throw new Error(`Earnings row for event ${eventId} not found; cannot restore`)
          credits.push({ ref: found.ref, withdrawn: Math.max(0, Number(found.data?.withdrawnAmount || 0) || 0), amount })
        }
      }

      // Update payout status
      const now = new Date().toISOString()
      for (const c of credits) {
        transaction.update(c.ref, {
          withdrawnAmount: Math.max(0, c.withdrawn - c.amount),
          settlementStatus: 'ready',
          updatedAt: now,
        })
      }
      transaction.update(payoutRef, {
        status: 'cancelled',  // Using 'cancelled' instead of 'declined' to match Payout type
        declinedBy: user.id,
        declinedAt: now,
        declineReason: reason,
        updatedAt: now,
        ...(credits.length ? { earningsRestoredAt: now } : {}),
        ...(payoutData.status === 'approved' ? { cancelledAfterApproval: true, confirmedNotPaidBy: user.id } : {}),
      })

      return {
        idempotent: false,
        before: { id: payoutDoc.id, ...payoutData },
        payout: {
          id: payoutDoc.id,
          ...payoutData,
          status: 'cancelled',
          declinedBy: user.id,
          declinedAt: now,
          declineReason: reason,
        },
      }
    })

    if ((result as any)?.needsConfirmation) {
      return adminError(
        'Confirm no money was sent',
        409,
        'This payout is approved. Cancel it only if no transfer was made for it, and resend with confirmNotPaid: true — its amounts will be credited back to the organizer.'
      )
    }

    if ((result as any)?.conflict) {
      return adminError('Invalid payout status transition', 409, `Cannot decline - payout is ${String((result as any)?.payout?.status || '')}`)
    }

    const payout = (result as any).payout
    const before = (result as any).before
    const idempotent = Boolean((result as any).idempotent)

    if (!idempotent) {
      logAdminAction({
        action: 'payout.decline',
        adminId: user.id,
        adminEmail: user.email || 'unknown',
        resourceType: 'payout',
        resourceId: `${organizerId}:${payoutId}`,
        details: {
          organizerId,
          payoutId,
          reason,
          beforeStatus: before?.status,
          afterStatus: payout?.status,
        },
      }).catch(() => {})
    }

    return adminOk({ payout, idempotent })
  } catch (error: any) {
    console.error('Error declining payout:', error)
    const msg = error instanceof Error ? error.message : 'Unknown error'
    const status = msg === 'Payout not found' ? 404 : 500
    return adminError('Failed to decline payout', status, msg)
  }
}
