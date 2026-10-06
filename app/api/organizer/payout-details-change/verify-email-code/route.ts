import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import crypto from 'crypto'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'

const DOC_ID = 'payoutDetailsChangeVerification'
const CODE_TTL_MS = 10 * 60 * 1000
/** Wrong guesses allowed against ONE emailed code before it is wiped. */
const MAX_FAILED_ATTEMPTS = 5
const LIMIT_WINDOW_MS = 15 * 60 * 1000
const UID_LIMIT = 10
const IP_LIMIT = 30

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

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    const organizerId = decodedClaims.uid

    const { code } = await request.json().catch(() => ({} as any))

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Verification code is required' }, { status: 400 })
    }

    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: 'Invalid verification code format. Must be 6 digits.' },
        { status: 400 }
      )
    }

    // A 6-digit code is a million guesses: cap the attempts per account and per
    // IP (fail closed), on top of the per-code wipe below.
    const [byUid, byIp] = await Promise.all([
      consumeRateLimit({ key: `payout-step-up-verify:uid:${organizerId}`, limit: UID_LIMIT, windowMs: LIMIT_WINDOW_MS }),
      consumeRateLimit({ key: `payout-step-up-verify:ip:${clientIp(request)}`, limit: IP_LIMIT, windowMs: LIMIT_WINDOW_MS }),
    ])
    if (byUid.limited || byIp.limited) {
      return NextResponse.json(
        { error: 'Too many attempts. Please wait a few minutes and request a new code.' },
        { status: 429 }
      )
    }

    const ref = getRef(organizerId)
    const nowMs = Date.now()
    const verifiedUntil = new Date(nowMs + CODE_TTL_MS).toISOString()

    // Checked and counted in one transaction, so parallel guesses cannot all be
    // judged against the same attempt count.
    const outcome: { ok: true } | { ok: false; status: number; error: string } = await adminDb.runTransaction(
      async (tx: any) => {
        const snap = await tx.get(ref)
        if (!snap.exists) return { ok: false, status: 400, error: 'No pending verification found' }

        const data = snap.data() as any
        const expiresAtIso = toIso(data?.expiresAt)
        if (!expiresAtIso) return { ok: false, status: 400, error: 'No pending verification found' }

        const expiresAtMs = new Date(expiresAtIso).getTime()
        if (!Number.isFinite(expiresAtMs) || expiresAtMs < nowMs) {
          return { ok: false, status: 400, error: 'Verification code expired' }
        }

        const salt = String(data?.salt || '')
        const expectedHash = String(data?.codeHash || '')
        if (!salt || !expectedHash) return { ok: false, status: 400, error: 'No pending verification found' }

        const actualHash = hashCode(salt, code)
        const matches =
          actualHash.length === expectedHash.length &&
          crypto.timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash))

        if (!matches) {
          const failed = Math.max(0, Number(data?.failedAttempts || 0) || 0) + 1
          if (failed >= MAX_FAILED_ATTEMPTS) {
            // Burn the code: the organizer must request a new one.
            tx.set(
              ref,
              { failedAttempts: 0, codeHash: null, salt: null, expiresAt: null, lockedAt: new Date().toISOString() },
              { merge: true }
            )
            return { ok: false, status: 400, error: 'Too many incorrect codes. Request a new code.' }
          }
          tx.set(ref, { failedAttempts: failed }, { merge: true })
          return { ok: false, status: 400, error: 'Invalid verification code' }
        }

        tx.set(
          ref,
          {
            verifiedAt: new Date().toISOString(),
            verifiedUntil,
            failedAttempts: 0,
            // clear one-time code material
            codeHash: null,
            salt: null,
            expiresAt: null,
          },
          { merge: true }
        )
        return { ok: true }
      }
    )

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status })
    }

    return NextResponse.json({
      success: true,
      message: 'Verified',
      verifiedUntil,
    })
  } catch (error: any) {
    console.error('Error verifying payout change email code:', error)
    return NextResponse.json(
      { error: 'Failed to verify code', message: error?.message },
      { status: 500 }
    )
  }
}
