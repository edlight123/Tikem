import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { loadAdminQueue } from '@/lib/doorTeam/requests'

export const dynamic = 'force-dynamic'

/** GET: the door team queue for platform admins (newest first, full detail). */
export async function GET() {
  const { user, error } = await requireAdmin()
  if (!user) return NextResponse.json({ error: error || 'Admin access required' }, { status: error === 'Not authenticated' ? 401 : 403 })
  try {
    const requests = await loadAdminQueue()
    return NextResponse.json({
      requests: requests.map((r) => ({
        id: r.id,
        eventId: r.event_id,
        eventTitle: r.event_title,
        eventStartAt: r.event_start_at,
        organizerId: r.organizer_id,
        status: r.status,
        staffCount: r.staff_count,
        hours: r.hours,
        arrivalAt: r.arrival_at,
        notes: r.notes,
        contactName: r.contact_name,
        contactPhone: r.contact_phone,
        standardHtg: Number(r.standard_quote?.totalHtg) || 0,
        priceHtg: r.price_htg ?? null,
        priceKind: r.price_kind || null,
        quoteNote: r.quote_note || '',
        declineReason: r.decline_reason || '',
        fundsRail: r.payment?.funds_rail || null,
        paymentStatus: r.payment?.status || null,
        crew: (r.crew || []).map((c) => ({ uid: c.uid, firstName: c.first_name })),
        needsRefund: !!r.needs_refund,
        refund: r.refund || null,
        latePayments: Array.isArray(r.late_payments) ? r.late_payments : [],
        createdAt: r.created_at,
      })),
    })
  } catch (err: any) {
    console.error('[admin/door-team] list failed', { message: err?.message })
    return NextResponse.json({ error: 'Could not load requests' }, { status: 500 })
  }
}
