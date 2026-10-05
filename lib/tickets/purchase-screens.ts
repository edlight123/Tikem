/**
 * The abuse screens the Stripe PaymentIntent route has always run before taking a
 * card payment (blacklist, rate limit, bot check, per-account ticket limit), as one
 * reusable call so the mobile-money rails run the SAME screens instead of none.
 *
 * Mirrors app/api/create-payment-intent/route.ts exactly: same helpers from
 * lib/security.ts, same order, same buyer-facing wording, same attempt logging.
 */
import {
  checkTicketLimit,
  detectBotBehavior,
  isBlacklisted,
  logPurchaseAttempt,
  shouldRateLimit,
} from '@/lib/security'

export type PurchaseScreenInput = {
  /** Signed-in account id, or null for a guest. */
  userId: string | null
  /** The buyer's email (account email, or the guest contact's). */
  email: string
  /** Is the buyer a guest? Guests skip the per-account ticket limit (their id is minted per order). */
  isGuest: boolean
  eventId: string
  ipAddress: string
  quantity: number
  fingerprint?: string | null
}

export type PurchaseScreenResult =
  | { ok: true; log: (success: boolean) => Promise<void> }
  | { ok: false; error: string; status: number }

export async function screenPurchaseAttempt(input: PurchaseScreenInput): Promise<PurchaseScreenResult> {
  const attemptUserId = input.userId ? input.userId : `guest:${input.email}`
  const attempt = {
    userId: attemptUserId,
    eventId: input.eventId,
    ipAddress: input.ipAddress,
    quantity: input.quantity,
    fingerprint: input.fingerprint || undefined,
  }
  const log = async (success: boolean) => {
    try {
      await logPurchaseAttempt(attempt as any, success)
    } catch (err) {
      console.warn('[purchase-screens] failed to log purchase attempt', (err as any)?.message)
    }
  }
  const deny = async (error: string, status: number): Promise<PurchaseScreenResult> => {
    await log(false)
    return { ok: false, error, status }
  }

  if (input.userId) {
    const userBlacklist = await isBlacklisted(input.userId, 'user')
    if (userBlacklist.blacklisted) return deny(`Account suspended: ${userBlacklist.reason}`, 403)
  }
  if (input.email) {
    const emailBlacklist = await isBlacklisted(input.email, 'email')
    if (emailBlacklist.blacklisted) return deny('Unable to process purchase. Please contact support.', 403)
  }
  const ipBlacklist = await isBlacklisted(input.ipAddress, 'ip')
  if (ipBlacklist.blacklisted) return deny('Unable to process purchase from this network.', 403)

  const rateLimit = await shouldRateLimit(input.userId, input.ipAddress, input.eventId)
  if (rateLimit.limited) return deny(rateLimit.reason || 'Too many purchase attempts.', 429)

  const isBot = await detectBotBehavior(input.userId, input.ipAddress, input.fingerprint || undefined)
  if (isBot) return deny('Automated purchase attempts are not allowed.', 403)

  if (!input.isGuest && input.userId) {
    const limit = await checkTicketLimit(input.userId, input.eventId)
    if (limit.exceeded) {
      return deny(
        `You already have ${limit.currentCount} ticket(s) for this event. Maximum allowed: ${limit.maxAllowed}`,
        400
      )
    }
    if (limit.maxAllowed != null && (limit.currentCount || 0) + input.quantity > limit.maxAllowed) {
      const remaining = limit.maxAllowed - (limit.currentCount || 0)
      return deny(
        `You can only purchase ${remaining} more ticket(s) for this event (limit: ${limit.maxAllowed})`,
        400
      )
    }
  }

  return { ok: true, log }
}
