import { NextResponse } from 'next/server'
import { friendlyStripeError } from '@/lib/checkout/stripe-errors'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { sendEmail, getTicketConfirmationEmail } from '@/lib/email'
import { generateTicketQRCode } from '@/lib/qrcode'
import { calculateDiscount, resolvePromoCode, promoHasCapacity } from '@/lib/promo-codes'
import { 
  isBlacklisted, 
  shouldRateLimit, 
  checkTicketLimit, 
  logPurchaseAttempt,
  detectBotBehavior,
  logSuspiciousActivity 
} from '@/lib/security'
import { adminDb } from '@/lib/firebase/admin'
import { getPaymentProviderForEventCountry } from '@/lib/payment-provider'
import { applicationFeeFor, priceOrderCents } from '@/lib/checkout/buyer-pricing'
import { getPlatformSettings } from '@/lib/admin/platform-settings'
import { getEventLocation } from '@/types/platform-settings'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import {
  checkDestinationReadiness,
  ORGANIZER_PAYMENTS_UNAVAILABLE,
  ORGANIZER_PAYMENTS_UNAVAILABLE_MESSAGE,
} from '@/lib/checkout/destination-readiness'
import { flagOrganizerCardCheckoutBlocked } from '@/lib/events/payout-health-notice'
import { hasEventAccess } from '@/lib/events/access-guard'
import { isPaidAllowed, countrySupport, defaultCurrencyForCountry } from '@/lib/country-support'

// Lazy load Stripe to avoid build-time initialization
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

