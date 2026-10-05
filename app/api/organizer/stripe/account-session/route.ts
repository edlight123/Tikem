import { NextResponse } from 'next/server'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  // Lazy load
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

/**
 * POST /api/organizer/stripe/account-session
 *
 * Mints a Stripe Account Session for Connect EMBEDDED components — the
 * onboarding surface rendered inside our own page at /organizer/onboarding
 * instead of on connect.stripe.com. The client secret is short-lived and
 * scoped to the one connected account, so returning it to the authenticated
 * organizer is the intended use, not a leak.
 *
 * Deliberately does NOT create accounts: /connect owns account creation (and
 * the payout-profile bookkeeping that goes with it). No account yet → 409,
 * and the client sends the organizer through /connect first.
 */
export async function POST() {
  try {
    const { user, error } = await requireAuth('organizer')
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })
    }

    const profile = await getPayoutProfile(user.id, 'stripe_connect')
    const stripeAccountId = (profile as any)?.stripeAccountId
    if (!stripeAccountId) {
      return NextResponse.json(
        { error: 'No Stripe account yet. Start onboarding first.', code: 'no_account' },
        { status: 409 }
      )
    }

    const stripe = getStripe()
    const session = await stripe.accountSessions.create({
      account: stripeAccountId,
      components: {
        account_onboarding: {
          enabled: true,
          features: {
            // The whole point: bank/external account collection happens inside
            // our page rather than on a Stripe-hosted one.
            external_account_collection: true,
          },
        },
      },
    })

    return NextResponse.json({
      clientSecret: session.client_secret,
      // The mobile RN SDK initializes its Connect instance client-side and has
      // no env plumbing for this; it's a publishable (public) key by design.
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null,
    })
  } catch (error: any) {
    console.error('account-session failed', error)
    return NextResponse.json(
      { error: 'Could not start onboarding. Try again.', code: 'internal_error' },
      { status: 500 }
    )
  }
}
