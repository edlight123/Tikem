/**
 * Code generation and hashing for phone one-time codes.
 *
 * Nothing secret is ever stored in the clear:
 *   - the Firestore doc id is an HMAC of the phone number (so the collection
 *     cannot be browsed for numbers even with read access), and
 *   - the code is stored as an HMAC bound to that doc id, so a leaked doc can
 *     neither be brute-forced offline (the key is server-only) nor replayed
 *     against another number.
 */

import crypto from 'crypto'

export const CODE_LENGTH = 6

const DEV_SECRET = 'tikem-dev-only-otp-secret-not-for-production'

/**
 * The HMAC key. Required in production (the routes refuse to run without it);
 * a fixed dev key elsewhere so local testing needs no setup.
 */
export function otpSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.AUTH_OTP_SECRET
  if (s && s.length >= 32) return s
  if (env.NODE_ENV === 'production') return null
  return DEV_SECRET
}

/** A uniformly random 6-digit code ("000000" to "999999"), from the CSPRNG. */
export function generateCode(): string {
  return crypto.randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, '0')
}

export function hmac(secret: string, value: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('hex')
}

export type OtpPurpose = 'signin' | 'link'

/**
 * Doc id for one pending code. Bound to the purpose (and, for linking, to the
 * account), so a sign-in code can never complete a link and vice versa.
 */
export function otpDocId(secret: string, e164: string, purpose: OtpPurpose, uid = ''): string {
  return hmac(secret, `otp:${purpose}:${uid}:${e164}`)
}

/** Rate-limit subject for a phone number, shared by both purposes. */
export function phoneKey(secret: string, e164: string): string {
  return hmac(secret, `phone:${e164}`)
}

export function ipKey(secret: string, ip: string): string {
  return hmac(secret, `ip:${ip}`)
}

export function hashCode(secret: string, docId: string, code: string): string {
  return hmac(secret, `code:${docId}:${code}`)
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const ab = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  if (ab.length === 0 || ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export function isWellFormedCode(code: unknown): code is string {
  return typeof code === 'string' && new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)
}
