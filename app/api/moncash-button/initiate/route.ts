import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import {
  beginGuestCheckout,
  guestOrderFields,
  identityFromUser,
  type CheckoutIdentity,
} from '@/lib/guest/checkout'
import { calculateDiscount, resolvePromoCode, promoBuyerKey, promoCanCoverOrder, type PromoDoc } from '@/lib/promo-codes'
import { resolvePromoterCode } from '@/lib/promoters'
import { resolveOrderAttribution } from '@/lib/tracking-links'
import { convertUsdToHtgAmount, getUsdToHtgRateWithSpread, sumMoney } from '@/lib/fx/usd-htg'
import { inferCountryFromEventText } from '@/lib/event-country'
import { capacityFromEvent } from '@/lib/capacity'
import { hasEventAccess } from '@/lib/events/access-guard'
import { isPaidAllowed, countrySupport } from '@/lib/country-support'
import {
  createMonCashButtonCheckoutToken,
  getMonCashButtonRedirectUrl,
  isMonCashButtonConfigured,
} from '@/lib/moncash-button'
import { prewarmMonCashAccessToken } from '@/lib/moncash'
import {
  checkEventPurchasable,
  checkTierForEvent,
  invalidQuantityRefusal,
  normalizeTierLines,
  parseTicketQuantity,
  pickTierWhenUnspecified,
} from '@/lib/tickets/purchasable'
import { screenPurchaseAttempt } from '@/lib/tickets/purchase-screens'
import { priceOrderCents } from '@/lib/checkout/buyer-pricing'
import { getPlatformSettings } from '@/lib/admin/platform-settings'
import { fromCents } from '@/lib/ticketPricing'

import crypto from 'crypto'

export const runtime = 'nodejs'

