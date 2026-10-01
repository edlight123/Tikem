import { NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { getCurrentUser } from '@/lib/auth'
import { getPaymentProviderForEventCountry, normalizeCountryCode } from '@/lib/payment-provider'
import { checkEventCapacity } from '@/lib/capacity'
import { calculateDiscount, resolvePromoCode, promoHasCapacity, type PromoDoc } from '@/lib/promo-codes'
import { resolvePromoterCode } from '@/lib/promoters'
import { resolveOrderAttribution } from '@/lib/tracking-links'
import { resolveEventCountry } from '@/lib/event-country'
import { hasEventAccess } from '@/lib/events/access-guard'
import {
  beginGuestCheckout,
  guestOrderFields,
  identityFromUser,
  type CheckoutIdentity,
} from '@/lib/guest/checkout'

export const runtime = 'nodejs'

function isSogepayConfigured(): boolean {
  // Placeholder: wire these to real Sogepay credentials once provided.
  return Boolean(process.env.SOGEPAY_ENABLED && String(process.env.SOGEPAY_ENABLED).toLowerCase() === 'true')
}

export async function POST(request: Request) {
  try {
    // A missing session is not fatal: a guest may pay by supplying
    // `guest: { name, email, phone }`, resolved below once the event is known.
    const user = await getCurrentUser()

    const body = await request.json().catch(() => ({}))
    // `accessCode` is how a GUEST clears a password-protected event: no uid means no
    // grant to hold, so the code rides along and is verified server-side before the
    // order exists.
    const { eventId, quantity = 1, tierId, promoCode, refCode, tiers, guest, accessCode, attribution: rawAttribution } = body || {}

    if (!eventId) return NextResponse.json({ error: 'Event ID is required' }, { status: 400 })

    const supabase = await createClient()
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single()

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    // Resolve the buyer: the signed-in user, or a validated guest contact record.
    // Fulfillment for this rail runs through the shared pipeline
    // (lib/tickets/fulfillment.ts), which already knows how to deliver a guest order.
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

    // Password-protected events: require a valid access grant before payment. A guest
    // arrives here only after their code was verified and granted against their
    // `guest_…` id, so this is as strict as before.
    if (!(await hasEventAccess(event, eventId, identity.id))) {
      return NextResponse.json({ error: 'access_code_required' }, { status: 403 })
    }

    const eventCountry = (await resolveEventCountry(event)) || normalizeCountryCode(event.country)
    const provider = getPaymentProviderForEventCountry(eventCountry)
    if (provider !== 'sogepay') {
      return NextResponse.json(
        { error: 'This event does not use Sogepay. Please choose the appropriate payment method.' },
        { status: 400 }
      )
    }

    if (!isSogepayConfigured()) {
      return NextResponse.json(
        {
          error:
            'Sogepay is not configured on this deployment yet. Set SOGEPAY_ENABLED=true and the required Sogepay credentials/env vars.',
        },
        { status: 500 }
      )
    }

    // Compute the organizer-facing total (event currency).
    const originalCurrency = String(event.currency || 'HTG').toUpperCase()

    const now = new Date()
    const tierIsOnSale = (tier: any): { ok: true } | { ok: false; reason: string } => {
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

    let selections: { tierId: string | null; tierName: string; quantity: number; unitPrice: number }[] = []

    if (Array.isArray(tiers) && tiers.length > 0) {
      const tierIds = tiers.map((t: any) => String(t?.tierId || '')).filter(Boolean)
      const { data: tierRows } = await supabase
        .from('ticket_tiers')
        .select('*')
        .in('id', tierIds)

      const byId = new Map<string, any>()
      ;(tierRows || []).forEach((row: any) => byId.set(String(row.id), row))

      for (const selection of tiers) {
        const id = String(selection?.tierId || '')
        const qty = Math.max(0, Math.round(Number(selection?.quantity || 0)))
        if (!id || qty <= 0) continue
        const tierRow = byId.get(id)
        if (!tierRow) continue

        const onSale = tierIsOnSale(tierRow)
        if (!onSale.ok) return NextResponse.json({ error: onSale.reason }, { status: 400 })

        const sold = Number(tierRow.sold_quantity || 0)
        const total = Number(tierRow.total_quantity || 0)
        const remaining = Math.max(0, total - sold)
        if (qty > remaining) {
          return NextResponse.json(
            { error: `Only ${remaining} ticket(s) remaining for ${tierRow.name || 'this tier'}.` },
            { status: 400 }
          )
        }

        selections.push({
          tierId: id,
          tierName: String(tierRow.name || 'Ticket'),
          quantity: qty,
          unitPrice: Number(tierRow.price || 0),
        })
      }
    } else if (tierId) {
      const { data: tierRow } = await supabase
        .from('ticket_tiers')
        .select('*')
        .eq('id', tierId)
        .single()

      if (tierRow) {
        const onSale = tierIsOnSale(tierRow)
        if (!onSale.ok) return NextResponse.json({ error: onSale.reason }, { status: 400 })

        const qty = Math.max(1, Math.round(Number(quantity || 1)))
        const sold = Number(tierRow.sold_quantity || 0)
        const total = Number(tierRow.total_quantity || 0)
        const remaining = Math.max(0, total - sold)
        if (qty > remaining) {
          return NextResponse.json(
            { error: `Only ${remaining} ticket(s) remaining for this tier.` },
            { status: 400 }
          )
        }

        selections = [
          {
            tierId: String(tierRow.id),
            tierName: String(tierRow.name || 'Ticket'),
            quantity: qty,
            unitPrice: Number(tierRow.price || 0),
          },
        ]
      }
    }

    if (selections.length === 0) {
      // Fallback to single base ticket price.
      const qty = Math.max(1, Math.round(Number(quantity || 1)))
      selections = [
        {
          tierId: null,
          tierName: 'General Admission',
          quantity: qty,
          unitPrice: Number(event.ticket_price || 0),
        },
      ]
    }

    // Apply promo code to the per-ticket unitPrice (Firestore, consistent with other flows).
    // resolvePromoCode accepts either the Firestore doc id or the raw code. We only apply the
    // discount when the promo still has capacity; the "first N buyers" cap is enforced atomically
    // at CONFIRM time (in the Sogepay callback via fulfillPaidOrder), so an abandoned redirect
    // never consumes a slot and a full promo just charges full price.
    let promo: PromoDoc | null = null
    if (promoCode) {
      const resolved = await resolvePromoCode(String(eventId), String(promoCode))
      if (resolved && promoHasCapacity(resolved)) promo = resolved
    }
    // Resolved promo doc id stored on the pending transaction so the confirm-time redeem targets
    // the exact promo; null when no discount was applied (nothing to redeem).
    const promoCodeId: string | null = promo?.id || null

    // Promoter attribution (optional). Only the RESOLVED doc id is persisted; an
    // unknown or inactive ref attributes nothing and never blocks the sale.
    const promoter = refCode ? await resolvePromoterCode(String(eventId), String(refCode)) : null
    const attribution = await resolveOrderAttribution(String(eventId), rawAttribution, promoter?.code || null)

    // Total discount applied across the order (event currency), recorded on the redemption.
    let promoDiscountTotal = 0
    const discountedSelections = selections.map((s) => {
      let unitPrice = Number(s.unitPrice || 0)
      if (promo) {
        const { discountedPrice, discountAmount } = calculateDiscount(unitPrice, promo)
        unitPrice = discountedPrice
        promoDiscountTotal += discountAmount * s.quantity
      }
      return { ...s, unitPrice }
    })

    const totalQuantity = discountedSelections.reduce((sum, s) => sum + s.quantity, 0)
    const originalAmount = discountedSelections.reduce((sum, s) => sum + s.quantity * s.unitPrice, 0)

    // Fast-fail UX gate: reject obviously sold-out events before redirecting to the gateway.
    // Best-effort only; the atomic reserve at fulfillment is the authoritative oversell guard.
    try {
      const capacity = await checkEventCapacity(String(eventId), totalQuantity)
      if (!capacity.available) {
        return NextResponse.json(
          { error: capacity.isSoldOut ? 'This event is sold out.' : `Only ${capacity.remaining} ticket(s) remaining.` },
          { status: 400 }
        )
      }
    } catch (e) {
      console.warn('[sogepay] capacity pre-check failed (continuing)', { message: (e as any)?.message })
    }

    // Store pending transaction so we can reconcile a future Sogepay callback/webhook.
    // Note: we intentionally do NOT invent a Sogepay signature/redirect format here.
    const orderId = `${Date.now() % 1_000_000_000}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`
    const internalOrderId = `sogepay_${eventId}_${identity.id}_${Date.now()}`

    const { data: pending, error: pendingError } = await supabase
      .from('pending_transactions')
      .insert({
        transaction_id: null,
        order_id: orderId,
        internal_order_id: internalOrderId,
        user_id: identity.id,
        event_id: eventId,
        quantity: totalQuantity,
        amount: originalAmount,
        payment_method: 'sogepay',
        status: 'pending',
        currency: originalCurrency,
        original_currency: originalCurrency,
        original_amount: originalAmount,
        exchange_rate_used: null,
        tier_selections: discountedSelections,
        promo_code_id: promoCodeId,
        promo_discount_total: promoDiscountTotal || null,
        promoter_id: promoter?.id || null,
        promoter_code: promoter?.code || null,
        // Visit attribution; fulfillment stamps it on the tickets and counts the link once.
        attribution: attribution || null,
        // Guest contact + order key; empty for account purchases. Fulfillment reads the
        // confirmation recipient from here, never from the callback.
        ...guestOrderFields(identity),
      })
      .select('*')
      .single()

    if (pendingError) {
      return NextResponse.json({ error: pendingError.message || 'Failed to create pending transaction' }, { status: 500 })
    }

    // For now, require an externally provided hosted checkout URL.
    const checkoutBase = String(process.env.SOGEPAY_CHECKOUT_URL || '').trim()
    if (!checkoutBase) {
      return NextResponse.json(
        {
          error:
            'SOGEPAY_CHECKOUT_URL is not set. Provide the Sogepay hosted checkout URL format for initiating payments.',
          pendingTransactionId: pending?.id,
        },
        { status: 500 }
      )
    }

    const redirectUrl = new URL(checkoutBase)
    redirectUrl.searchParams.set('orderId', String(orderId))
    redirectUrl.searchParams.set('eventId', String(eventId))

    // Tell Sogepay where to send the buyer back (browser) and where to POST the authoritative
    // server-to-server payment notification (webhook). Real Sogepay portals may instead read
    // these from merchant settings; passing them is harmless and makes self-serve setups work.
    const origin = new URL(request.url).origin
    const returnUrl = `${origin}/api/sogepay/callback?orderId=${encodeURIComponent(String(orderId))}`
    const callbackUrl = `${origin}/api/sogepay/callback`
    for (const key of ['returnUrl', 'return_url', 'redirectUrl', 'redirect_url']) {
      redirectUrl.searchParams.set(key, returnUrl)
    }
    for (const key of ['callbackUrl', 'callback_url', 'notifyUrl', 'notify_url']) {
      redirectUrl.searchParams.set(key, callbackUrl)
    }

    return NextResponse.json({ redirectUrl: redirectUrl.toString(), pendingTransactionId: pending?.id })
  } catch (error: any) {
    console.error('Sogepay initiate error:', error)
    return NextResponse.json({ error: error.message || 'Failed to initiate Sogepay payment' }, { status: 500 })
  }
}
