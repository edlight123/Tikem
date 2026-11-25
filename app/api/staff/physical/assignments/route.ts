import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { teamSeatIn } from '@/lib/organizer/context'
import { loadSellerAssignments } from '@/lib/physical/batches'

export const dynamic = 'force-dynamic'

/**
 * GET /api/staff/physical/assignments
 * The printed-ticket ranges assigned to the signed-in seller, per event, so the
 * app can show a seller what they may sell (and offer the activate screen).
 *
 * Only for orgs where the caller is STILL an active team member: someone
 * removed from the team keeps their old range on the batch doc, and must not
 * keep seeing it (activation re-checks the role server-side too).
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const all = await loadSellerAssignments(user.id)
    const seats = new Map<string, boolean>()
    for (const orgId of Array.from(new Set<string>(all.map((a: any) => String(a.organizerId || ''))))) {
      const seat = orgId === user.id ? { role: 'owner' } : orgId ? await teamSeatIn(orgId, user.id).catch(() => null) : null
      seats.set(orgId, Boolean(seat))
    }
    const assignments = all
      .filter((a: any) => a.status !== 'cancelled' && seats.get(String(a.organizerId || '')) === true)
      .map(({ organizerId: _org, ...rest }: any) => rest)
    return NextResponse.json({ assignments })
  } catch (err: any) {
    console.error('[physical/assignments] failed', { message: err?.message })
    return NextResponse.json({ error: 'Could not load your assignments' }, { status: 500 })
  }
}