function buildTokenVariants(token: string): string[] {
  const raw = String(token || '').trim()
  if (!raw) return []

  const decoded = (() => {
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  })()

  const stripPadding = (v: string) => v.replace(/=+$/g, '')
  const toBase64 = (v: string) => v.replace(/-/g, '+').replace(/_/g, '/')
  const toBase64Url = (v: string) => v.replace(/\+/g, '-').replace(/\//g, '_')

  const candidates = [
    raw,
    decoded,
    stripPadding(raw),
    stripPadding(decoded),
    toBase64(raw),
    toBase64(decoded),
    stripPadding(toBase64(raw)),
    stripPadding(toBase64(decoded)),
    toBase64Url(raw),
    toBase64Url(decoded),
    stripPadding(toBase64Url(raw)),
    stripPadding(toBase64Url(decoded)),
  ]

  return Array.from(new Set(candidates.map((c) => c.trim()).filter(Boolean)))
}

type TierSelection = { tierId: string; quantity: number }

function tierIsOnSale(tier: any, now: Date): { ok: true } | { ok: false; reason: string } {
  if (tier?.is_active === false) return { ok: false, reason: 'This ticket tier is not available.' }

  const salesStart = tier?.sales_start ? new Date(tier.sales_start) : null
  const salesEnd = tier?.sales_end ? new Date(tier.sales_end) : null

  if (salesStart && !Number.isNaN(salesStart.getTime()) && salesStart > now) {
    return { ok: false, reason: 'Ticket sales for this tier have not started yet.' }
  }
  if (salesEnd && !Number.isNaN(salesEnd.getTime()) && salesEnd < now) {
    return { ok: false, reason: 'Ticket sales for this tier have ended.' }
  }

  const sold = Number(tier?.sold_quantity || 0)
  const total = Number(tier?.total_quantity || 0)
  const remaining = Math.max(0, total - sold)
  if (remaining <= 0) return { ok: false, reason: 'This ticket tier is sold out.' }

  return { ok: true }
}

export async function POST(request: Request) {
  try {
    // NOTE: a missing session is no longer fatal here. A guest may check out by
    // supplying `guest: { name, email, phone }` — resolved below, once the event is
    // loaded, because the rules depend on the event (phone is required for Haiti, and
    // password-protected events still demand a real account).
    if (!isMonCashButtonConfigured()) {
      return NextResponse.json({ error: 'MonCash Button is not configured' }, { status: 500 })
    }

    const {
      eventId,
      quantity: rawQuantity = 1,
      tierId,
      promoCode,
      refCode,
      attribution: rawAttribution,
      tiers,
      mobileMoneyProvider,
      forceFormPost,
      guest,
      accessCode,
      fingerprint,
    }: {
      eventId: string
      quantity?: unknown
      tierId?: string | null
      promoCode?: string | null
      /** Promoter attribution (`?ref=`). Resolved below; junk never blocks the sale. */
      refCode?: string | null
      /** Tracking-link / utm attribution from the event page. Re-resolved below. */
      attribution?: unknown
      tiers?: TierSelection[]
      mobileMoneyProvider?: string | null
      forceFormPost?: boolean
      guest?: { name?: string; email?: string; phone?: string }
      /** A GUEST's access code for a password-protected event. */
      accessCode?: string | null
      fingerprint?: string | null
    } = await request.json()

    const provider = String(mobileMoneyProvider || 'moncash').toLowerCase()
    const normalizedProvider = provider === 'natcash' ? 'natcash' : 'moncash'

    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 })
    }

    // Quantities are whole numbers, 1..MAX_TICKETS_PER_ORDER, on every line. A
    // fractional quantity used to be charged pro rata (0.01 → 1% of a ticket) while
    // fulfillment's loop still issued a whole ticket, and 1.01 paid for one and got two.
    const multiTier = Array.isArray(tiers) && tiers.length > 0
    let validSelections: TierSelection[] = []
    let quantity = 0
    if (multiTier) {
      const lines = normalizeTierLines(tiers)
      if (!lines.ok) {
        return NextResponse.json({ error: lines.error, code: lines.code }, { status: lines.status })
      }
      validSelections = lines.lines
      if (validSelections.length === 0) {
        return NextResponse.json({ error: 'No valid ticket tiers selected' }, { status: 400 })
      }
    } else {
      const parsed = parseTicketQuantity(rawQuantity)
      if (parsed === null) {
        const refusal = invalidQuantityRefusal()
        return NextResponse.json({ error: refusal.error, code: refusal.code }, { status: refusal.status })
      }
      quantity = parsed
    }
    const requestedQuantity = multiTier
      ? validSelections.reduce((sum, s) => sum + s.quantity, 0)
      : quantity

    const supabase = await createClient()

    // Latency: the session check (Firebase token verify + profile read) and the event
    // read are independent, so they run together instead of back to back.
    const [user, { data: event, error: eventError }] = await Promise.all([
      getCurrentUser(),
      Promise.resolve(supabase.from('events').select('*').eq('id', eventId).single()),
    ])

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    // Cancelled, unpublished, rejected or finished events do not take money.
    const purchasable = checkEventPurchasable(event)
    if (!purchasable.ok) {
      return NextResponse.json(
        { error: purchasable.error, code: purchasable.code },
        { status: purchasable.status }
      )
    }

    // Resolve the buyer: the signed-in user, or a validated guest contact record.
    // Guest checkout mints a `guest_…` id plus a signed retrieval token; everything
    // downstream (pending transaction, tickets, fulfillment) treats that id exactly
    // like a uid.
    let identity: CheckoutIdentity
    if (user) {
      identity = identityFromUser(user)
    } else {
      const guestOutcome = await beginGuestCheckout({
        guestInput: guest,
        event,
        eventId: String(eventId),
        ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
        accessCode,
      })
      if (!guestOutcome.ok) return guestOutcome.response
      identity = guestOutcome.identity
    }

    // Password-protected events: require a valid access grant before payment.
    // A guest reaches this line only after beginGuestCheckout verified the code they
    // presented and wrote a grant against their `guest_…` id, so this stays exactly
    // as strict as it was.
    if (!(await hasEventAccess(event, eventId, identity.id))) {
      return NextResponse.json({ error: 'access_code_required' }, { status: 403 })
    }

    // The same abuse screens the card path runs (blacklist, rate limit, bot check,
    // per-account ticket limit). This rail used to skip all of them.
    const ipAddress =
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const screen = await screenPurchaseAttempt({
      userId: identity.isGuest ? null : identity.id,
      email: String(identity.email || ''),
      isGuest: identity.isGuest,
      eventId: String(eventId),
      ipAddress,
      quantity: requestedQuantity,
      fingerprint: fingerprint || null,
    })
    if (!screen.ok) {
      return NextResponse.json({ error: screen.error }, { status: screen.status })
    }

    // Defense in depth: never take money for a country whose payout rail isn't
    // ready (coming-soon markets like the Dominican Republic). MonCash is Haiti-only
    // so this is belt-and-suspenders, but keep the guard so no paid entry is exempt.
    if (!isPaidAllowed(event.country)) {
      const name = countrySupport(event.country)?.name || 'this country'
      return NextResponse.json(
        { error: `Payouts are not yet available in ${name}.` },
        { status: 400 }
      )
    }

    // MonCash is Haiti-only. Do not fall back to organizer location here, otherwise
    // a US/CA event created by a Haiti organizer could be incorrectly routed to MonCash.
    const eventCountry = inferCountryFromEventText(event)
    if (eventCountry !== 'HT') {
      return NextResponse.json(
        { error: 'MonCash is only available for events in Haiti.' },
        { status: 400 }
      )
    }

    // Promo code (optional, Firestore). resolvePromoCode accepts either the Firestore doc id or
    // the raw code. We only apply the discount when the promo still has capacity; the "first N
    // buyers" cap is enforced atomically at CONFIRM time (in the return handler), so an
    // abandoned redirect never consumes a slot and a full promo just charges full price.
    //
    // Promoter attribution (optional). Only the RESOLVED doc id is persisted on the
    // pending transaction; an unknown or inactive ref attributes nothing.
    //
    // Latency: the promo, promoter/attribution and ticket-tier lookups are independent
    // Firestore reads, so they are issued together rather than one after another. The
    // validation below still runs in the original order on their results.
    const readTier = (id: string) =>
      Promise.resolve(supabase.from('ticket_tiers').select('*').eq('id', id).single()).then(
        ({ data }) => data as any
      )
    const [promo, { promoter, attribution }, tierDocs, singleTier, eventTiers] = await Promise.all([
      (async (): Promise<PromoDoc | null> => {
        if (!promoCode) return null
        const resolved = await resolvePromoCode(String(eventId), String(promoCode))
        if (!resolved) return null
        // Discount only when confirm-time redemption can honour it for this order's
        // quantity and buyer (the same key fulfillment redeems under).
        const cover = await promoCanCoverOrder(resolved, {
          qty: requestedQuantity,
          buyerKey: promoBuyerKey(identity),
        })
        return cover.ok ? resolved : null
      })(),
      (async () => {
        const promoter = refCode ? await resolvePromoterCode(String(eventId), String(refCode)) : null
        const attribution = await resolveOrderAttribution(String(eventId), rawAttribution, promoter?.code || null)
        return { promoter, attribution }
      })(),
      Promise.all(validSelections.map((sel) => readTier(sel.tierId))),
      !multiTier && tierId ? readTier(String(tierId)) : Promise.resolve(null),
      // No tierId on a single-line order: find out whether the event HAS tiers, so
      // the buyer cannot skip them by paying `event.ticket_price` (the lowest one).
      !multiTier && !tierId
        ? Promise.resolve(
            supabase.from('ticket_tiers').select('*').eq('event_id', String(eventId))
          ).then(({ data }) => (Array.isArray(data) ? data : []) as any[])
        : Promise.resolve(null),
    ])
    // Total discount applied across the order (event currency), recorded on the promo
    // redemption at confirm time. Accumulated as each selection is priced below.
    let promoDiscountTotal = 0

    // Normalize tier selections
    let normalizedSelections: { tierId: string | null; tierName: string; quantity: number; unitPrice: number }[] = []
    const now = new Date()

    if (multiTier) {
      // Multi-tier selection
      for (let i = 0; i < validSelections.length; i++) {
        const selection = validSelections[i]
        const tier = tierDocs[i]

        // Must exist, belong to THIS event, and be active — never skipped silently.
        const tierCheck = checkTierForEvent(tier, String(eventId))
        if (!tierCheck.ok) {
          return NextResponse.json({ error: tierCheck.error, code: tierCheck.code }, { status: tierCheck.status })
        }

        const onSale = tierIsOnSale(tier, now)
        if (!onSale.ok) {
          return NextResponse.json({ error: onSale.reason }, { status: 400 })
        }

        const sold = Number(tier.sold_quantity || 0)
        const total = Number(tier.total_quantity || 0)
        const remaining = Math.max(0, total - sold)
        if (selection.quantity > remaining) {
          return NextResponse.json({ error: `Only ${remaining} ticket(s) remaining for ${tier.name || 'this tier'}.` }, { status: 400 })
        }

        let unitPrice = tier.price
        if (promo) {
          const { discountedPrice, discountAmount } = calculateDiscount(unitPrice, promo)
          unitPrice = discountedPrice
          promoDiscountTotal += discountAmount * selection.quantity
        }

        normalizedSelections.push({
          tierId: selection.tierId,
          tierName: tier.name || 'Ticket',
          quantity: selection.quantity,
          unitPrice,
        })
      }

      if (normalizedSelections.length === 0) {
        return NextResponse.json({ error: 'No valid ticket tiers selected' }, { status: 400 })
      }
    } else {
      // Single-tier (or event base price)
      let unitPrice = event.ticket_price
      let tierName = 'General Admission'
      let resolvedTierId: string | null = null

      let tier: any = null
      if (tierId) {
        const tierCheck = checkTierForEvent(singleTier, String(eventId))
        if (!tierCheck.ok) {
          return NextResponse.json({ error: tierCheck.error, code: tierCheck.code }, { status: tierCheck.status })
        }
        tier = singleTier
      } else {
        const picked = pickTierWhenUnspecified(eventTiers, String(eventId))
        if (!picked.ok) {
          return NextResponse.json({ error: picked.error, code: picked.code }, { status: picked.status })
        }
        tier = picked.tier
      }

      if (tier) {
        const onSale = tierIsOnSale(tier, now)
        if (!onSale.ok) {
          return NextResponse.json({ error: onSale.reason }, { status: 400 })
        }

        const sold = Number(tier.sold_quantity || 0)
        const total = Number(tier.total_quantity || 0)
        const remaining = Math.max(0, total - sold)
        if (quantity > remaining) {
          return NextResponse.json({ error: `Only ${remaining} ticket(s) remaining for this tier.` }, { status: 400 })
        }

        unitPrice = tier.price
        tierName = tier.name
        resolvedTierId = tier.id
      }

      if (promo) {
        const { discountedPrice, discountAmount } = calculateDiscount(unitPrice, promo)
        unitPrice = discountedPrice
        promoDiscountTotal += discountAmount * quantity
      }

      normalizedSelections = [
        {
          tierId: resolvedTierId,
          tierName,
          quantity,
          unitPrice,
        },
      ]
    }

    const totalQuantity = normalizedSelections.reduce((sum, s) => sum + s.quantity, 0)
    const originalCurrency = String(event.currency || 'HTG').toUpperCase()
    const originalAmount = sumMoney(normalizedSelections.map((s) => s.quantity * s.unitPrice))

    // Fast-fail UX gate: reject obviously sold-out events before sending the buyer to MonCash.
    // Best-effort only (never blocks on its own errors); the atomic reserve at fulfillment is the
    // authoritative oversell guard.
    try {
      // Computed from the event doc read above — same counters, no second read.
      const capacity = capacityFromEvent(event, totalQuantity)
      if (!capacity.available) {
        return NextResponse.json(
          { error: capacity.isSoldOut ? 'This event is sold out.' : `Only ${capacity.remaining} ticket(s) remaining.` },
          { status: 400 }
        )
      }
    } catch (e) {
      console.warn('[moncash_button] capacity pre-check failed (continuing)', { message: (e as any)?.message })
    }

    // MonCash settles in HTG. If the event is priced in USD, convert to HTG using a live rate + spread.
    // We do NOT scrape Google; we use a proper JSON rate endpoint.
    let chargeCurrency = originalCurrency
    let chargeSelections = normalizedSelections
    let chargeAmount = originalAmount
    let exchangeRateUsed: number | null = null
    let exchangeRateProvider: string | null = null
    let exchangeRateFetchedAt: string | null = null
    let exchangeRateBase: number | null = null
    let exchangeRateSpreadPercent: number | null = null

    if (originalCurrency === 'USD') {
      const { baseRate, effectiveRate, spreadPercent, provider, fetchedAtIso } = await getUsdToHtgRateWithSpread({
        spreadPercent: 0.05,
      })

      exchangeRateBase = baseRate
      exchangeRateUsed = effectiveRate
      exchangeRateSpreadPercent = spreadPercent
      exchangeRateProvider = provider
      exchangeRateFetchedAt = fetchedAtIso
      chargeCurrency = 'HTG'

      chargeSelections = normalizedSelections.map((s) => ({
        ...s,
        originalUnitPrice: s.unitPrice,
        unitPrice: convertUsdToHtgAmount(s.unitPrice, effectiveRate),
      }))
      chargeAmount = sumMoney(chargeSelections.map((s) => s.quantity * s.unitPrice))
    } else if (originalCurrency !== 'HTG') {
      return NextResponse.json(
        { error: `MonCash only supports HTG. Event currency ${originalCurrency} is not supported for MonCash.` },
        { status: 400 }
      )
    }

    // ── WHO PAYS THE FEE ──────────────────────────────────────────────────────
    // The organizer chooses per event whether to absorb the platform fee or pass it
    // on. This rail used to ignore that and always charge the face value, while the
    // app showed the buyer face + fee. The buyer total is now priced exactly the way
    // create-payment-intent prices it — the same lib/checkout/buyer-pricing call,
    // the same STORED platform settings (rate + per-ticket cap in the event's own
    // currency) — on the post-promo face total in the event currency. The incidence
    // and fee are then stamped on the ORDER, so fulfillment records what the buyer
    // actually paid, never whatever the event's (editable) setting says later.
    const faceValueCents = Math.round(originalAmount * 100)
    const platformSettings = await getPlatformSettings()
    const buyerPricing = priceOrderCents(faceValueCents, event, {
      quantity: totalQuantity,
      currency: originalCurrency,
      config: platformSettings.haiti,
    })
    const feeIncidence: 'buyer' | 'organizer' =
      buyerPricing.incidence === 'buyer' && buyerPricing.buyerFee > 0 ? 'buyer' : 'organizer'
    const buyerFeeOriginal = feeIncidence === 'buyer' ? fromCents(buyerPricing.buyerFee) : 0
    let buyerFeeCharged = 0
    if (buyerFeeOriginal > 0) {
      buyerFeeCharged =
        originalCurrency === 'USD' && exchangeRateUsed
          ? convertUsdToHtgAmount(buyerFeeOriginal, exchangeRateUsed)
          : buyerFeeOriginal
    }
    const faceChargeAmount = chargeAmount
    chargeAmount = sumMoney([faceChargeAmount, buyerFeeCharged])

    // Create a gateway order ID.
    // Keep it short to fit sandbox RSA encryption limits (Digicel sandbox keys can be tiny).
    // IMPORTANT: Digicel appears to expect a numeric orderId (parsing errors can happen otherwise).
    const orderId = `${Date.now() % 1_000_000_000}${String(crypto.randomInt(0, 1000)).padStart(3, '0')}`
    const internalOrderId = `mcbtn_${eventId}_${identity.id}_${Date.now()}`

    // Store pending transaction first so we can fall back to an HTML form POST flow.
    const { error: pendingInsertError } = await supabase.from('pending_transactions').insert({
      transaction_id: null,
      order_id: orderId,
      internal_order_id: internalOrderId,
      user_id: identity.id,
      event_id: eventId,
      quantity: totalQuantity,
      // What the gateway is asked to collect: face value + any fee passed on to
      // the buyer. The return handler and the reconcile cron check Digicel's
      // reported `cost` against exactly this number.
      amount: chargeAmount,
      // Fee incidence, fixed at purchase. `original_amount` stays the FACE total in
      // the event currency (the organizer-facing gross the ledger is built on).
      fee_incidence: feeIncidence,
      face_amount: faceChargeAmount,
      buyer_fee: buyerFeeCharged || 0,
      buyer_fee_original: buyerFeeOriginal || 0,
      payment_method: normalizedProvider,
      status: 'pending',
      currency: chargeCurrency,
      original_currency: originalCurrency,
      original_amount: originalAmount,
      exchange_rate_used: exchangeRateUsed,
      exchange_rate_base: exchangeRateBase,
      exchange_rate_spread_percent: exchangeRateSpreadPercent,
      exchange_rate_provider: exchangeRateProvider,
      exchange_rate_fetched_at: exchangeRateFetchedAt,
      tier_selections: chargeSelections,
      // Store the RESOLVED promo doc id (not the raw input) so the confirm-time redeem targets
      // the exact promo; null when no discount was applied (charge full price, nothing to redeem).
      promo_code_id: promo?.id || null,
      promo_discount_total: promoDiscountTotal || null,
      // Promoter attribution: the RESOLVED promoter doc id (never the raw input).
      // Fulfillment stamps it onto the tickets and writes the commission ledger.
      promoter_id: promoter?.id || null,
      promoter_code: promoter?.code || null,
      // Visit attribution; fulfillment stamps it on the tickets and counts the link once.
      attribution: attribution || null,
      moncash_button_token: null,
      mobile_money_provider: normalizedProvider,
      // For a guest order: name/email/phone + the order key. Fulfillment reads the
      // recipient from HERE, never from the gateway's return, and refunds/support can
      // find the order by either contact detail. Empty object for account purchases.
      ...guestOrderFields(identity),
    })

    if (pendingInsertError) {
      console.error('Error creating pending transaction:', pendingInsertError)
      return NextResponse.json({ error: 'Failed to create pending transaction' }, { status: 500 })
    }

    // Counted toward the per-buyer rate limit, exactly like a created PaymentIntent.
    await screen.log(true)

    const orderHash = crypto.createHash('sha256').update(orderId).digest('hex').slice(0, 10)

    /**
     * The form-POST checkout starter (/api/moncash-button/checkout) authorizes by
     * session. A guest has none, so their signed order token rides along in the link
     * and stands in for it — that route matches it against the order's own key.
     */
    const guestLinkParam = identity.guestToken
      ? `&g=${encodeURIComponent(identity.guestToken)}`
      : ''
    const restTokenEnabled =
      !forceFormPost && String(process.env.MONCASH_BUTTON_REST_TOKEN_ENABLED || '').toLowerCase() === 'true'

    let redirectUrl: string
    if (!restTokenEnabled) {
      console.info('[moncash_button] initiate: using FORM POST (forced or REST token disabled)', { orderHash })
      const origin = new URL(request.url).origin
      redirectUrl = `${origin}/api/moncash-button/checkout?orderId=${encodeURIComponent(orderId)}${guestLinkParam}`
    } else {
      try {
        const { token } = await createMonCashButtonCheckoutToken({
          amount: chargeAmount,
          orderId,
        })

        console.info('[moncash_button] initiate: using REST token redirect', {
          orderHash,
          hasToken: Boolean(token),
        })

        const { error: pendingUpdateError } = await supabase
          .from('pending_transactions')
          .update({
            moncash_button_token: token,
            moncash_button_token_variants: buildTokenVariants(token),
          })
          .eq('order_id', orderId)

        if (pendingUpdateError) {
          console.error('Error updating pending transaction token:', pendingUpdateError)
        }

        redirectUrl = getMonCashButtonRedirectUrl(token)
      } catch (err: any) {
        console.warn('MonCash Button REST token failed; falling back to form POST:', {
          orderHash,
          message: err?.message,
        })
        console.info('[moncash_button] initiate: using FORM POST fallback', { orderHash })
        const origin = new URL(request.url).origin
        redirectUrl = `${origin}/api/moncash-button/checkout?orderId=${encodeURIComponent(orderId)}${guestLinkParam}`
      }
    }
    // The buyer's WebView opens /api/moncash-button/checkout next, which needs a
    // Digicel OAuth token before it can call CreatePayment. Mint it now, after this
    // response is on its way: when the checkout request lands on this same warm
    // instance it finds the token cached instead of paying that round trip itself.
    if (normalizedProvider === 'moncash') {
      after(() => prewarmMonCashAccessToken())
    }

    const response = NextResponse.json({ redirectUrl })
    // Correlate browser redirect back from MonCash to our pending transaction.
    // This prevents false "missing_order" failures when the gateway doesn't include orderId
    // (or includes a token-like transactionId that can't be looked up).
    response.cookies.set('moncash_button_order_id', orderId, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      path: '/',
      maxAge: 60 * 60, // 1 hour
    })

    // Domain cookie helps when ReturnUrl host differs (www vs apex).
    const host = new URL(request.url).hostname
    const apex = host.startsWith('www.') ? host.slice(4) : host
    if (apex && apex.includes('.') && !/localhost/i.test(apex) && !/vercel\.app$/i.test(apex)) {
      response.cookies.set('moncash_button_order_id_domain', orderId, {
        httpOnly: true,
        sameSite: 'none',
        secure: true,
        path: '/',
        domain: `.${apex}`,
        maxAge: 60 * 60,
      })
    }
    return response
  } catch (error: any) {
    console.error('MonCash Button initiate error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to initiate MonCash Button payment' },
      { status: 500 }
    )
  }
}
