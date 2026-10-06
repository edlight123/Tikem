import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import {
  getPromoExpiresAt,
  getPromoStartAt,
  getPromoUsesCount,
  isPromoActive,
  promoDiscountFields,
} from '@/lib/promo-code-shared'
import {
  isPromoValidationLimited,
  promoIpFailureKeys,
  recordFailedPromoValidation,
  recordPromoValidationAttempt,
} from '@/lib/promo-codes'

// Promo codes are stored in Firestore `promo_codes` (the same store the mobile app
// writes to and the checkout path reads). All routes here use the Admin SDK.

async function assertEventOwnedByUser(eventId: string, userId: string): Promise<
  { ok: true } | { ok: false; status: number; error: string }
> {
  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) return { ok: false, status: 404, error: 'Event not found' }
  const eventData = eventDoc.data() as any
  const organizerId = eventData?.organizer_id ?? eventData?.organizerId
  if (organizerId !== userId) return { ok: false, status: 403, error: 'Unauthorized' }
  return { ok: true }
}

/**
 * Create promo code for an event (Firestore).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'organizer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { eventId, code, discountType, discountValue, maxUses, validFrom, validUntil } = await req.json()

    if (!eventId || !code || !discountType || discountValue === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Verify event belongs to user.
    const ownership = await assertEventOwnedByUser(String(eventId), user.id)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const normalizedCode = String(code).toUpperCase()

    // Check if code already exists for this event.
    const existing = await adminDb
      .collection('promo_codes')
      .where('event_id', '==', eventId)
      .where('code', '==', normalizedCode)
      .limit(1)
      .get()

    if (!existing.empty) {
      return NextResponse.json(
        { error: 'Promo code already exists for this event' },
        { status: 400 }
      )
    }

    const expiresAt = validUntil || null

    // Fields mirror what the mobile "create promo" screen writes so both paths are
    // consistent. uses_count starts at 0 and is only ever bumped server-side via
    // redeemPromoInTransaction (clients cannot touch it — see firestore.rules).
    const promoData = {
      event_id: eventId,
      code: normalizedCode,
      discount_type: discountType,
      discount_value: Number(discountValue),
      max_uses: maxUses ?? null,
      is_active: true,
      uses_count: 0,
      expires_at: expiresAt,
      // Legacy compatibility (some code paths still read these).
      valid_from: validFrom || null,
      valid_until: validUntil || null,
      created_at: new Date().toISOString(),
    }

    const ref = await adminDb.collection('promo_codes').add(promoData)
    // Store the id inside the doc too, for callers that read data.id.
    await ref.set({ id: ref.id }, { merge: true })

    console.log('Promo code created successfully:', ref.id)
    return NextResponse.json({ success: true, promoId: ref.id })
  } catch (error) {
    console.error('Error in POST /api/promo-codes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Toggle promo code active state (organizer only) — Firestore.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'organizer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { promoId, isActive } = await req.json()
    if (!promoId || typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const promoRef = adminDb.collection('promo_codes').doc(String(promoId))
    const promoSnap = await promoRef.get()
    if (!promoSnap.exists) {
      return NextResponse.json({ error: 'Promo code not found' }, { status: 404 })
    }

    const promo = promoSnap.data() as any
    const ownership = await assertEventOwnedByUser(String(promo.event_id), user.id)
    if (!ownership.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    await promoRef.set(
      { is_active: isActive, updated_at: new Date().toISOString() },
      { merge: true }
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in PATCH /api/promo-codes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Validate promo code (Firestore).
 *
 * Legacy twin of POST /api/promo-codes/validate, kept because shipped mobile
 * builds (TieredTicketSelector) still call it unauthenticated. It used to have
 * no throttle at all, which made it an open codespace sweep; it now shares the
 * validate route's budgets: per IP (and per event + IP) counting only FAILED
 * lookups, and per uid when signed in counting every attempt, so rotating IPs
 * from one account does not reset it.
 */
export async function GET(req: NextRequest) {
  try {
    const forwarded = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''
    const ipAddress = forwarded.split(',')[0].trim() || 'unknown'

    const { searchParams } = new URL(req.url)
    const eventId = searchParams.get('eventId')
    const code = searchParams.get('code')

    if (!eventId || !code) {
      return NextResponse.json(
        { error: 'Event ID and code are required' },
        { status: 400 }
      )
    }

    // Per IP, only FAILED lookups count (shared CGNAT addresses); per uid,
    // every attempt counts as before.
    const ipKeys = promoIpFailureKeys(ipAddress, eventId)
    const user = await getCurrentUser().catch(() => null)
    const [ipLimited, uidThrottle] = await Promise.all([
      isPromoValidationLimited(ipKeys),
      user ? recordPromoValidationAttempt(`promo-validate-uid:${user.id}`) : Promise.resolve({ limited: false }),
    ])
    if (ipLimited || uidThrottle.limited) {
      return NextResponse.json(
        { valid: false, error: 'Too many promo code attempts. Please try again in a few minutes.' },
        { status: 429 }
      )
    }

    const normalizedCode = String(code).toUpperCase()
    const snap = await adminDb
      .collection('promo_codes')
      .where('event_id', '==', eventId)
      .where('code', '==', normalizedCode)
      .limit(1)
      .get()

    if (snap.empty) {
      await recordFailedPromoValidation(ipKeys)
      return NextResponse.json({ valid: false, error: 'Invalid promo code' }, { status: 404 })
    }

    const promoCode = { id: snap.docs[0].id, ...(snap.docs[0].data() as any) }
    const now = new Date()

    if (!isPromoActive(promoCode)) {
      return NextResponse.json({ valid: false, error: 'Promo code is inactive' }, { status: 400 })
    }

    const startAt = getPromoStartAt(promoCode)
    if (startAt && startAt > now) {
      return NextResponse.json({ valid: false, error: 'Promo code not yet valid' }, { status: 400 })
    }

    const expiresAt = getPromoExpiresAt(promoCode)
    if (expiresAt && expiresAt < now) {
      return NextResponse.json({ valid: false, error: 'Promo code has expired' }, { status: 400 })
    }

    const usesCount = getPromoUsesCount(promoCode)
    if (promoCode.max_uses && usesCount >= promoCode.max_uses) {
      return NextResponse.json(
        { valid: false, error: 'Promo code has reached maximum uses' },
        { status: 400 }
      )
    }

    const discount = promoDiscountFields(promoCode)

    return NextResponse.json({
      valid: true,
      // Mobile client expects these legacy fields.
      discount_percentage: discount.discount_percentage,
      discount_amount: discount.discount_amount,
      promoCode: {
        id: promoCode.id,
        code: promoCode.code,
        discountType: discount.discountType,
        discountValue: discount.discountValue,
      },
    })
  } catch (error) {
    console.error('Error in GET /api/promo-codes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Delete promo code (Firestore).
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'organizer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const promoId = searchParams.get('promoId')

    if (!promoId) {
      return NextResponse.json({ error: 'Promo ID is required' }, { status: 400 })
    }

    const promoRef = adminDb.collection('promo_codes').doc(String(promoId))
    const promoSnap = await promoRef.get()
    if (!promoSnap.exists) {
      return NextResponse.json({ error: 'Promo code not found or unauthorized' }, { status: 404 })
    }

    const promo = promoSnap.data() as any
    const ownership = await assertEventOwnedByUser(String(promo.event_id), user.id)
    if (!ownership.ok) {
      return NextResponse.json({ error: 'Promo code not found or unauthorized' }, { status: 404 })
    }

    await promoRef.delete()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in DELETE /api/promo-codes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
