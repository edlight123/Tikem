import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { PHYSICAL_BATCHES } from '@/lib/physical/rules'

export const dynamic = 'force-dynamic'

/** GET: the most recent printed batches, for the print room (platform admins). */
export async function GET() {
  const { user, error } = await requireAdmin()
  if (!user) return NextResponse.json({ error: error || 'Admin access required' }, { status: error === 'Not authenticated' ? 401 : 403 })
  const snap = await adminDb.collection(PHYSICAL_BATCHES).orderBy('created_at', 'desc').limit(100).get()
  const batches = snap.docs.map((d: any) => {
    const b = d.data() || {}
    return {
      id: d.id,
      eventId: String(b.event_id || ''),
      eventTitle: String(b.event_title || ''),
      tierName: String(b.tier_name || ''),
      quantity: Number(b.quantity) || 0,
      totalHtg: Number(b.total_htg) || 0,
      status: String(b.status || ''),
      paymentMethod: String(b.payment?.method || ''),
      fundsRail: String(b.payment?.funds_rail || ''),
      reprintCount: Number(b.reprint_count) || 0,
      createdAt: String(b.created_at || ''),
      paidAt: b.paid_at ? String(b.paid_at) : null,
    }
  })
  return NextResponse.json({ batches })
}
