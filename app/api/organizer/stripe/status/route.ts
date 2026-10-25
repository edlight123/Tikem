import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { reconnectNeededBody, resolveConnectedAccount } from '@/lib/stripe-connect-account'
import { denyIfActingForAnotherOrg } from '@/lib/organizer/ownerOnly'

export const runtime = 'nodejs'

export const dynamic = 'force-dynamic'

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

export async function GET(_request: NextRequest) {
  try {
    const { user, error } = await requireAuth('organizer')
    if (error || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Money and identity stay with the org owner (lib/organizer/ownerOnly.ts).
    const notOwner = await denyIfActingForAnotherOrg(user.id)
    if (notOwner) return notOwner

    const organizerId = user.id

    const profile = await getPayoutProfile(organizerId, 'stripe_connect')
    const stripeAccountId = profile?.stripeAccountId

    if (!stripeAccountId) {
      return NextResponse.json(
        {
          connected: false,
          status: 'not_connected',
        },
        { status: 200 }
      )
    }

    const stripe = getStripe()
    // An id from the pre-September platform (or one stamped for another
    // organizer) is reported as a state, not thrown as a 4xx/5xx: the client
    // shows "reconnect", and /connect replaces the id.
    const resolution = await resolveConnectedAccount(stripe, organizerId, String(stripeAccountId))
    if (resolution.state === 'stale') {
      return NextResponse.json(reconnectNeededBody(resolution.reason), { status: 200 })
    }
    const account = resolution.account

    const requirementsCurrentlyDue = Array.isArray(account?.requirements?.currently_due)
      ? account.requirements.currently_due
      : []

    const requirementsEventuallyDue = Array.isArray(account?.requirements?.eventually_due)
      ? account.requirements.eventually_due
      : []

    const disabledReason = account?.requirements?.disabled_reason || null

    const derivedStatus = (() => {
      if (account.details_submitted && account.charges_enabled && account.payouts_enabled) return 'verified'
      if (disabledReason) return 'requires_more_info'
      if (requirementsCurrentlyDue.length > 0 || requirementsEventuallyDue.length > 0) return 'incomplete'
      return 'in_review'
    })()

    return NextResponse.json({
      connected: true,
      stripeAccountId,
      status: derivedStatus,
      account: {
        country: account.country,
        detailsSubmitted: Boolean(account.details_submitted),
        chargesEnabled: Boolean(account.charges_enabled),
        payoutsEnabled: Boolean(account.payouts_enabled),
        disabledReason,
        requirements: {
          currentlyDue: requirementsCurrentlyDue,
          eventuallyDue: requirementsEventuallyDue,
        },
      },
    })
  } catch (error: any) {
    const statusCode = Number(error?.statusCode) || Number(error?.raw?.statusCode) || 500
    const rawMessage = String(error?.raw?.message || error?.message || 'Failed to fetch Stripe status')
    console.error('Stripe status error:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch Stripe status',
        message: rawMessage,
        stripe: {
          requestId: error?.requestId || error?.raw?.requestId,
          type: error?.type || error?.rawType,
        },
      },
      { status: statusCode }
    )
  }
}
