/**
 * GET /api/events/[id]/views: { total, today } page views for the event's
 * organizer and team (any role that may view the event). See lib/events/views.ts.
 */
import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/organizer/context'
import { readEventViewStats } from '@/lib/events/views-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id || id.length > 128 || id.includes('/')) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }
  const gate = await requireEventAccess(id, 'view')
  if (!gate.ok) return gate.response
  const stats = await readEventViewStats(id, gate.value.event)
  return NextResponse.json(stats, { headers: { 'cache-control': 'no-store' } })
}
