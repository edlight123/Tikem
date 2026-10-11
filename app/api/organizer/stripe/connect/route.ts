import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import { updatePayoutProfileConfig } from '@/lib/firestore/payout'
import { requireAuth } from '@/lib/auth'
import { getDeclaredMarkets } from '@/lib/firestore/organizer-markets'
import { marketsForRail } from '@/lib/organizer-markets'
import {
  accountLocationForCountry,
  createExpressAccount,
  deleteOrphanAccount,
  replaceStripeAccountId,
  resolveConnectedAccount,
  toStripeConnectCountry,
} from '@/lib/stripe-connect-account'

export const runtime = 'nodejs'

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  // Lazy load
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

function normalizeAppUrl(request: NextRequest) {
  const fromEnv = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '')
  if (fromEnv) return fromEnv

  const first = (value: string | null) => String(value || '').split(',')[0].trim()

  // Prefer the actual request host (works well with domain aliases).
  const host =
    first(request.headers.get('host')) ||
    first(request.headers.get('x-forwarded-host')) ||
    request.nextUrl.host ||
    first(process.env.VERCEL_URL || null)

  // Prefer forwarded proto, otherwise infer.
  const inferredProto = request.nextUrl.protocol ? request.nextUrl.protocol.replace(':', '') : ''
  const proto =
    first(request.headers.get('x-forwarded-proto')) ||
    inferredProto ||
    (process.env.VERCEL_ENV === 'production' ? 'https' : 'http')

  if (host) return `${proto}://${host}`

  return request.nextUrl.origin || 'http://localhost:3000'
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth('organizer')
    if (error || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const organizerId = user.id

    const body = await request.json().catch(() => ({}))
    const requestedLocation = String(body?.accountLocation || '').trim()

    // Read payout profile (source of truth)
    const profile = await getPayoutProfile(organizerId, 'stripe_connect')

    // Validate the requested country BEFORE falling back to the stored one: an
    // unsupported value must be refused, not silently replaced (audit L9).
    const stripeCountry = toStripeConnectCountry(requestedLocation || profile?.accountLocation || '')
    if (!stripeCountry) {
      return NextResponse.json(
        {
          error: 'Stripe Connect is only available for United States, Canada, or France accounts.',
          code: 'unsupported_location',
        },
        { status: 400 }
      )
    }
    const accountLocation = accountLocationForCountry(stripeCountry)

    // Consistency with the organizer's declared markets. Declarations are a UI
    // hint and an EMPTY one means "anything" — so this only refuses the case
    // where the organizer declared Stripe-rail markets and this is not one of
    // them. They can edit their markets at any time; nothing is locked.
    const stripeMarkets = marketsForRail('stripe_connect', await getDeclaredMarkets(organizerId))
    if (stripeMarkets.length > 0 && !stripeMarkets.includes(stripeCountry)) {
      return NextResponse.json(
        {
          error: `Your payout markets are ${stripeMarkets.join(', ')}. Add ${stripeCountry} to your markets before connecting a Stripe account there.`,
          code: 'location_not_in_markets',
          markets: stripeMarkets,
        },
        { status: 400 }
      )
    }

    const stripe = getStripe()

    // Get organizer email
    const userDoc = await adminDb.collection('users').doc(organizerId).get()
    const email = userDoc.exists ? (userDoc.data()?.email as string | undefined) : undefined

    let stripeAccountId: string | null = profile?.stripeAccountId ? String(profile.stripeAccountId) : null
    let replacedStaleAccount: { previousId: string; reason: string } | null = null

    // A stored id is only reused once Stripe confirms it is THIS platform's
    // account for THIS organizer. Ids from the pre-September platform answer
    // account_invalid / "No such account" — reusing them made every onboarding
    // attempt throw, forever.
    if (stripeAccountId) {
      const resolution = await resolveConnectedAccount(stripe, organizerId, stripeAccountId)
      let replaceReason: string | null = null
      if (resolution.state === 'stale') {
        replaceReason = resolution.reason
      } else {
        const existingCountry = String(resolution.account?.country || '').toUpperCase()
        if (existingCountry && existingCountry !== stripeCountry) {
          // Stripe never changes an account's country. Before details are
          // submitted nothing is lost by starting over in the right country;
          // after, a human has to decide.
          if (resolution.account?.details_submitted === true) {
            return NextResponse.json(
              {
                error: `Your Stripe account is registered in ${existingCountry}. Stripe does not allow changing an account's country; contact support to move it to ${stripeCountry}.`,
                code: 'country_mismatch',
                accountCountry: existingCountry,
              },
              { status: 409 }
            )
          }
          replaceReason = `country_changed_${existingCountry}_to_${stripeCountry}`
        }
      }

      if (replaceReason) {
        const previousId: string = stripeAccountId
        const fresh = await createExpressAccount(stripe, { organizerId, country: stripeCountry, email })
        const swap = await replaceStripeAccountId({
          organizerId,
          oldId: previousId,
          newId: fresh.id,
          reason: replaceReason,
          accountLocation,
        })
        if (!swap.replaced) {
          // A concurrent request replaced it first; use theirs, drop ours.
          await deleteOrphanAccount(stripe, fresh.id)
        } else {
          replacedStaleAccount = { previousId, reason: replaceReason }
          console.warn('[stripe-connect] replaced unusable connected account', {
            organizerId,
            previousId,
            newId: fresh.id,
            reason: replaceReason,
          })
        }
        stripeAccountId = swap.stripeAccountId
      }
    }

    if (!stripeAccountId) {
      const account = await createExpressAccount(stripe, { organizerId, country: stripeCountry, email })

      stripeAccountId = account.id
      const createdStripeAccountId = account.id

      const updateResult = await updatePayoutProfileConfig(organizerId, 'stripe_connect', {
        payoutProvider: 'stripe_connect',
        accountLocation,
        stripeAccountId: createdStripeAccountId,
      })

      if (!updateResult.success) {
        throw new Error(updateResult.error || 'Failed to save Stripe Connect profile')
      }
    }

    const appUrl = normalizeAppUrl(request)
    const refreshUrl = `${appUrl}/organizer/settings/payouts?stripe=refresh`
    const returnUrl = `${appUrl}/organizer/settings/payouts?stripe=return`

    // Embedded mode: the account bootstrap above is identical, but onboarding
    // renders in OUR page (Connect embedded components) instead of a
    // stripe.com-hosted account link. The mobile WebView and the web dashboard
    // both load this URL; completion redirects to the same returnUrl the
    // hosted flow used, so existing completion detection works unchanged.
    if (body?.embedded === true) {
      // The page URL must be built on the host that served THIS request — not
      // NEXT_PUBLIC_APP_URL. The env var holds the apex (tikem.co), which
      // 308-redirects to www, and the mobile WebView attaches its Bearer token
      // only to the INITIAL document request: WKWebView drops custom headers on
      // the redirect, so the page saw no auth and bounced organizers to the
      // login screen. The host that just authenticated this API call is proven
      // redirect-free for this client.
      const first = (value: string | null) => String(value || '').split(',')[0].trim()
      let requestHost =
        first(request.headers.get('x-forwarded-host')) || first(request.headers.get('host'))
      // In production, canonicalize alias hosts to www: the mobile WebView only
      // injects its Bearer token for tikem.co hosts, so a *.vercel.app alias or
      // the apex here means an unauthenticated page (the EAS env once pointed
      // the app at eventhaiti.vercel.app, whose 307 landed everything on
      // jointikem.vercel.app). Preview deployments keep their own host — those
      // flows run in a browser on the session cookie.
      if (
        process.env.VERCEL_ENV === 'production' &&
        (requestHost === 'tikem.co' || requestHost.endsWith('.vercel.app'))
      ) {
        requestHost = 'www.tikem.co'
      }
      const requestProto =
        first(request.headers.get('x-forwarded-proto')) ||
        (request.nextUrl.protocol ? request.nextUrl.protocol.replace(':', '') : 'https')
      const embeddedBase = requestHost ? `${requestProto}://${requestHost}` : appUrl

      return NextResponse.json({
        url: `${embeddedBase}/organizer/onboarding`,
        stripeAccountId,
        embedded: true,
        ...(replacedStaleAccount ? { reconnected: true } : {}),
      })
    }

    const link = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    })

    return NextResponse.json({
      url: link.url,
      stripeAccountId,
      ...(replacedStaleAccount ? { reconnected: true } : {}),
    })
  } catch (error: any) {
    const statusCode = Number(error?.statusCode) || Number(error?.raw?.statusCode) || 500

    // Common misconfiguration: Stripe account not enabled for Connect
    const rawMessage =
      String(error?.raw?.message || error?.message || 'Failed to create Stripe onboarding link')

    const connectNotEnabled =
      rawMessage.includes("signed up for Connect") ||
      rawMessage.includes('sign up for Connect') ||
      rawMessage.includes('signed up for connect')

    const userMessage = connectNotEnabled
      ? 'Stripe Connect is not enabled on this Stripe account. In Stripe Dashboard → Settings → Connect, enable Connect for this account (Test mode and/or Live mode), then retry.'
      : rawMessage

    console.error('Stripe connect error:', error)

    return NextResponse.json(
      {
        error: 'Failed to create Stripe onboarding link',
        message: userMessage,
        stripe: {
          requestId: error?.requestId || error?.raw?.requestId,
          type: error?.type || error?.rawType,
        },
      },
      { status: statusCode }
    )
  }
}
