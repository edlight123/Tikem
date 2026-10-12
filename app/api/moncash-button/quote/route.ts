import { NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'
import { identityFromUser } from '@/lib/guest/checkout'
import { resolvePromoCode, promoBuyerKey, promoCanCoverOrder, type PromoDoc } from '@/lib/promo-codes'
import { requestLanguage, sumMoney } from '@/lib/fx/usd-htg'
import { inferCountryFromEventText } from '@/lib/event-country'
import { isPaidAllowed, countrySupport } from '@/lib/country-support'
import { checkEventPurchasable } from '@/lib/tickets/purchasable'
import { getPlatformSettings } from '@/lib/admin/platform-settings'
import { scheduleOpsEvent } from '@/lib/ops/ops-events'
import { freeLimitRefusal, freeQuantityOf } from '@/lib/tickets/free-claim-policy'
import {
  freeClaimLines,
  loadMonCashPricingDocs,
  parseOrderLines,
  priceFaceSelections,
  priceMonCashCharge,
  type TierSelection,
} from '@/lib/moncash/price-order'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * What MonCash will charge for this order, BEFORE the buyer is sent to Digicel.
 *
 * Read-only: no pending order, no reservation, no rate-limit slot. It runs the
 * very same pricing initiate runs (lib/moncash/price-order.ts) — tier checks,
 * promo, fee incidence, USD→HTG with the spread, per-unit rounding — so the
 * "≈ X HTG" a buyer reads is the figure the gateway is asked to collect (as long
 * as the rate does not move between the two calls; it is cached for 10 minutes).
 *
 * No access code is needed: a quote reveals nothing beyond the public prices.
 * Initiate still demands the code before any money moves.
 *
 * Body: { eventId, tiers?: [{ tierId, quantity }], quantity?, tierId?, promoCodeId? }
 * (`quantity` + `tierId` mirror initiate's single-line form, which the app uses.)
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      eventId?: string
      tiers?: TierSelection[]
      quantity?: unknown
      tierId?: string | null
      promoCodeId?: string | null
      promoCode?: string | null
    } | null
    const eventId = String(body?.eventId || '').trim()
    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 })
    }

    // A quote answers "does this promo code work?" without any purchase, so
    // unthrottled it would let anyone enumerate codes. Per IP, and generous:
    // Haitian carriers put many phones behind one shared address (CGNAT), so
    // the limit has to fit a crowd of real buyers, not one.
    const { limited } = await consumeRateLimit({
      key: `moncash-quote:${clientIp(request)}`,
      limit: 120,
      windowMs: 10 * 60 * 1000,
    })
    if (limited) {
      return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 })
    }

    const lines = parseOrderLines(body?.tiers, body?.quantity ?? 1)
    if (!lines.ok) {
      return NextResponse.json(
        { error: lines.error, ...(lines.code ? { code: lines.code } : {}) },
        { status: lines.status }
      )
    }

    const supabase = await createClient()
    const [user, { data: event, error: eventError }] = await Promise.all([
      // Optional: only used so a per-buyer promo cap is judged for the right buyer.
      getCurrentUser().catch(() => null),
      Promise.resolve(supabase.from('events').select('*').eq('id', eventId).single()),
    ])
    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const purchasable = checkEventPurchasable(event)
    if (!purchasable.ok) {
      return NextResponse.json({ error: purchasable.error, code: purchasable.code }, { status: purchasable.status })
    }
    if (!isPaidAllowed((event as any).country)) {
      const name = countrySupport((event as any).country)?.name || 'this country'
      return NextResponse.json({ error: `Payouts are not yet available in ${name}.` }, { status: 400 })
    }
    if (inferCountryFromEventText(event) !== 'HT') {
      return NextResponse.json({ error: 'MonCash is only available for events in Haiti.' }, { status: 400 })
    }

    const tierId = body?.tierId ?? null
    const promoInput = body?.promoCodeId || body?.promoCode || null
    const [promo, docs] = await Promise.all([
      (async (): Promise<PromoDoc | null> => {
        if (!promoInput) return null
        const resolved = await resolvePromoCode(eventId, String(promoInput))
        if (!resolved) return null
        const cover = await promoCanCoverOrder(resolved, {
          qty: lines.requestedQuantity,
          buyerKey: user ? promoBuyerKey(identityFromUser(user)) : null,
        })
        return cover.ok ? resolved : null
      })(),
      loadMonCashPricingDocs(supabase, eventId, lines, tierId),
    ])

    const face = priceFaceSelections({ eventId, event, lines, tierId, docs, promo })
    if (!face.ok) {
      return NextResponse.json(
        { error: face.error, ...(face.code ? { code: face.code } : {}) },
        { status: face.status }
      )
    }

    // The free-ticket cap initiate enforces, so the buyer hears it before paying.
    // Only the pure check: whether the buyer's free claim is already used is
    // decided by initiate (which knows the guest's email) and the claim lock is
    // taken only at fulfillment. A quote takes no lock and writes nothing.
    const overFreeLimit = freeLimitRefusal(freeQuantityOf(freeClaimLines(face.normalizedSelections)))
    if (overFreeLimit) {
      return NextResponse.json({ error: overFreeLimit.error, code: overFreeLimit.code }, { status: overFreeLimit.status })
    }

    const platformSettings = await getPlatformSettings()
    const charge = await priceMonCashCharge({
      event,
      face,
      feeConfig: platformSettings.haiti,
      lang: requestLanguage(request),
    })
    if (!charge.ok) {
      if (charge.code === 'fx_rate_unavailable') {
        scheduleOpsEvent('fx_rate_unavailable', 'moncash-button/quote', { eventId: String(eventId) })
      }
      return NextResponse.json(
        { error: charge.error, ...(charge.code ? { code: charge.code } : {}) },
        { status: charge.status }
      )
    }

    if (charge.exchange?.source === 'snapshot_fallback') {
      scheduleOpsEvent('fx_snapshot_fallback', 'moncash-button/quote', {
        eventId: String(eventId),
        baseRate: charge.exchange.base,
      })
    }
    return NextResponse.json({
      amountHtg: charge.chargeAmount,
      // What the buyer reads as the total in the event currency: face + any passed-on fee.
      amountOriginal: sumMoney([face.originalAmount, charge.buyerFeeOriginal]),
      originalCurrency: face.originalCurrency,
      baseRate: charge.exchange?.base ?? null,
      effectiveRate: charge.exchange?.used ?? null,
      spreadPercent: charge.exchange?.spreadPercent ?? null,
      buyerFeeOriginal: charge.buyerFeeOriginal,
      rateSource: charge.exchange?.source ?? null,
      promoApplied: Boolean(promo),
    })
  } catch (error: any) {
    console.error('MonCash quote error:', error)
    return NextResponse.json({ error: 'Failed to compute MonCash total' }, { status: 500 })
  }
}
