import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { logAdminAction } from '@/lib/admin/audit-log'
import { formatEventWhen } from '@/lib/email-kit/i18n'
import { getBatch, loadBatchTickets, markBatchPrinted } from '@/lib/physical/batches'
import { renderBatchPdf } from '@/lib/physical/pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/admin/physical-tickets/batches/:batchId/pdf?paper=letter|a4&lang=fr|en|ht
 * The print-ready sheet for a paid batch (platform admins only: the PDF holds
 * live QRs). Every download is audited, and the first one moves a paid batch
 * to 'printing' (printed_at), which ends cancel-for-credit.
 *
 * Only UNSOLD tickets are ever printed: a sold ticket's paper is already in its
 * buyer's hands, and printing its working QR again (e.g. after a reprint)
 * would put a second valid copy into the world.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const { user, error } = await requireAdmin()
  if (!user) return NextResponse.json({ error: error || 'Admin access required' }, { status: error === 'Not authenticated' ? 401 : 403 })
  const batchId = String((await params)?.batchId || '')
  const batch = await getBatch(batchId)
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  if (['awaiting_payment', 'cancelled'].includes(batch.status)) {
    return NextResponse.json({ error: 'This batch is not paid' }, { status: 409 })
  }
  const url = new URL(request.url)
  const paper = url.searchParams.get('paper') === 'a4' ? 'a4' : 'letter'
  const langRaw = url.searchParams.get('lang')
  const lang = langRaw === 'en' || langRaw === 'ht' ? langRaw : 'fr'

  const [eventSnap, tickets] = await Promise.all([adminDb.collection('events').doc(batch.event_id).get(), loadBatchTickets(batch.id)])
  const event = eventSnap.exists ? eventSnap.data() || {} : {}
  const start = event.start_datetime?.toDate ? event.start_datetime.toDate().toISOString() : event.start_datetime
  const when = formatEventWhen(start, lang, event)
  const printable = tickets
    .filter((t) => t.status === 'printed_unsold')
    .map((t) => ({ serial: String(t.physical_serial || ''), qrPayload: String(t.qr_code_data || ''), tierName: String(t.tier_name || batch.tier_name) }))
  if (printable.length === 0) return NextResponse.json({ error: 'Nothing to print' }, { status: 409 })

  // Downloading the sheet is printing it: the batch moves to 'printing' with
  // printed_at, so the organizer can no longer cancel it for a credit.
  const printed = await markBatchPrinted(batch.id, user.id)
  if (!printed.ok) return NextResponse.json({ error: 'This batch is not paid' }, { status: 409 })

  const pdf = await renderBatchPdf({
    event: {
      title: String(event.title || batch.event_title || ''),
      dateLine: when ? when.line : '',
      venueLine: [event.venue_name, event.city].filter(Boolean).join(', '),
    },
    tickets: printable,
    paper,
    batchLabel: `Batch ${batch.id.slice(0, 6).toUpperCase()}${batch.reprint_count ? ` · reprint ${batch.reprint_count}` : ''}`,
  })
  await logAdminAction({
    action: 'physical_tickets.batch.pdf',
    adminId: user.id,
    adminEmail: user.email || '',
    resourceId: batch.id,
    resourceType: 'physical_batch',
    details: { paper, count: printable.length, reprint: batch.reprint_count || 0 },
  })
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="tikem-printed-${batch.serial_prefix || batch.id}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
