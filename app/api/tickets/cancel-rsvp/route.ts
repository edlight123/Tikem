import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { releaseSeats } from '@/lib/tickets/inventoryShards'
import { toDate } from '@/lib/postEvent/timing'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tickets/cancel-rsvp  { eventId }
 *
 * The attendee gives back their FREE ticket(s) for an event (owner feedback:
 * "there's no way to cancel my RSVP"). Only the caller's own, free, live,
 * not-checked-in tickets, and only before the event starts. Each becomes
 * `cancelled`; the seats go back to inventory when the claim recorded its
 * reservation (claims since 2026-11-16), and the once-per-event claim lock
 * reopens by itself because every ticket it issued is now void. Paid tickets
 * are refunds, not this.
 */
export async function POST(req: Request) {
  try {
    const { user, error } = await requireAuth()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body: any = await req.json().catch(() => null)
    const eventId = typeof body?.eventId === 'string' ? body.eventId.trim() : ''
    if (!eventId) return NextResponse.json({ error: 'eventId is required' }, { status: 400 })

    const eventSnap = await adminDb.collection('events').doc(eventId).get()
    if (!eventSnap.exists) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    const start = toDate(eventSnap.data()?.start_datetime)
    if (start && start.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'This event has already started', code: 'event_started' }, { status: 409 })
    }

    const own = await adminDb.collection('tickets').where('attendee_id', '==', user.id).get()
    const mine = (own.docs as any[]).filter((d) => {
      const t = d.data() || {}
      return (
        String(t.event_id || '') === eventId &&
        Number(t.price_paid ?? 0) === 0 &&
        isLiveTicketStatus(t.status) &&
        !(t.checked_in === true || t.checked_in_at)
      )
    })
    if (mine.length === 0) {
      return NextResponse.json({ error: 'No RSVP to cancel', code: 'nothing_to_cancel' }, { status: 404 })
    }

    const now = new Date().toISOString()
    const batch = adminDb.batch()
    for (const d of mine) {
      batch.update(d.ref, {
        status: 'cancelled',
        cancelled_at: now,
        cancelled_by: user.id,
        cancel_reason: 'rsvp_cancelled',
        updated_at: FieldValue.serverTimestamp(),
      })
    }
    await batch.commit()

    // Give the seats back, per reservation (one claim = one reservation).
    const byReservation = new Map<string, { quantity: number; tiers: Map<string, number> }>()
    for (const d of mine) {
      const t = d.data() || {}
      const rid = typeof t.inventory_reservation_id === 'string' ? t.inventory_reservation_id : ''
      if (!rid) continue
      const entry = byReservation.get(rid) || { quantity: 0, tiers: new Map<string, number>() }
      entry.quantity += 1
      if (t.tier_id) entry.tiers.set(String(t.tier_id), (entry.tiers.get(String(t.tier_id)) || 0) + 1)
      byReservation.set(rid, entry)
    }
    for (const [reservationId, e] of byReservation) {
      try {
        await releaseSeats({
          reservationId,
          quantity: e.quantity,
          tierIncrements: Array.from(e.tiers, ([tierId, quantity]) => ({ tierId, quantity })),
          logPrefix: '[cancel-rsvp]',
        })
      } catch (err) {
        console.error('[cancel-rsvp] seat release failed', { reservationId, err })
      }
    }

    return NextResponse.json({ ok: true, cancelled: mine.length })
  } catch (error) {
    console.error('[cancel-rsvp] failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
