import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { clientIp } from '@/lib/rate-limit'
import {
  findPromoDoc,
  isPromoValidationLimited,
  promoIpFailureKeys,
  recordFailedPromoValidation,
  recordPromoValidationAttempt,
} from '@/lib/promo-codes'
import { getPromoExpiresAt, getPromoStartAt, getPromoUsesCount, isPromoActive } from '@/lib/promo-code-shared'

// Validate a promo code against Firestore `promo_codes`. Accepts either the raw
// code or the Firestore doc id (findPromoDoc handles both).
//
// A SESSION IS NO LONGER REQUIRED. Guest checkout exists precisely because most
// buyers arrive inside an Instagram WebView where sign-in cannot complete, and a
// promo code the organizer printed on the flyer was unusable for exactly those
// buyers. Nothing about what makes a code valid changed: this endpoint is
// read-only, it grants nothing, and every cap it reports (active, start, expiry,
// global max_uses) is re-checked — and the usage cap re-enforced ATOMICALLY — when
// the order is actually redeemed.
//
// What the session was silently providing was enumeration resistance: you needed
// an account to guess at codes. That control is now explicit and IP-based for
// unauthenticated callers, so opening the endpoint doesn't open a codespace sweep.
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()

    const { code, eventId } = await request.json()

    // Guests are throttled per IP, counting only FAILED lookups (one IP is
    // often a whole carrier's CGNAT), with a tighter per-(event, IP) budget;
    // signed-in callers per uid on every attempt, so an account (or a farm of
    // them on fresh IPs) cannot sweep an event's codespace either.
    const ipKeys = user ? [] : promoIpFailureKeys(clientIp(request), eventId ? String(eventId) : null)
    const limited = user
      ? (await recordPromoValidationAttempt(`promo-validate:uid:${user.id}`)).limited
      : await isPromoValidationLimited(ipKeys)
    if (limited) {
      return NextResponse.json(
        { error: 'Too many promo code attempts. Please try again in a few minutes.' },
        { status: 429 }
      )
    }

    // Never log the code itself: an organizer's unpublished discount shouldn't end
    // up in a log line. The event is enough to trace a problem.
    console.log('Validating promo code:', { eventId, guest: !user })

    if (!code) {
      return NextResponse.json({ error: 'Promo code is required' }, { status: 400 })
    }
    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 })
    }

    const promoCode = await findPromoDoc(String(eventId), String(code))

    if (!promoCode) {
      await recordFailedPromoValidation(ipKeys)
      return NextResponse.json({ error: 'Invalid promo code' }, { status: 404 })
    }

    console.log('Found promo code:', { id: promoCode.id, event_id: promoCode.event_id })

    const now = new Date()

    if (!isPromoActive(promoCode)) {
      return NextResponse.json({ error: 'This promo code is inactive' }, { status: 400 })
    }

    const startAt = getPromoStartAt(promoCode)
    if (startAt && startAt > now) {
      return NextResponse.json({ error: 'This promo code is not yet valid' }, { status: 400 })
    }

    const expiresAt = getPromoExpiresAt(promoCode)
    if (expiresAt && expiresAt < now) {
      return NextResponse.json({ error: 'This promo code has expired' }, { status: 400 })
    }

    // Global usage cap. Soft check only — the authoritative one runs atomically at
    // redemption. A PER-BUYER cap (`max_uses_per_user`) is deliberately not
    // pre-checked here: this request carries no buyer identity for a guest, and it is
    // enforced at redemption against their email rather than their per-order id
    // (redeemPromoInTransaction), which is the only place it can be enforced honestly.
    const usesCount = getPromoUsesCount(promoCode)
    if (promoCode.max_uses && usesCount >= promoCode.max_uses) {
      return NextResponse.json({ error: 'This promo code has reached its usage limit' }, { status: 400 })
    }

    return NextResponse.json({
      valid: true,
      promoCode: {
        id: promoCode.id,
        code: promoCode.code,
        description: promoCode.description,
        discountType: promoCode.discount_type,
        discountValue: promoCode.discount_value,
      },
    })
  } catch (error: any) {
    console.error('Promo code validation error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to validate promo code' },
      { status: 500 }
    )
  }
}
