import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email'
import crypto from 'crypto'

const DOC_ID = 'payoutDetailsChangeVerification'
const CODE_TTL_MS = 10 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000

const getRef = (organizerId: string) =>
  adminDb
    .collection('organizers')
    .doc(organizerId)
    .collection('security')
    .doc(DOC_ID)

const toIso = (value: any): string | null => {
  if (!value) return null
  if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString()
  if (typeof value === 'string') return value
  try {
    return new Date(value).toISOString()
  } catch {
    return null
  }
}

const hashCode = (salt: string, code: string) =>
  crypto
    .createHash('sha256')
    .update(`${salt}:${code}`)
    .digest('hex')

export async function POST(_request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    const organizerId = decodedClaims.uid

    const userDoc = await adminDb.collection('users').doc(organizerId).get()
    // The step-up code goes to the sign-in email, never the client-writable
    // profile copy (a stolen session could otherwise redirect it).
    // Sign-in email ONLY, and only once verified. The profile copy is
    // client-writable, so falling back to it would let a stolen session send
    // the step-up code to an attacker's inbox.
    const email =
      (decodedClaims as any)?.email_verified === true ? (decodedClaims as any)?.email || null : null

    if (!email) {
      return NextResponse.json({ error: 'A verified sign-in email is required to change payout details' }, { status: 400 })
    }

    const ref = getRef(organizerId)
    const existing = await ref.get()
    if (existing.exists) {
      const sentAtIso = toIso((existing.data() as any)?.sentAt)
      if (sentAtIso) {
        const sentAtMs = new Date(sentAtIso).getTime()
        if (Number.isFinite(sentAtMs) && Date.now() - sentAtMs < RESEND_COOLDOWN_MS) {
          return NextResponse.json(
            { error: 'Please wait a moment before requesting another code.' },
            { status: 429 }
          )
        }
      }
    }

    const verificationCode = crypto.randomInt(100000, 1000000).toString()
    const salt = crypto.randomBytes(16).toString('hex')
    const codeHash = hashCode(salt, verificationCode)

    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString()

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
        <h2 style="margin:0 0 12px;">Confirm payout details change</h2>
        <p style="margin:0 0 12px; color:#374151;">Use this code to confirm your payout/banking details update. This code expires in 10 minutes.</p>
        <div style="font-size:28px; font-weight:700; letter-spacing:6px; padding:12px 16px; border:1px solid #e5e7eb; display:inline-block; border-radius:10px;">${verificationCode}</div>
        <p style="margin:16px 0 0; color:#6b7280; font-size:13px;">If you didn’t request this change, ignore this email and review your account security.</p>
      </div>
    `

    const emailResult = await sendEmail({
      to: email,
      subject: 'Tikèm: Confirm payout details change',
      html,
    })

    const isDev = process.env.NODE_ENV === 'development'

    if (!emailResult.success && !isDev) {
      return NextResponse.json(
        { error: 'Email delivery is not configured. Please contact support.' },
        { status: 500 }
      )
    }

    // Store only after successful send (or in dev).
    await ref.set(
      {
        type: 'payout_details_change',
        sentTo: email,
        sentAt: new Date().toISOString(),
        expiresAt,
        verifiedUntil: null,
        codeHash,
        salt,
        // A fresh code gets a fresh attempt budget (the verify route wipes the
        // code after 5 wrong guesses).
        failedAttempts: 0,
      },
      { merge: true }
    )

    return NextResponse.json({
      success: true,
      message: 'Verification code sent',
      debugCode: isDev ? verificationCode : undefined,
    })
  } catch (error: any) {
    console.error('Error sending payout change email code:', error)
    return NextResponse.json(
      { error: 'Failed to send verification code', message: error?.message },
      { status: 500 }
    )
  }
}
