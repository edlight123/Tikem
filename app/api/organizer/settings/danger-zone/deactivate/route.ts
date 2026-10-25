import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { denyIfActingForAnotherOrg } from '@/lib/organizer/ownerOnly'
import { deactivateOrganizerAccount } from '@/lib/account/deactivation'

export const dynamic = 'force-dynamic'

/**
 * Deactivate the organizer account (owner only). Unpublishes the upcoming
 * published events and records which ones, so reactivation restores exactly
 * those (lib/account/deactivation.ts). Refused with 409 while an upcoming event
 * has sold tickets. The client signs out after a 200.
 */
export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Money and identity stay with the org owner (lib/organizer/ownerOnly.ts).
    const notOwner = await denyIfActingForAnotherOrg(user.id)
    if (notOwner) return notOwner

    const outcome = await deactivateOrganizerAccount(user.id)
    if (outcome.status === 'refused') {
      return NextResponse.json(
        {
          error: 'Upcoming events have sold tickets',
          code: 'upcoming_events_with_sales',
          events: outcome.events,
        },
        { status: 409 }
      )
    }

    return NextResponse.json({
      success: true,
      unpublishedEvents: outcome.unpublishedEventIds.length,
    })
  } catch (error) {
    console.error('Error deactivating account:', error)
    return NextResponse.json({ error: 'Failed to deactivate account' }, { status: 500 })
  }
}
