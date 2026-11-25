import { NextRequest, NextResponse } from 'next/server'
import { requireEventAccess, teamCol } from '@/lib/organizer/context'
import { assignRange, cancelUnpaidBatch, getBatch, releaseUnsold, voidRange } from '@/lib/physical/batches'
import {
  CardFxUnavailableError,
  startCardBatchPayment,
  startMonCashBatchPayment,
  verifyCardBatchPayment,
  verifyMonCashBatchPayment,
} from '@/lib/physical/payments'
import { cancelPaidFromBalance, payBatchFromBalance } from '@/lib/physical/balanceOffset'
import { PAYMENT_WINDOW_MS, validRange } from '@/lib/physical/rules'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/organizer/events/:id/physical-batches/:batchId
 *
 * { action: 'pay', method }                 restart the upfront payment (unpaid batch;
 *                                           'moncash' | 'card' | 'balance')
 * { action: 'check_payment', sessionId? }   ask MonCash / Stripe whether it was paid
 * { action: 'cancel' }                      cancel an unpaid batch (seats come back), or a
 *                                           batch paid from the balance before it is
 *                                           printed (the balance is credited back)
 * { action: 'assign_range', from, to, sellerUid }
 * { action: 'void_range', from, to, reason? }    lost / stolen tickets
 * { action: 'release_unsold', from?, to? }       unsold seats back to online sales
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; batchId: string }> }) {
  const { id: eventId, batchId } = await params
  const gate = await requireEventAccess(String(eventId || ''), 'manage_events')
  if (!gate.ok) return gate.response
  const { user, orgId } = gate.value

  const batch = await getBatch(String(batchId || ''))
  if (!batch || batch.event_id !== eventId) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const body: any = await request.json().catch(() => ({}))
  const action = String(body?.action || '')
  const range = { from: Math.round(Number(body?.from)), to: Math.round(Number(body?.to)) }
  const paid = !['awaiting_payment', 'cancelled'].includes(batch.status)

  try {
    switch (action) {
      case 'pay': {
        if (batch.status !== 'awaiting_payment') return NextResponse.json({ error: 'This batch is not waiting for payment' }, { status: 409 })
        const method = body?.method === 'card' ? 'card' : body?.method === 'balance' ? 'balance' : 'moncash'
        if (method === 'balance') {
          const paidNow = await payBatchFromBalance({ batch, user })
          return paidNow.ok
            ? NextResponse.json({ paid: true })
            : NextResponse.json({ error: paidNow.error, code: paidNow.code }, { status: paidNow.status })
        }
        // A new attempt gets a fresh payment window.
        await adminDb.collection('physical_batches').doc(batch.id).update({
          payment_expires_at: new Date(Date.now() + PAYMENT_WINDOW_MS).toISOString(),
          updated_at: new Date().toISOString(),
        })
        const origin = new URL(request.url).origin
        try {
          const started = method === 'moncash' ? await startMonCashBatchPayment(batch) : await startCardBatchPayment(batch, origin)
          return NextResponse.json({ redirectUrl: started.redirectUrl })
        } catch (err: any) {
          if (err instanceof CardFxUnavailableError) return NextResponse.json({ error: err.message, code: 'fx_unavailable' }, { status: 503 })
          throw err
        }
      }
      case 'check_payment': {
        if (paid) return NextResponse.json({ paid: true, status: batch.status })
        const sessionId = String(body?.sessionId || batch.payment?.stripe_session_id || '')
        if (batch.payment?.method === 'card' && sessionId) {
          const r = await verifyCardBatchPayment(sessionId, batch.id)
          return NextResponse.json({ paid: r.paid, reason: r.reason || null })
        }
        if (batch.payment?.order_id) {
          const r = await verifyMonCashBatchPayment(String(batch.payment.order_id))
          return NextResponse.json({ paid: r.paid, reason: r.reason || null })
        }
        return NextResponse.json({ paid: false, reason: 'no_payment_started' })
      }
      case 'cancel': {
        if (batch.status === 'paid' && batch.payment?.funds_rail === 'balance_offset') {
          const r = await cancelPaidFromBalance(batch.id, user.id)
          return r.ok
            ? NextResponse.json({ ok: true, creditedHtg: (r.creditedMinor || 0) / 100 })
            : NextResponse.json({ error: 'This batch can no longer be cancelled', code: r.code }, { status: 409 })
        }
        const r = await cancelUnpaidBatch(batch.id, user.id, 'organizer_cancelled')
        return r.ok
          ? NextResponse.json({ ok: true })
          : NextResponse.json({ error: 'Only an unpaid batch (or one paid from the balance, before printing) can be cancelled', code: r.code }, { status: 409 })
      }
      case 'assign_range': {
        if (!paid) return NextResponse.json({ error: 'Pay for the batch first' }, { status: 409 })
        if (!validRange(range, batch.quantity)) return NextResponse.json({ error: `Enter a range within 1 to ${batch.quantity}`, code: 'bad_range' }, { status: 400 })
        const sellerUid = String(body?.sellerUid || '').trim()
        if (!sellerUid || sellerUid.includes('/')) return NextResponse.json({ error: 'Choose a seller' }, { status: 400 })
        // A seller is an ACTIVE member of the event's own org.
        const seat = orgId ? await teamCol(orgId).doc(sellerUid).get() : null
        const s = seat?.exists ? seat.data() || {} : null
        if (!s || s.status !== 'active' || !['seller', 'manager', 'admin'].includes(String(s.role))) {
          return NextResponse.json({ error: 'That person is not on this organization’s team', code: 'not_team' }, { status: 400 })
        }
        const r = await assignRange({ batch, range, seller: { uid: sellerUid, name: String(s.name || s.email || '') } })
        return NextResponse.json(r)
      }
      case 'void_range': {
        if (!paid) return NextResponse.json({ error: 'Pay for the batch first' }, { status: 409 })
        if (!validRange(range, batch.quantity)) return NextResponse.json({ error: `Enter a range within 1 to ${batch.quantity}`, code: 'bad_range' }, { status: 400 })
        const r = await voidRange({ batch, range, by: user.id, reason: body?.reason ? String(body.reason) : null })
        return NextResponse.json(r)
      }
      case 'release_unsold': {
        if (!paid) return NextResponse.json({ error: 'Cancel the unpaid batch instead' }, { status: 409 })
        const partial = body?.from != null || body?.to != null
        if (partial && !validRange(range, batch.quantity)) return NextResponse.json({ error: `Enter a range within 1 to ${batch.quantity}`, code: 'bad_range' }, { status: 400 })
        const r = await releaseUnsold({ batch, by: user.id, range: partial ? range : null })
        return NextResponse.json(r)
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (err: any) {
    console.error('[physical] batch action failed', { batchId, action, message: err?.message })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
