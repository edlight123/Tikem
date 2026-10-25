import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { isStaleStripeAccountError, reconnectNeededBody } from '@/lib/stripe-connect-account'
import { denyIfActingForAnotherOrg } from '@/lib/organizer/ownerOnly'

export const runtime = 'nodejs'

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

export async function POST(_request: NextRequest) {
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
      return NextResponse.json({ error: 'Stripe account not connected' }, { status: 400 })
    }

    const stripe = getStripe()
    const link = await stripe.accounts.createLoginLink(stripeAccountId)

    return NextResponse.json({ url: link.url })
  } catch (error: any) {
    if (isStaleStripeAccountError(error)) {
      return NextResponse.json(reconnectNeededBody(String(error?.code || error?.raw?.code || 'no_such_account')), {
        status: 409,
      })
    }
    const statusCode = Number(error?.statusCode) || Number(error?.raw?.statusCode) || 500
    const rawMessage = String(error?.raw?.message || error?.message || 'Failed to create Stripe login link')
    console.error('Stripe login link error:', error)
    return NextResponse.json(
      {
        error: 'Failed to create Stripe login link',
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
