import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Payout-phone verification codes are stored only as a hash, bound to the
 * organizer, so a Firestore read (or an export, or a log of the doc) does not
 * hand out a live code.
 */
export function hashPhoneVerificationCode(organizerId: string, code: string): string {
  return createHash('sha256').update(`payout-phone:${organizerId}:${code}`).digest('hex')
}

export function phoneVerificationCodeMatches(
  organizerId: string,
  code: string,
  storedHash: unknown
): boolean {
  if (typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/.test(storedHash)) return false
  const a = Buffer.from(hashPhoneVerificationCode(organizerId, code), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Wrong guesses allowed per code before a new one must be requested. */
export const PHONE_VERIFICATION_MAX_ATTEMPTS = 5