export async function POST(request: Request) {
  try {
    const stripe = getStripe()
    const user = await getCurrentUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { eventId, quantity = 1, promoCodeId, fingerprint } = await request.json()

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'

    // Security checks
    // 1. Check if user is blacklisted
    const userBlacklist = await isBlacklisted(user.id, 'user')
    if (userBlacklist.blacklisted) {
      await logPurchaseAttempt({ userId: user.id, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json({ 
        error: `Account suspended: ${userBlacklist.reason}` 
      }, { status: 403 })
    }

    // 2. Check if email is blacklisted
    const emailBlacklist = await isBlacklisted(user.email, 'email')
    if (emailBlacklist.blacklisted) {
      await logPurchaseAttempt({ userId: user.id, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json({ 
        error: 'Unable to process purchase. Please contact support.' 
      }, { status: 403 })
    }

    // 3. Check if IP is blacklisted
    const ipBlacklist = await isBlacklisted(ipAddress, 'ip')
    if (ipBlacklist.blacklisted) {
      await logPurchaseAttempt({ userId: user.id, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json({ 
        error: 'Unable to process purchase from this network.' 
      }, { status: 403 })
    }

    // 4. Check rate limiting
    const rateLimit = await shouldRateLimit(user.id, ipAddress, eventId)
    if (rateLimit.limited) {
      await logPurchaseAttempt({ userId: user.id, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json({ 
        error: rateLimit.reason 
      }, { status: 429 })
    }

    // 5. Detect bot behavior
    const isBot = await detectBotBehavior(user.id, ipAddress, fingerprint)
    if (isBot) {
      await logPurchaseAttempt({ userId: user.id, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json({ 
        error: 'Automated purchase attempts are not allowed.' 
      }, { status: 403 })
    }

    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 })
    }

    const supabase = await createClient()

    // Fetch event details
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single()

    if (eventError || !event) {
      await logPurchaseAttempt({ userId: user.id, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    // Password-protected events: require a valid access grant before any Stripe
    // session is created (mirrors create-payment-intent). Without this, a
    // password-gated event could be purchased through this legacy endpoint
    // without ever entering the code.
    if (!(await hasEventAccess(event, eventId, user.id))) {
      await logPurchaseAttempt({ userId: user.id, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json({ error: 'access_code_required' }, { status: 403 })
    }

    // Sale-window enforcement: intentionally NOT done here.
    // Sale windows (sales_start / sales_end / is_active / sold-out) live on
    // `ticket_tiers`, not on `events` — the events row this route loads carries
    // no sale-bound columns (see types/database.ts). This legacy endpoint takes
    // no tierId and prices off `event.ticket_price`, so it has no tier to check.
    // Per-tier sale-window enforcement therefore lives in the tiered routes
    // (create-payment-intent, sogepay/moncash initiate); this single-price route
    // only enforces the password/access guard above. No event-level sale bounds
    // are fabricated here.

    // Defense in depth: never take money for a country whose payout rail isn't
    // ready (coming-soon markets like the Dominican Republic). Publish is already
    // gated, but block at the payment entry too in case a paid event slipped through.
    if (!isPaidAllowed(event.country)) {
      const name = countrySupport(event.country)?.name || 'this country'
      await logPurchaseAttempt({ userId: user.id, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json(
        { error: `Payouts are not yet available in ${name}.` },
        { status: 400 }
      )
    }

    const provider = getPaymentProviderForEventCountry(event.country)
    if (provider === 'sogepay') {
      await logPurchaseAttempt({ userId: user.id, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json(
        { error: 'Card payments for Haiti events use Sogepay. Please use the Sogepay checkout flow.' },
        { status: 400 }
      )
    }

    // 6. Check per-event ticket limit
    const ticketLimit = await checkTicketLimit(user.id, eventId)
    if (ticketLimit.exceeded) {
      await logPurchaseAttempt({ userId: user.id, eventId, ipAddress, quantity, fingerprint }, false)
      await logSuspiciousActivity({
        userId: user.id,
        activityType: 'rapid_purchases',
        description: `User attempted to purchase beyond limit: ${ticketLimit.currentCount}/${ticketLimit.maxAllowed}`,
        severity: 'medium',
        ipAddress,
        metadata: { eventId, attemptedQuantity: quantity, ...ticketLimit },
      })
      return NextResponse.json({ 
        error: `You already have ${ticketLimit.currentCount} ticket(s) for this event. Maximum allowed: ${ticketLimit.maxAllowed}` 
      }, { status: 400 })
    }

    // Check if adding this quantity would exceed limit
    if (ticketLimit.currentCount! + quantity > ticketLimit.maxAllowed!) {
      await logPurchaseAttempt({ userId: user.id, eventId, ipAddress, quantity, fingerprint }, false)
      const remaining = ticketLimit.maxAllowed! - ticketLimit.currentCount!
      return NextResponse.json({ 
        error: `You can only purchase ${remaining} more ticket(s) for this event (limit: ${ticketLimit.maxAllowed})` 
      }, { status: 400 })
    }

    let finalPrice = event.ticket_price
    // Firestore doc id of the promo actually applied — stamped into Stripe metadata so the
    // webhook (checkout.session.completed) redeems the exact promo doc, and ONLY when a discount
    // was truly applied here. Empty string = no promo (charge full price).
    let resolvedPromoId = ''

    // Apply promo code if provided (Firestore). resolvePromoCode accepts either the Firestore
    // doc id OR the raw code. We only apply the discount when the promo still has capacity; the
    // "first N buyers" cap is enforced atomically at CONFIRM time in the Stripe webhook, so a
    // promo that fills before payment simply charges full price and never blocks the sale.
    if (promoCodeId) {
      const promo = await resolvePromoCode(String(eventId), String(promoCodeId))
      if (promo && promoHasCapacity(promo)) {
        resolvedPromoId = promo.id
        const { discountedPrice } = calculateDiscount(event.ticket_price, promo)
        finalPrice = discountedPrice
      }
    }

    // Create Stripe checkout session
    // IMPORTANT: derive origin from the incoming request to avoid redirects to stale/deleted deployments
    // when NEXT_PUBLIC_APP_URL is misconfigured.
    const origin = new URL(request.url).origin

    const unitAmountCents = Math.round(finalPrice * 100)
    const totalAmountCents = unitAmountCents * quantity
    // WHO PAYS THE FEE. Recomputed server-side from the stored price, for the ORDER
    // as a whole (the fixed component of the processing fee is per transaction).
    // Haiti is organizer-pays: `buyerFee` is 0 and the session below is unchanged.
    // Rate and per-ticket cap come from the stored platform settings.
    const platformSettings = await getPlatformSettings()
    const buyerPricing = priceOrderCents(totalAmountCents, event, {
      quantity,
      currency: (event.currency || defaultCurrencyForCountry(event.country) || '').toUpperCase(),
      config:
        getEventLocation(String(event.country || '')) === 'haiti'
          ? platformSettings.haiti
          : platformSettings.usCanada,
    })
    let stripeConnectAccountId: string | null = null
    let applicationFeeAmount: number | null = null

    if (provider === 'stripe_connect') {
      const organizerId = String(event.organizer_id || '')
      if (!organizerId) {
        await logPurchaseAttempt({ userId: user.id, eventId, ipAddress, quantity, fingerprint }, false)
        return NextResponse.json({ error: 'Event organizer is missing.' }, { status: 400 })
      }

      const stripeProfile = await getPayoutProfile(organizerId, 'stripe_connect')
      const stripeAccountId = stripeProfile?.stripeAccountId

      // Ask Stripe whether this destination can take the charge BEFORE creating
      // anything. Organizers onboarded under the previous platform account carry an
      // acct_ id the live platform has never seen; letting the create call fail
      // is how "No such destination: 'acct_…'" reached a buyer's screen. A typed
      // code lets the app localize it and steer the buyer to another method, and
      // the organizer is told (deduped with the nightly Connect sweep).
      const readiness = await checkDestinationReadiness(stripeAccountId, { stripe })
      if (!readiness.ok || !stripeAccountId) {
        const reason = readiness.ok ? 'missing' : readiness.reason
        console.warn('card checkout refused: organizer destination not ready', {
          eventId,
          organizerId,
          reason,
        })
        await logPurchaseAttempt({ userId: user.id, eventId, ipAddress, quantity, fingerprint }, false)
        await flagOrganizerCardCheckoutBlocked({
          organizerId,
          event,
          eventId: String(eventId),
          reason,
        })
        return NextResponse.json(
          {
            error: ORGANIZER_PAYMENTS_UNAVAILABLE_MESSAGE,
            code: ORGANIZER_PAYMENTS_UNAVAILABLE,
          },
          { status: 409 }
        )
      }

      stripeConnectAccountId = stripeAccountId

      // Collect exactly what the buyer paid above the organizer's take. Under
      // organizer incidence (Haiti) that is platform fee + processing fee — the same
      // number this route always collected; under buyer incidence it is the fee added
      // on top, so the organizer nets the face value.
      applicationFeeAmount = applicationFeeFor(buyerPricing)
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            // Charge currency follows the event's stored currency; when absent,
            // fall back to the country default (USD/CAD/EUR) — never hardcode USD,
            // so FR (EUR) settles in EUR.
            currency: (event.currency || defaultCurrencyForCountry(event.country)).toLowerCase(),
            product_data: {
              name: event.title,
              description: event.description?.substring(0, 200),
              images: event.banner_image_url ? [event.banner_image_url] : [],
            },
            unit_amount: unitAmountCents, // Convert to cents
          },
          quantity,
        },
        // The fee as its OWN line item, so Stripe's hosted page shows the buyer both
        // the ticket price and the fee, and totals them itself. Present only in
        // buyer-pays markets; Haiti's session keeps exactly one line.
        ...(buyerPricing.buyerFee > 0
          ? [
              {
                price_data: {
                  currency: (event.currency || defaultCurrencyForCountry(event.country)).toLowerCase(),
                  product_data: { name: 'Service fee' },
                  unit_amount: buyerPricing.buyerFee,
                },
                quantity: 1,
              },
            ]
          : []),
      ],
      mode: 'payment',
      success_url: `${origin}/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/events/${eventId}`,
      client_reference_id: user.id,
      ...(stripeConnectAccountId
        ? {
            payment_intent_data: {
              transfer_data: {
                destination: stripeConnectAccountId,
              },
              application_fee_amount: applicationFeeAmount || undefined,
            },
          }
        : {}),
      metadata: {
        eventId,
        userId: user.id,
        quantity: quantity.toString(),
        // Resolved Firestore promo doc id (only set when a discount was applied), so the
        // webhook redeems the exact promo. originalPrice/finalPrice let the webhook compute
        // the per-order discount recorded on the redemption.
        promoCodeId: resolvedPromoId,
        originalPrice: event.ticket_price.toString(),
        finalPrice: finalPrice.toString(),
        payoutProvider: provider,
        stripeConnectAccountId: stripeConnectAccountId || '',
        // Who bore the fee on this order. The webhook stamps it onto each ticket so
        // the organizer earnings ledger knows whether a fee was already collected
        // from the buyer or still has to come out of the organizer's gross.
        feeIncidence: buyerPricing.incidence,
      },
    })

    // Log successful purchase attempt
    await logPurchaseAttempt({ userId: user.id, eventId, ipAddress, quantity, fingerprint }, true)

    return NextResponse.json({ sessionId: session.id, url: session.url })
  } catch (error: any) {
    console.error('Stripe checkout error:', error)
    
    // Log failed purchase attempt (if we have the necessary data)
    try {
      const body = await error.request?.json?.() || {}
      const ipAddress = error.request?.headers?.get('x-forwarded-for') || 'unknown'
      if (body.eventId && body.userId) {
        await logPurchaseAttempt(
          { 
            userId: body.userId, 
            eventId: body.eventId, 
            ipAddress, 
            quantity: body.quantity || 1,
            fingerprint: body.fingerprint 
          }, 
          false
        )
      }
    } catch (logError) {
      // Ignore logging errors
    }
    
    // Buyer-facing copy only — Stripe's own messages carry account ids.
    const friendly = friendlyStripeError(error)
    return NextResponse.json(
      { error: friendly.message, code: friendly.code },
      { status: friendly.status }
    )
  }
}
