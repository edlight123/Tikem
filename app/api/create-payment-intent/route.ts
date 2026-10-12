import { NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { resolvePromoCode, promoBuyerKey, promoCanCoverOrder } from '@/lib/promo-codes'
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
import { applicationFeeFor, applyPromoToLines, priceTierLinesCents } from '@/lib/checkout/buyer-pricing'
import {
  CARD_ORDER_LINES_KEY,
  STRIPE_METADATA_VALUE_MAX,
  encodeCardOrderLines,
} from '@/lib/checkout/card-order-lines'
import { friendlyStripeError } from '@/lib/checkout/stripe-errors'
import { MIN_PAID_PRICE_ERROR_CODE, isBelowMinPaidPrice, minPaidPriceFor } from '@/lib/min-paid-price'
import {
  GUEST_ALREADY_CLAIMED_MESSAGE,
  MAX_FREE_TICKETS_PER_CLAIM,
  freeClaimAlreadyUsed,
} from '@/lib/tickets/free-claim-policy'
import { getPlatformSettings } from '@/lib/admin/platform-settings'
import { locationFeesForCountry } from '@/types/platform-settings'
import { fromCents } from '@/lib/ticketPricing'
import { requestLanguage } from '@/lib/fx/usd-htg'
import { buildTierSoldIncrements } from '@/lib/tickets/inventory'
import {
  createSeatHold,
  releaseSeatHold,
  seatHoldForClient,
  seatHoldOwnerKey,
  seatHoldRefusal,
} from '@/lib/tickets/seatHolds'
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
import {
  checkEventPurchasable,
  checkTierForEvent,
  invalidQuantityRefusal,
  normalizeTierLines,
  parseTicketQuantity,
  pickTierWhenUnspecified,
  type TierLine,
} from '@/lib/tickets/purchasable'

/** The event's own currency, or its country's default. */
function eventCurrencyFor(event: any): string {
  return String(event?.currency || defaultCurrencyForCountry(event?.country)).toUpperCase()
}

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
      quantity: rawQuantity = 1,
      tierId,
      // A multi-tier cart: `[{ tierId, quantity }]`, the same shape MonCash and
      // Sogepay take. When present it wins over `tierId` + `quantity`, which stay
      // supported for single-tier clients (older web builds and the mobile app).
      tiers: rawTiers,
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

    // A whole number of tickets, 1..MAX_TICKETS_PER_ORDER. A fractional quantity used
    // to be charged pro rata (0.01 → 1% of a ticket) while fulfillment still issued a
    // whole ticket; refuse anything that is not a plain integer instead of rounding.
    // Every line of a multi-tier cart is held to the same rule, and so is the cart
    // as a whole (normalizeTierLines merges a tier listed twice).
    const multiTier = Array.isArray(rawTiers) && rawTiers.length > 0
    let requestedLines: TierLine[] = []
    let quantity: number
    if (multiTier) {
      const lines = normalizeTierLines(rawTiers)
      if (!lines.ok) {
        return NextResponse.json({ error: lines.error, code: lines.code }, { status: lines.status })
      }
      if (lines.lines.length === 0) {
        return NextResponse.json({ error: 'No valid ticket tiers selected' }, { status: 400 })
      }
      requestedLines = lines.lines
      quantity = requestedLines.reduce((sum, l) => sum + l.quantity, 0)
    } else {
      const parsed = parseTicketQuantity(rawQuantity)
      if (parsed === null) {
        const refusal = invalidQuantityRefusal()
        return NextResponse.json({ error: refusal.error, code: refusal.code }, { status: refusal.status })
      }
      quantity = parsed
    }

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

    // Cancelled, unpublished, rejected or finished events do not take money.
    const purchasable = checkEventPurchasable(event)
    if (!purchasable.ok) {
      await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json(
        { error: purchasable.error, code: purchasable.code },
        { status: purchasable.status }
      )
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

    // ── WHAT IS BEING BOUGHT ────────────────────────────────────────────────────
    // Every line is priced from its tier's STORED price. The client sends tiers
    // and quantities, never prices.
    //
    // The tier must belong to THIS event and be active. It used to be read by id
    // alone, so another event's cheaper tier could price this one, and an unknown id
    // silently fell back to `event.ticket_price` (the event's LOWEST tier price).
    const refuse = async (body: Record<string, any>, status: number) => {
      await logPurchaseAttempt({ userId: attemptUserId, eventId, ipAddress, quantity, fingerprint }, false)
      return NextResponse.json(body, { status })
    }
    const now = new Date()
    /** The same on-sale + inventory rules for every line, single-tier or not. */
    const tierSaleRefusal = (tier: any, lineQuantity: number, named: boolean): string | null => {
      const salesStart = tier.sales_start ? new Date(tier.sales_start) : null
      const salesEnd = tier.sales_end ? new Date(tier.sales_end) : null
      if (tier.is_active === false) return 'This ticket tier is not available.'
      if (salesStart && !Number.isNaN(salesStart.getTime()) && salesStart > now) {
        return 'Ticket sales for this tier have not started yet.'
      }
      if (salesEnd && !Number.isNaN(salesEnd.getTime()) && salesEnd < now) {
        return 'Ticket sales for this tier have ended.'
      }
      const sold = Number(tier.sold_quantity || 0)
      const total = Number(tier.total_quantity || 0)
      const remaining = Math.max(0, total - sold)
      if (remaining <= 0) return 'This ticket tier is sold out.'
      if (lineQuantity > remaining) {
        return `Only ${remaining} ticket(s) remaining for ${named ? tier.name || 'this tier' : 'this tier'}.`
      }
      return null
    }

    const orderLines: { tierId: string; tierName: string; quantity: number; price: number }[] = []
    if (multiTier) {
      const tierDocs = await Promise.all(
        requestedLines.map((line) =>
          Promise.resolve(supabase.from('ticket_tiers').select('*').eq('id', line.tierId).single()).then(
            ({ data }: any) => data
          )
        )
      )
      for (let i = 0; i < requestedLines.length; i++) {
        const line = requestedLines[i]
        const tier = tierDocs[i]
        const tierCheck = checkTierForEvent(tier, String(eventId))
        if (!tierCheck.ok) return refuse({ error: tierCheck.error, code: tierCheck.code }, tierCheck.status)
        const saleRefusal = tierSaleRefusal(tier, line.quantity, true)
        if (saleRefusal) return refuse({ error: saleRefusal }, 400)
        orderLines.push({
          tierId: String(tier.id ?? line.tierId),
          tierName: String(tier.name || 'Ticket'),
          quantity: line.quantity,
          price: Number(tier.price) || 0,
        })
      }
    } else {
      let tier: any = null
      if (tierId) {
        const { data } = await supabase
          .from('ticket_tiers')
          .select('*')
          .eq('id', String(tierId))
          .single()
        const tierCheck = checkTierForEvent(data, String(eventId))
        if (!tierCheck.ok) return refuse({ error: tierCheck.error, code: tierCheck.code }, tierCheck.status)
        tier = data
      } else {
        const { data: eventTiers } = await supabase
          .from('ticket_tiers')
          .select('*')
          .eq('event_id', String(eventId))
        const picked = pickTierWhenUnspecified(eventTiers as any[], String(eventId))
        if (!picked.ok) return refuse({ error: picked.error, code: picked.code }, picked.status)
        tier = picked.tier
      }
      if (tier) {
        const saleRefusal = tierSaleRefusal(tier, quantity, false)
        if (saleRefusal) return refuse({ error: saleRefusal }, 400)
      }
      // No tier docs at all (legacy single-price event): the event's own price.
      orderLines.push({
        tierId: tier ? String(tier.id) : '',
        tierName: tier ? tier.name : 'General Admission',
        quantity,
        price: tier ? tier.price : event.ticket_price,
      })
    }

    // Minimum paid price (US/CA 2.00, FR 1.00 EUR; free and Haiti exempt), on the
    // stored LIST price, before any promo. Publish enforces it too, but a tier can
    // be written straight to Firestore after publish, so checkout re-checks it.
    for (const line of orderLines) {
      if (isBelowMinPaidPrice(line.price, event.country)) {
        const minimum = minPaidPriceFor(event.country)
        return refuse(
          {
            error: `"${line.tierName}" is priced below the minimum of ${minimum?.toFixed(2)} ${eventCurrencyFor(event)} for a paid ticket, so it cannot be sold. Please contact the organizer.`,
            code: MIN_PAID_PRICE_ERROR_CODE,
          },
          400
        )
      }
    }

    // FREE lines in a mixed cart are held to the free-claim route's limits
    // (lib/tickets/free-claim-policy): at most 10 free tickets, and one free claim
    // per buyer per event. Without this a buyer could attach free tickets to a
    // cheap paid one, again and again. Inventory, sales window, active tier and
    // the access code were already enforced on every line above. Free is decided
    // on the LIST price, exactly as claim-free decides it. Fulfillment re-takes
    // the claim lock atomically before issuing.
    const freeQuantity = orderLines.reduce((sum, l) => sum + (Number(l.price) > 0 ? 0 : l.quantity), 0)
    if (freeQuantity > 0) {
      if (freeQuantity > MAX_FREE_TICKETS_PER_CLAIM) {
        return refuse(
          { error: `You can add at most ${MAX_FREE_TICKETS_PER_CLAIM} free tickets to an order.`, code: 'free_limit_exceeded' },
          400
        )
      }
      if (await freeClaimAlreadyUsed(String(eventId), identity)) {
        return refuse(
          {
            // A guest's answer stays neutral: the email they typed is unverified.
            error: identity.isGuest
              ? GUEST_ALREADY_CLAIMED_MESSAGE
              : 'You already have a free ticket for this event. Remove the free tier to continue.',
            code: 'already_claimed',
          },
          409
        )
      }
    }

    // Apply promo code if provided (Firestore). resolvePromoCode accepts either the
    // Firestore doc id OR the raw code string (the incoming `promoCodeId` field may
    // carry either). We only apply the discount when the promo still has capacity;
    // the cap is enforced atomically at CONFIRM time in the Stripe webhook, so a
    // promo that fills up before payment simply charges full price (never blocks the
    // sale). `resolvedPromoId` is stamped into metadata so the webhook redeems the
    // exact promo doc — and only when a discount was actually applied here.
    //
    // The discount is per ticket on every line (calculateDiscount, the function
    // MonCash, Sogepay and the free-claim route use), never once off the order.
    let resolvedPromoId = ''
    let appliedPromo: { discount_type: string; discount_value: number } | null = null
    if (promoCodeId) {
      const promo = await resolvePromoCode(String(eventId), String(promoCodeId))
      // Discount only when confirm-time redemption can honour it for THIS order's
      // quantity and buyer (same key the fulfillment redeem uses).
      if (promo && (await promoCanCoverOrder(promo, { qty: quantity, buyerKey: promoBuyerKey(identity) })).ok) {
        resolvedPromoId = promo.id
        appliedPromo = promo
      }
    }
    const pricedLines = applyPromoToLines(orderLines, appliedPromo)

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
    let stripeCurrency = eventCurrency.toLowerCase()
    let exchangeRateUsed: number | null = null
    let originalCurrency = eventCurrency

    // Convert HTG to USD for Stripe if needed (Stripe doesn't support HTG directly)
    if (eventCurrency === 'HTG') {
      const { fetchStripeHTGRate } = await import('@/lib/currency')
      // Fetch live exchange rate from Stripe
      exchangeRateUsed = await fetchStripeHTGRate()
      stripeCurrency = 'usd'
      console.log(`💱 Converting HTG to USD for Stripe (Stripe rate: ${exchangeRateUsed})`)
    }

    // ── WHO PAYS THE FEE ────────────────────────────────────────────────────────
    // The face value is what the organizer advertised. Whether the buyer is charged
    // that exact amount or that amount PLUS the fee is the organizer's choice for
    // this event (country default otherwise), and the arithmetic belongs to
    // lib/fees.ts via lib/checkout/buyer-pricing. Both are called, never reimplemented.
    //
    // Recomputed here from the event's / tier's own stored price every time: the
    // client sends a quantity and a tier, never a total.
    //
    // Haiti keeps its exact previous behaviour: 'organizer' incidence returns
    // chargeAmount === faceValue and buyerFee === 0, so `amountCents` below is the
    // same number this route has always charged.
    //
    // The rate comes from the STORED platform settings, so an admin can retune it
    // without a deploy. The fee is exactly that rate of the face total, with no
    // per-ticket cap (owner decision, 2026-10-05), in whatever currency the card
    // is charged, plus the market's fixed amount (US/CA/FR) per PAID ticket only —
    // a free tier in a mixed cart carries no fee.
    const platformSettings = await getPlatformSettings()
    const locationFees = locationFeesForCountry(platformSettings, event.country)
    const pricedOrder = priceTierLinesCents(pricedLines, event, {
      currency: stripeCurrency.toUpperCase(),
      config: locationFees,
      exchangeRate: exchangeRateUsed,
    })
    const faceValueCents = pricedOrder.faceValueCents
    const buyerPricing = pricedOrder.pricing

    // Nothing to charge: every ticket is free, or the promo takes the whole cart
    // to zero. Stripe refuses a 0 PaymentIntent, and free tickets are issued by
    // /api/tickets/claim-free, which re-checks that the order really is free.
    if (faceValueCents <= 0) {
      return refuse(
        { error: 'These tickets are free. Claim them instead of paying.', code: 'order_is_free' },
        400
      )
    }

    // The per-tier breakdown fulfillment issues from. A single line keeps the
    // original single-tier fields only, so it fulfils exactly as before.
    const isMultiLine = pricedLines.length > 1
    const singleLine = pricedLines[0]
    let encodedLines: string | null = null
    if (isMultiLine) {
      encodedLines = encodeCardOrderLines(
        pricedLines.map((l) => ({
          tierId: l.tierId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          unitOriginal: l.unitOriginal,
        }))
      )
      if (!encodedLines) {
        return refuse(
          { error: 'Too many ticket types in one order. Please split it into two orders.', code: 'too_many_tiers' },
          400
        )
      }
    }
    const tierName = isMultiLine
      ? pricedLines.map((l) => `${l.quantity}x ${l.tierName}`).join(', ').slice(0, STRIPE_METADATA_VALUE_MAX)
      : singleLine.tierName

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

    // HOLD the seats before any PaymentIntent exists (lib/tickets/seatHolds.ts). Fulfillment
    // converts the hold into a sale, so a buyer is never charged for a seat that is gone:
    // sold out (or not enough left) is a 409 here and nothing is created at Stripe.
    const seatHold = await createSeatHold({
      eventId: String(eventId),
      quantity,
      tierIncrements: buildTierSoldIncrements(pricedLines.map((l) => ({ tierId: l.tierId, quantity: l.quantity }))),
      ownerKey: seatHoldOwnerKey(identity),
      ipAddress,
      source: 'card',
      logPrefix: '[create-payment-intent]',
    })
    const holdRefusal = seatHoldRefusal(seatHold, requestLanguage(request))
    if (holdRefusal) return refuse(holdRefusal.body, holdRefusal.status)
    const clientHold = seatHoldForClient(seatHold)

    let paymentIntent: any
    try {
      paymentIntent = await stripe.paymentIntents.create({
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
          // Every ticket in the order, free lines included.
          quantity: quantity.toString(),
          // A multi-tier order has no single tier: `tierId` is empty and `t` carries
          // the per-tier breakdown (lib/checkout/card-order-lines) fulfillment issues
          // from. `tierName` is then a human summary ("1x VIP, 2x GA").
          tierId: isMultiLine ? '' : singleLine.tierId,
          tierName,
          ...(isMultiLine && encodedLines ? { [CARD_ORDER_LINES_KEY]: encodedLines } : {}),
          promoCodeId: resolvedPromoId,
          promoterId: promoter?.id || '',
          promoterCode: promoter?.code || '',
          // trackingLinkId / utmSource / utmMedium / utmCampaign — read back at
          // fulfillment, stamped on the tickets and counted on the link once.
          ...attributionToStripeMetadata(attribution),
          // Per-ticket face values of a single-tier order (event currency). A
          // multi-tier order's live per line in `t`, so these are not written for it.
          ...(isMultiLine
            ? {}
            : {
                originalPrice: singleLine.unitOriginal.toString(),
                finalPrice: singleLine.unitPrice.toString(),
                priceInOriginalCurrency: singleLine.unitPrice.toString(),
              }),
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
          payoutProvider: provider,
          stripeConnectAccountId: stripeConnectAccountId || '',
          // The seat hold fulfillment converts into a sale (empty: nothing was held).
          seatHoldId: clientHold ? clientHold.id : '',
        },
        description: isMultiLine ? `${event.title} - ${tierName}` : `${quantity}x ${event.title} - ${tierName}`,
        receipt_email: identity.email || undefined,
        automatic_payment_methods: {
          enabled: true,
        },
      })
    } catch (createError) {
      // No PaymentIntent, so nobody can pay against the hold: give the seats back.
      await releaseSeatHold(seatHold.holdId, { logPrefix: '[create-payment-intent]' })
      throw createError
    }

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
      // How long the seats are held, and the id that releases them when the sheet closes.
      ...(clientHold ? { seatHold: clientHold } : {}),
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
