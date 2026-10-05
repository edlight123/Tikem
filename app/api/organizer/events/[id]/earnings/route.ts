import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { loadEventAvailability } from '@/lib/payouts/availability-server'
import { toEarningsRow } from '@/lib/payouts/availability'
import { fetchUsdToHtgRate } from '@/lib/currency'
import { moncashMinimumInfo } from '@/lib/payouts/moncash-withdrawal-minimum'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const { user, error } = await requireAuth()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'organizer' && user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const eventDoc = await adminDb.collection('events').doc(id).get()
    if (!eventDoc.exists) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const eventData = eventDoc.data() as any
    if (eventData?.organizer_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized for this event' }, { status: 403 })
    }

    /**
     * Every money figure here comes from the ONE shared availability function
     * (lib/payouts/availability.ts) — the same call the withdraw-moncash and
     * withdraw-bank routes validate with, release ladder included. The mobile
     * Earnings hub and per-event screen read `availableToWithdraw` / `release`
     * from this payload, so the figure they show is the figure a withdrawal is
     * judged against.
     *
     * Read-only: the gate files review-queue rows; opening a screen never does.
     */
    const availability = await loadEventAvailability({ eventId: id, eventData })
    if (!availability) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    if (availability.ticketsSold === 0 && availability.withdrawnMinor === 0 && availability.batchReservedMinor === 0) {
      return NextResponse.json({ earnings: null }, { status: 200 })
    }

    const row = toEarningsRow(availability)

    // The MonCash floor (1,000 HTG) in this event's currency, at the rate the
    // withdrawal would use. Best-effort: absent means "unknown", and the server
    // still enforces it on submit.
    let moncashMinimum = null
    try {
      const currency = row.currency === 'USD' ? 'USD' : 'HTG'
      moncashMinimum = moncashMinimumInfo(currency, currency === 'USD' ? await fetchUsdToHtgRate() : 1)
    } catch (e) {
      console.error('earnings moncash minimum failed', (e as any)?.message)
    }

    return NextResponse.json({ earnings: { ...row, moncashMinimum } }, { status: 200 })
  } catch (e) {
    console.error('GET /api/organizer/events/[id]/earnings error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
