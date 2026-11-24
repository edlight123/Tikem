import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { loadSellerAssignments } from '@/lib/physical/batches'

export const dynamic = 'force-dynamic'

/**
 * GET /api/staff/physical/assignments
 * The printed-ticket ranges assigned to the signed-in seller, per event, so the
 * app can show a seller what they may sell (and offer the activate screen).
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const assignments = await loadSellerAssignments(user.id)
    return NextResponse.json({ assignments: assignments.filter((a: any) => a.status !== 'cancelled') })
  } catch (err: any) {
    console.error('[physical/assignments] failed', { message: err?.message })
    return NextResponse.json({ error: 'Could not load your assignments' }, { status: 500 })
  }
}
