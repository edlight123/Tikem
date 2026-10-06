import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin as isAdminEmail } from '@/lib/admin'
import { cancelEventWithRefunds, organizerSelfCancelBlock } from '@/lib/events/cancel'
import { logAdminAction } from '@/lib/admin/audit-log'

export const runtime = 'nodejs'

/**
 * POST /api/events/[id]/cancel — cancel an event and unwind the money.
 *
 * Open to the event's organizer ONLY before any money has been withdrawn for
 * it and before it has ended (organizerSelfCancelBlock); after that, and for the
 * case the owner cannot be reached or refuses while the event is unsafe to
 * hold, to an admin. Admin cancellations are audit-logged; organizer ones are
 * attributed on the event document, and their refunds are limited to what the
 * organizer's unwithdrawn balance covers (the rest goes to refund_reviews).
 *
 * The heavy lifting (freeze, refunds, notifications) lives in
 * lib/events/cancel.ts so both paths behave identically.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const eventSnap = await adminDb.collection('events').doc(eventId).get()
    if (!eventSnap.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    const event = eventSnap.data() as any

    const admin =
      (user as any).role === 'admin' ||
      (user as any).role === 'super_admin' ||
      isAdminEmail(((user as any).email_verified) ? user.email : null)
    const owner = event?.organizer_id === user.id

    if (!owner && !admin) {
      return NextResponse.json({ error: 'Not allowed to cancel this event' }, { status: 403 })
    }

    // An organizer's own cancellation: only before a withdrawal and before the end.
    // A resume of an already-cancelled event is allowed (the sweep is idempotent).
    const alreadyCancelled = String(event?.status || '').toLowerCase() === 'cancelled'
    if (!admin && !alreadyCancelled) {
      const blocked = await organizerSelfCancelBlock(eventId, event)
      if (blocked) {
        return NextResponse.json({ error: blocked.error, code: blocked.code }, { status: blocked.status })
      }
    }

    const body = await request.json().catch(() => ({}))
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 500).trim() : null

    // An admin cancelling someone else's event must say why — that reason is
    // shown to ticket holders and kept in the audit log.
    if (admin && !owner && !reason) {
      return NextResponse.json(
        { error: 'A reason is required when cancelling on an organizer’s behalf', code: 'reason_required' },
        { status: 400 }
      )
    }

    const outcome = await cancelEventWithRefunds({
      eventId,
      actor: { id: user.id, email: user.email, isAdmin: admin && !owner },
      reason,
    })

    if (admin && !owner) {
      await logAdminAction({
        action: 'event.cancel',
        adminId: user.id,
        adminEmail: user.email || '',
        resourceId: eventId,
        resourceType: 'event',
        details: {
          eventTitle: event?.title || null,
          reason,
          ticketsAffected: outcome.ticketsAffected,
          refundsSucceeded: outcome.refundsSucceeded,
          refundsQueuedManual: outcome.refundsQueuedManual,
          refundsFailed: outcome.refundsFailed,
        },
      })
    }

    if (outcome.ledgerStampFailed) {
      // Refunds ran; the payout ledger did not record the cancellation. Loud,
      // so the caller retries (the cancel is resumable and re-applies it).
      return NextResponse.json(
        {
          success: false,
          code: 'cancel_ledger_stamp_failed',
          error: 'The event was cancelled, but recording it on the payout ledger failed. Please retry the cancellation.',
          ...outcome,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, ...outcome })
  } catch (error: any) {
    const status = Number(error?.status) || 500
    if (status === 500) console.error('[events/cancel] failed', error)
    return NextResponse.json(
      { error: error?.message || 'Could not cancel the event' },
      { status }
    )
  }
}
