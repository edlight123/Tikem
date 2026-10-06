import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { requireAuth } from '@/lib/auth'
import { getPayoutProfile } from '@/lib/firestore/payout-profiles'
import crypto from 'crypto'
import { sendSms } from '@/lib/sms'
import { hashPhoneVerificationCode } from '@/lib/phone-verification-code'
import { consumeRateLimit } from '@/lib/rate-limit'

/** Codes one organizer may request per hour (each one is a paid SMS). */
const SEND_LIMIT_PER_HOUR = 5
const CODE_TTL_MS = 10 * 60 * 1000

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth('organizer')
    if (error || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const organizerId = user.id

    const throttle = await consumeRateLimit({
      key: `phone-verification-send:${organizerId}`,
      limit: SEND_LIMIT_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    })
    if (throttle.limited) {
      return NextResponse.json(
        { error: 'Too many codes requested. Please wait an hour and try again.' },
        { status: 429 }
      )
    }

    const haitiProfile = await getPayoutProfile(organizerId, 'haiti')

    if (!haitiProfile || !haitiProfile.mobileMoneyDetails) {
      return NextResponse.json(
        { error: 'Mobile money details must be configured first' },
        { status: 400 }
      )
    }

    const phoneNumber = haitiProfile.mobileMoneyDetails.phoneNumber

    // Generate 6-digit verification code using crypto for security
    const verificationCode = crypto.randomInt(100000, 1000000).toString()

    // Store only a hash of the code (see lib/phone-verification-code).
    const phoneRef = adminDb
      .collection('organizers')
      .doc(organizerId)
      .collection('verificationDocuments')
      .doc('phone')
    // A resend while the previous code is still live keeps its wrong-guess
    // count: resetting it on every resend gave an unlimited number of guesses.
    const previous = await phoneRef.get()
    const prev = previous.exists ? ((previous.data() as any) ?? {}) : {}
    const prevExpires = Date.parse(String(prev.expiresAt || ''))
    const carriedAttempts =
      String(prev.status || '') === 'pending' && Number.isFinite(prevExpires) && prevExpires > Date.now()
        ? Math.max(0, Number(prev.attempts) || 0)
        : 0

    await phoneRef.set({
        type: 'phone',
        code_hash: hashPhoneVerificationCode(organizerId, verificationCode),
        attempts: carriedAttempts,
        phoneNumber,
        status: 'pending',
        sentAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(), // 10 minutes
      })

    // The code is never logged. It goes to the phone on the payout profile.
    const sms = await sendSms({
      to: phoneNumber,
      message: `Tikèm: your payout phone verification code is ${verificationCode}. It expires in 10 minutes.`,
    }).catch(() => ({ success: false }))
    if (!(sms as any)?.success) {
      return NextResponse.json({ error: 'Could not send the verification code. Please try again.' }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      message: 'Verification code sent to your phone',
      // Local development only, where no SMS provider is configured.
      debugCode: process.env.NODE_ENV === 'development' ? verificationCode : undefined,
    })
  } catch (error: any) {
    console.error('Error sending verification code:', error)
    return NextResponse.json(
      { error: 'Failed to send verification code' },
      { status: 500 }
    )
  }
}
