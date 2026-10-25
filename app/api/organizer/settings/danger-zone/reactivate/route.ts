import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getDeactivation, reactivateOrganizerAccount } from '@/lib/account/deactivation'

export const dynamic = 'force-dynamic'

/**
 * GET: is the signed-in account deactivated, and how many events would come back?
 * POST: reactivate it, republishing exactly the events deactivation unpublished.
 *
 * Acts on the caller's own account only (user.id), so no org-context gate is
 * needed: a team member can only ever reactivate themselves.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const rec = await getDeactivation(user.id)
    return NextResponse.json({
      deactivated: Boolean(rec),
      deactivatedAt: rec?.at || null,
      eventCount: rec?.unpublished_event_ids.length || 0,
    })
  } catch (error) {
    console.error('Error reading deactivation:', error)
    return NextResponse.json({ error: 'Failed to read account status' }, { status: 500 })
  }
}

export async function POST() {
  const user = await getCurrentUser()
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { restoredEventIds } = await reactivateOrganizerAccount(user.id)
    return NextResponse.json({ success: true, restoredEvents: restoredEventIds.length })
  } catch (error) {
    console.error('Error reactivating account:', error)
    return NextResponse.json({ error: 'Failed to reactivate account' }, { status: 500 })
  }
}
