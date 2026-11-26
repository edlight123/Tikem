import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { PHYSICAL_BATCHES } from '@/lib/physical/rules'
import { designOf, getTemplate, swatchFor } from '@/lib/physical/design/registry'

export const dynamic = 'force-dynamic'

/** GET: the most recent printed batches, for the print room (platform admins). */
export async function GET() {
  const { user, error } = await requireAdmin()
  if (!user) return NextResponse.json({ error: error || 'Admin access required' }, { status: error === 'Not authenticated' ? 401 : 403 })
  const snap = await adminDb.collection(PHYSICAL_BATCHES).orderBy('created_at', 'desc').limit(100).get()
  const batches = snap.docs.map((d: any) => {
    const b = d.data() || {}
    const design = designOf(b)
    const template = getTemplate(design.template)!
    const swatch = swatchFor(template, design.color)
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
      needsRefund: b.needs_refund === true,
      latePayments: Array.isArray(b.late_payments)
        ? b.late_payments.map((p: any) => ({ fundsRail: String(p?.funds_rail || ''), amount: Number(p?.amount) || 0, currency: String(p?.currency || ''), reference: String(p?.reference || '') }))
        : [],
      refundedToBalanceAt: b.payment?.refunded_to_balance_at ? String(b.payment.refunded_to_balance_at) : null,
      design: {
        template: design.template,
        templateName: template.name.en,
        tier: template.tier,
        color: swatch.name.en,
        colorHex: swatch.hex,
        hasPhoto: !!design.photo_url,
        photoSource: design.photo_source,
        logos: design.logos.length,
        overrides: design.overrides,
        approvedAt: design.approved_at,
        legacy: !b.design,
      },
      surchargeHtgPerTicket: Number(b.surcharge_htg_per_ticket) || 0,
    }
  })
  return NextResponse.json({ batches })
}
