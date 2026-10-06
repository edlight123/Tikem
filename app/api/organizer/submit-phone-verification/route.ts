import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireAuth } from '@/lib/auth'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import {
  PHONE_VERIFICATION_MAX_ATTEMPTS,
  phoneVerificationCodeMatches,
} from '@/lib/phone-verification-code'
import { notifyOrganizerVerificationApproved } from '@/lib/notifications/payout-verification'

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth('organizer')
    if (error || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const organizerId = user.id

    const { verificationCode } = await request.json()

    if (!verificationCode) {
      return NextResponse.json(
        { error: 'Verification code is required' },
        { status: 400 }
      )
    }

    const haitiProfile = await getPayoutProfile(organizerId, 'haiti')

    if (!haitiProfile || !haitiProfile.mobileMoneyDetails) {
      return NextResponse.json(
        { error: 'Mobile money details must be configured first' },
        { status: 400 }
      )
    }

    if (typeof verificationCode !== 'string' || !/^\d{6}$/.test(verificationCode)) {
      return NextResponse.json(
        { error: 'Invalid verification code format. Must be 6 digits.' },
        { status: 400 }
      )
    }

    // Check the code against the stored hash, inside a transaction so the
    // attempt counter cannot be raced. There is no fallback code: without a
    // pending, unexpired code on file, nothing verifies.
    const phoneRef = adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('verificationDocuments')
      .doc('phone')

    const outcome = await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(phoneRef)
      const data = snap.exists ? snap.data() || {} : {}
      if (data.status !== 'pending' || !data.code_hash) return 'no_code' as const
      const expiresAt = Date.parse(String(data.expiresAt || ''))
      if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return 'expired' as const
      const attempts = Number(data.attempts || 0)
      if (attempts >= PHONE_VERIFICATION_MAX_ATTEMPTS) return 'locked' as const
      if (!phoneVerificationCodeMatches(organizerId, verificationCode, data.code_hash)) {
        tx.update(phoneRef, { attempts: attempts + 1 })
        return 'wrong' as const
      }
      // The verified number must still be the payout number the code was sent to.
      if (data.phoneNumber && data.phoneNumber !== haitiProfile.mobileMoneyDetails?.phoneNumber) {
        return 'changed' as const
      }
      return 'ok' as const
    })

    if (outcome !== 'ok') {
      const message =
        outcome === 'expired' || outcome === 'no_code' || outcome === 'changed'
          ? 'This code has expired. Please request a new one.'
          : outcome === 'locked'
            ? 'Too many incorrect attempts. Wait 10 minutes, then request a new code.'
            : 'Invalid verification code'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    // Mark phone as verified
    await adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('verificationDocuments')
      .doc('phone')
      .set({
        type: 'phone',
        status: 'verified',
        phoneNumber: haitiProfile.mobileMoneyDetails?.phoneNumber || null,
        verifiedAt: new Date().toISOString(),
      })

    // Notify organizer of successful verification
    try {
      await notifyOrganizerVerificationApproved({
        organizerId,
        verificationType: 'phone',
      })
    } catch (notifError) {
      console.error('Failed to send organizer notification:', notifError)
    }

    return NextResponse.json({
      success: true,
      message: 'Phone number verified successfully',
      status: 'verified',
    })
  } catch (error: any) {
    console.error('Error verifying phone:', error)
    return NextResponse.json(
      { error: 'Failed to verify phone' },
      { status: 500 }
    )
  }
}
