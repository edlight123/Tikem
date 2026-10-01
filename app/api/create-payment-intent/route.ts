import { NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { calculateDiscount, resolvePromoCode, promoHasCapacity } from '@/lib/promo-codes'
import { resolvePromoterCode } from '@/lib/promoters'
import { attributionToStripeMetadata } from '@/lib/attribution'
import { resolveOrderAttribution } from '@/lib/tracking-links'
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
import { friendlyStripeError } from '@/lib/checkout/stripe-errors'
import { getPlatformSettings } from '@/lib/admin/platform-settings'
import { getEventLocation } from '@/types/platform-settings'
import { fromCents } from '@/lib/ticketPricing'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import {
  checkDestinationReadiness,
  ORGANIZER_PAYMENTS_UNAVAILABLE,
  ORGANIZER_PAYMENTS_UNAVAILABLE_MESSAGE,
} from '@/lib/checkout/destination-readiness'
import { flagOrganizerCardCheckoutBlocked } from '@/lib/events/payout-health-notice'
import { hasEventAccess } from '@/lib/events/access-guard'
import { isPaidAllowed, countrySupport, defaultCurrencyForCountry } from '@/lib/country-support'
import {
  beginGuestCheckout,
  identityFromUser,
  type CheckoutIdentity,
} from '@/lib/guest/checkout'
import { guestTicketUrl, validateGuestContact } from '@/lib/guest/identity'

// Lazy load Stripe
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

    const {
      eventId,
      quantity = 1,
      tierId,
      promoCodeId,
      // Promoter attribution: the raw `?ref=` the buyer arrived with. Resolved
      // below; junk is silently dropped and never blocks the sale.
      refCode,
      // Tracking-link / utm attribution captured on the event page. Re-resolved
      // below; never blocks the sale.
      attribution: rawAttribution,
      fingerprint,
      guest,
      // Password-protected events: the code a GUEST is presenting with this order.
      // A signed-in buyer still unlocks through /api/events/verify-access and is
      // admitted by their stored grant, exactly as before.
      accessCode,
    } = await request.json()

    // A missing session is not fatal: a guest may buy by supplying
    // `guest: { name, email, phone }`. The contact is shape-checked HERE so the
    // security screens below have a real email to test, and the full validation +
    // guest-order creation happens after the event is loaded (the phone requirement
    // depends on the event's country).
    const guestPreflight = user ? null : validateGuestContact(guest, { requirePhone: false })
    if (!user && (!guestPreflight || !guestPreflight.ok)) {
      return guestPreflight && !guestPreflight.ok
        ? NextResponse.json({ error: guestPreflight.error, code: guestPreflight.code }, { status: 400 })
        : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const buyerEmail = user ? String(user.email || '') : guestPreflight!.ok ? guestPreflight!.contact.email : ''
    // What the abuse screens key on. A guest has no stable account to rate-limit, so
    // `null` scopes the limit to their IP — the control that actually applies to them.
    const rateLimitKey = user ? user.id : null
    const attemptUserId = user ? user.id : `guest:${buyerEmail}`

    // Get IP address
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'

    // Security checks (same as checkout session)
    if (user) {
      const userBlacklist = await isBlacklisted(user.id, 'user')
      if (userBlacklist.blacklisted) {
        await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
        return NextResponse.json({
          error: `Account suspended: ${userBlacklist.reason}`
        }, { status: 403 })
      }
    }

    const emailBlacklist = await isBlacklisted(buyerEmail, 'email')
    if (emailBlacklist.blacklisted) {
      await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json({ 
        error: 'Unable to process purchase. Please contact support.' 
      }, { status: 403 })
    }

    const ipBlacklist = await isBlacklisted(ipAddress, 'ip')
    if (ipBlacklist.blacklisted) {
      await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json({ 
        error: 'Unable to process purchase from this network.' 
      }, { status: 403 })
    }

    const rateLimit = await shouldRateLimit(rateLimitKey, ipAddress, eventId)
    if (rateLimit.limited) {
      await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json({ 
        error: rateLimit.reason 
      }, { status: 429 })
    }

    const isBot = await detectBotBehavior(rateLimitKey, ipAddress, fingerprint)
    if (isBot) {
      await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
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
      await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    // Resolve the buyer now that the event (and therefore the country's phone rule and
    // the password gate) is known. For a signed-in user this is their own identity,
    // unchanged; for a guest it mints the `guest_…` id and the signed retrieval token.
    let identity: CheckoutIdentity
    if (user) {
      identity = identityFromUser(user)
    } else {
      const guestOutcome = await beginGuestCheckout({
        guestInput: guest,
        event,
        eventId: String(eventId),
        ipAddress,
        accessCode,
      })
      if (!guestOutcome.ok) {
        await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
        return guestOutcome.response
      }
      identity = guestOutcome.identity
    }

    // Password-protected events: require a valid access grant before payment.
    if (!(await hasEventAccess(event, eventId, identity.id))) {
      await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json({ error: 'access_code_required' }, { status: 403 })
    }

    // Defense in depth: never take money for a country whose payout rail isn't
    // ready (coming-soon markets like the Dominican Republic). Publish is already
    // gated, but block at the payment entry too in case a paid event slipped through.
    if (!isPaidAllowed(event.country)) {
      const name = countrySupport(event.country)?.name || 'this country'
      await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json(
        { error: `Payouts are not yet available in ${name}.` },
        { status: 400 }
      )
    }

    const provider = getPaymentProviderForEventCountry(event.country)
    if (provider === 'sogepay') {
      await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json(
        { error: 'Card payments for Haiti events use Sogepay. Please use the Sogepay checkout flow.' },
        { status: 400 }
      )
    }

    // Check ticket limit.
    //
    // Only meaningful for an account: the limit counts tickets already held under an
    // attendee id, and a guest's id is minted fresh for this order, so the answer would
    // always be zero. Guests are instead held back by the IP rate limit and the event's
    // own inventory. (Per-buyer caps for guests would need an email-keyed counter —
    // deliberately not invented here.)
    if (!identity.isGuest) {
      const ticketLimit = await checkTicketLimit(identity.id, eventId)
      if (ticketLimit.exceeded) {
        await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
        return NextResponse.json({
          error: `You already have ${ticketLimit.currentCount} ticket(s) for this event. Maximum allowed: ${ticketLimit.maxAllowed}`
        }, { status: 400 })
      }

      if (ticketLimit.currentCount! + quantity > ticketLimit.maxAllowed!) {
        await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
        const remaining = ticketLimit.maxAllowed! - ticketLimit.currentCount!
        return NextResponse.json({
          error: `You can only purchase ${remaining} more ticket(s) for this event (limit: ${ticketLimit.maxAllowed})`
        }, { status: 400 })
      }
    }

    // Get tier price if specified
    let finalPrice = event.ticket_price
    let tierName = 'General Admission'
    // Track the pre-discount price so metadata/originalPrice is accurate.
    let basePriceBeforePromo = finalPrice

    if (tierId) {
      const { data: tier } = await supabase
        .from('ticket_tiers')
        .select('*')
        .eq('id', tierId)
        .single()

      if (tier) {
        const now = new Date()
        const salesStart = tier.sales_start ? new Date(tier.sales_start) : null
        const salesEnd = tier.sales_end ? new Date(tier.sales_end) : null

        if (tier.is_active === false) {
          await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
          return NextResponse.json({ error: 'This ticket tier is not available.' }, { status: 400 })
        }
        if (salesStart && !Number.isNaN(salesStart.getTime()) && salesStart > now) {
          await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
          return NextResponse.json({ error: 'Ticket sales for this tier have not started yet.' }, { status: 400 })
        }
        if (salesEnd && !Number.isNaN(salesEnd.getTime()) && salesEnd < now) {
          await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
          return NextResponse.json({ error: 'Ticket sales for this tier have ended.' }, { status: 400 })
        }

        const sold = Number(tier.sold_quantity || 0)
        const total = Number(tier.total_quantity || 0)
        const remaining = Math.max(0, total - sold)
        if (remaining <= 0) {
          await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
          return NextResponse.json({ error: 'This ticket tier is sold out.' }, { status: 400 })
        }
        if (quantity > remaining) {
          await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
          return NextResponse.json({ error: `Only ${remaining} ticket(s) remaining for this tier.` }, { status: 400 })
        }

        finalPrice = tier.price
        basePriceBeforePromo = finalPrice
        tierName = tier.name
      }
    }

    // Apply promo code if provided (Firestore). resolvePromoCode accepts either the
    // Firestore doc id OR the raw code string (the incoming `promoCodeId` field may
    // carry either). We only apply the discount when the promo still has capacity;
    // the cap is enforced atomically at CONFIRM time in the Stripe webhook, so a
    // promo that fills up before payment simply charges full price (never blocks the
    // sale). `resolvedPromoId` is stamped into metadata so the webhook redeems the
    // exact promo doc — and only when a discount was actually applied here.
    let resolvedPromoId = ''
    if (promoCodeId) {
      const promo = await resolvePromoCode(String(eventId), String(promoCodeId))
      if (promo && promoHasCapacity(promo)) {
        resolvedPromoId = promo.id
        const { discountedPrice } = calculateDiscount(finalPrice, promo)
        finalPrice = discountedPrice
      }
    }

    // Resolve the promoter ref, if any. Only the resolved doc id + code ride in
    // metadata; fulfillment writes the attribution ledger exactly once under its
    // claim. An unknown/inactive code attributes nothing and changes nothing.
    const promoter = refCode ? await resolvePromoterCode(String(eventId), String(refCode)) : null
    const attribution = await resolveOrderAttribution(String(eventId), rawAttribution, promoter?.code || null)

    // Handle currency conversion for Stripe.
    // Charge currency follows the event's stored currency; when absent, fall back
    // to the country default (USD/CAD/EUR/HTG) — never hardcode USD, so FR (EUR)
    // settles in EUR.
    const eventCurrency = (event.currency?.toUpperCase() || defaultCurrencyForCountry(event.country).toUpperCase()) as string
    let stripeAmount = finalPrice
    let stripeCurrency = eventCurrency.toLowerCase()
    let exchangeRateUsed: number | null = null
    let originalCurrency = eventCurrency
    
    // Convert HTG to USD for Stripe if needed (Stripe doesn't support HTG directly)
    if (eventCurrency === 'HTG') {
      const { fetchStripeHTGRate } = await import('@/lib/currency')
      // Fetch live exchange rate from Stripe
      exchangeRateUsed = await fetchStripeHTGRate()
      stripeAmount = finalPrice * exchangeRateUsed
      stripeCurrency = 'usd'
      console.log(`💱 Converting ${finalPrice} HTG to ${stripeAmount.toFixed(2)} USD (Stripe rate: ${exchangeRateUsed})`)
    }

    // ── WHO PAYS THE FEE ────────────────────────────────────────────────────────
    // The face value is what the organizer advertised. Whether the buyer is charged
    // that exact amount or that amount PLUS the fee is a property of the event's
    // country (lib/country-support.ts), and the arithmetic belongs to lib/fees.ts. Both are called, never reimplemented.
    //
    // Recomputed here from the event's / tier's own stored price every time: the
    // client sends a quantity and a tier, never a total.
    //
    // Haiti keeps its exact previous behaviour: 'organizer' incidence returns
    // chargeAmount === faceValue and buyerFee === 0, so `amountCents` below is the
    // same number this route has always charged.
    //
    // The rate and the per-ticket fee cap come from the STORED platform settings,
    // so an admin can retune either without a deploy; the cap scales with quantity
    // because it is per ticket. `stripeCurrency` is what the card is actually
    // charged in — an HTG event converted to USD is capped in USD, matching the
    // money that moves.
    const faceValueCents = Math.round(stripeAmount * quantity * 100)
    const platformSettings = await getPlatformSettings()
    const locationFees =
      getEventLocation(String(event.country || '')) === 'haiti'
        ? platformSettings.haiti
        : platformSettings.usCanada
    const buyerPricing = priceOrderCents(faceValueCents, event, {
      quantity,
      currency: stripeCurrency.toUpperCase(),
      config: locationFees,
    })
    const amountCents = buyerPricing.chargeAmount
    let stripeConnectAccountId: string | null = null
    let applicationFeeAmount: number | null = null

    if (provider === 'stripe_connect') {
      const organizerId = String(event.organizer_id || '')
      if (!organizerId) {
        await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
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
        await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
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

      // Collect exactly the difference between what the buyer paid and what the
      // organizer is owed as the Connect application fee. Under organizer incidence
      // that is platform fee + processing fee (unchanged); under buyer incidence it
      // is the fee the buyer paid on top, so the organizer nets the face value to
      // the cent; Stripe's processing comes out of the platform's share.
      applicationFeeAmount = applicationFeeFor(buyerPricing)
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents, // Convert to cents
      currency: stripeCurrency,
      ...(stripeConnectAccountId
        ? {
            transfer_data: {
              destination: stripeConnectAccountId,
            },
            application_fee_amount: applicationFeeAmount || undefined,
          }
        : {}),
      metadata: {
        eventId,
        // A `guest_…` id for guest checkout. The webhook writes it to the ticket's
        // attendee_id exactly as it does a uid — scanning reads the ticket, not a session.
        userId: identity.id,
        // Guest contact, captured BEFORE payment and carried on the order. The webhook
        // resolves the confirmation recipient from these, never from a request body.
        ...(identity.isGuest
          ? {
              isGuest: 'true',
              guestName: identity.name,
              guestEmail: identity.email,
              guestPhone: identity.phone || '',
              guestOrderKey: identity.guestOrderKey || '',
            }
          : {}),
        eventTitle: event.title,
        quantity: quantity.toString(),
        tierId: tierId || '',
        tierName,
        promoCodeId: resolvedPromoId,
        promoterId: promoter?.id || '',
        promoterCode: promoter?.code || '',
        // trackingLinkId / utmSource / utmMedium / utmCampaign — read back at
        // fulfillment, stamped on the tickets and counted on the link once.
        ...attributionToStripeMetadata(attribution),
        originalPrice: basePriceBeforePromo.toString(),
        finalPrice: finalPrice.toString(),
        // Additive audit trail for fee incidence. `finalPrice` / `originalPrice` /
        // `priceInOriginalCurrency` keep their existing meaning (the FACE value per
        // ticket, in the event's currency), so fulfillment still records
        // `price_paid` as what the organizer sold the ticket for — which under buyer
        // incidence is also exactly what they receive.
        feeIncidence: buyerPricing.incidence,
        faceValueCents: String(faceValueCents),
        buyerFeeCents: String(buyerPricing.buyerFee),
        chargeAmountCents: String(amountCents),
        organizerNetCents: String(buyerPricing.organizerNet),
        currency: stripeCurrency,
        originalCurrency: originalCurrency,
        exchangeRate: exchangeRateUsed?.toString() || '',
        priceInOriginalCurrency: finalPrice.toString(),
        payoutProvider: provider,
        stripeConnectAccountId: stripeConnectAccountId || '',
      },
      description: `${quantity}x ${event.title} - ${tierName}`,
      receipt_email: identity.email || undefined,
      automatic_payment_methods: {
        enabled: true,
      },
    })

    // Log successful attempt
    await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, true)

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      // The authoritative breakdown, so the payment sheet shows the number the card
      // is about to be charged rather than the client's own arithmetic. Major units,
      // in the currency actually being charged.
      pricing: {
        currency: stripeCurrency.toUpperCase(),
        incidence: buyerPricing.incidence,
        faceValue: fromCents(buyerPricing.faceValue),
        buyerFee: fromCents(buyerPricing.buyerFee),
        total: fromCents(amountCents),
        quantity,
      },
      // Where a guest goes once the card succeeds — they have no /tickets page to
      // land on. Returned only to the browser that just minted this order.
      ...(identity.isGuest && identity.guestToken
        ? { guestTicketUrl: guestTicketUrl(identity.guestToken) }
        : {}),
    })
  } catch (error: any) {
    // Log the real thing — it carries the account id and Stripe's own wording,
    // which is what you need to diagnose it.
    console.error('Payment Intent creation error:', error)

    // Return something a buyer can act on. Passing `error.message` through is how
    // "No such destination: 'acct_1Sfyt…'" ended up rendered in the app.
    const friendly = friendlyStripeError(error)
    return NextResponse.json(
      { error: friendly.message, code: friendly.code },
      { status: friendly.status }
    )
  }
}
