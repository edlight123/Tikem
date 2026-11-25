import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { logAdminAction } from '@/lib/admin/audit-log'
import { moveBatch, reprintBatch } from '@/lib/physical/batches'
import type { BatchStatus } from '@/lib/physical/rules'

export const dynamic = 'force-dynamic'

const MOVES = new Set<BatchStatus>(['printing', 'ready', 'active'])

/**
 * POST (platform admins, the print room):
 *   { action: 'move', to: 'printing' | 'ready' | 'active' }   one step along the flow
 *   { action: 'reprint' }   new QR tokens for every unsold ticket; the old sheets stop scanning
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const { user, error } = await requireAdmin()
  if (!user) return NextResponse.json({ error: error || 'Admin access required' }, { status: error === 'Not authenticated' ? 401 : 403 })
  const batchId = String((await params)?.batchId || '')
  if (!batchId || batchId.includes('/')) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  const body: any = await request.json().catch(() => ({}))

  if (body?.action === 'move') {
    const to = String(body?.to || '') as BatchStatus
    if (!MOVES.has(to)) return NextResponse.json({ error: 'Unknown status' }, { status: 400 })
    const r = await moveBatch(batchId, to, user.id)
    if (!r.ok) return NextResponse.json({ error: r.code === 'not_found' ? 'Batch not found' : `Cannot move from ${r.from} to ${to}`, code: r.code }, { status: r.code === 'not_found' ? 404 : 409 })
    await logAdminAction({ action: 'physical_tickets.batch.move', adminId: user.id, adminEmail: user.email || '', resourceId: batchId, resourceType: 'physical_batch', details: { from: r.from, to } })
    return NextResponse.json({ ok: true })
  }
  if (body?.action === 'reprint') {
    const r = await reprintBatch(batchId, user.id)
    if (!r.ok) return NextResponse.json({ error: r.code === 'not_found' ? 'Batch not found' : 'This batch is not paid', code: r.code }, { status: r.code === 'not_found' ? 404 : 409 })
    await logAdminAction({ action: 'physical_tickets.batch.reprint', adminId: user.id, adminEmail: user.email || '', resourceId: batchId, resourceType: 'physical_batch', details: { reissued: r.reissued } })
    return NextResponse.json(r)
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
