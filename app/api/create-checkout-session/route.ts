import { NextResponse } from 'next/server'

/**
 * RETIRED. Hosted Stripe Checkout sessions are no longer created anywhere.
 *
 * No client calls this route (web, admin and mobile all use
 * /api/create-payment-intent), and it had drifted from every guard the live path
 * enforces: no event-state check, no tier/event match, no integer-quantity check.
 * A dead money route is attack surface, so it now refuses outright.
 *
 * The Stripe webhook still understands `checkout.session.completed` for any session
 * created before this was retired.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'This checkout endpoint has been retired. Please update the app and try again.',
      code: 'endpoint_retired',
      recommendedEndpoint: '/api/create-payment-intent',
    },
    { status: 410 }
  )
}
