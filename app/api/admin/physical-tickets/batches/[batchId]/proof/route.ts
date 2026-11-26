import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { getBatch } from '@/lib/physical/batches'
import { designOf } from '@/lib/physical/design/registry'
import { proofInputFor } from '@/lib/physical/design/server'
import { renderProofPdf } from '@/lib/physical/design/proof'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/admin/physical-tickets/batches/:batchId/proof?paper=letter|a4
 * The print room's proof of a batch's approved design: one specimen sheet
 * (front page + back page) from the same renderer as the print PDF, with
 * specimen QRs. It is NOT the print: no live codes, and the batch does not
 * move to 'printing'. Platform admins only.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const { user, error } = await requireAdmin()
  if (!user) return NextResponse.json({ error: error || 'Admin access required' }, { status: error === 'Not authenticated' ? 401 : 403 })
  const batch = await getBatch(String((await params)?.batchId || ''))
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  const paper = new URL(request.url).searchParams.get('paper') === 'a4' ? 'a4' : 'letter'
  const eventSnap = await adminDb.collection('events').doc(batch.event_id).get()
  const event = eventSnap.exists ? eventSnap.data() || {} : { title: batch.event_title }
  const input = await proofInputFor({
    eventId: batch.event_id,
    event,
    orgId: batch.organizer_id,
    tierName: batch.tier_name,
    tierPrice: Number(batch.tier_price) || 0,
  })
  const pdf = await renderProofPdf({ input, design: designOf(batch), paper, batchLabel: `Lot ${batch.id.slice(0, 6).toUpperCase()}` })
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="tikem-proof-${batch.serial_prefix || batch.id}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
