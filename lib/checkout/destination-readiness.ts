/**
 * Can this organizer's Stripe Connect account receive a destination charge
 * RIGHT NOW? Asked before a PaymentIntent / Checkout Session is created.
 *
 * Why ask first instead of letting `paymentIntents.create` fail: when the
 * platform moved to a new live Stripe account, every stored `acct_…` became an id
 * the new platform has never seen. The create call then fails with
 * "No such destination: 'acct_…'", which is a developer message — a tester saw it
 * verbatim in the app. Checking first lets checkout answer with a typed code the
 * clients can localize and act on (offer MonCash, tell the buyer it is the
 * organizer's setup, not their card), and gives the organizer-notice hook a
 * reliable signal instead of a regex over Stripe's wording.
 *
 * Deliberately free of Firestore / firebase-admin so it can be unit tested with a
 * stub Stripe client.
 */

export const ORGANIZER_PAYMENTS_UNAVAILABLE = 'organizer_payments_unavailable' as const

/** Buyer-facing copy for the typed code. Clients localize off the code; this is the fallback. */
export const ORGANIZER_PAYMENTS_UNAVAILABLE_MESSAGE =
  "This organizer can't accept card payments yet. Please try another payment method, or contact the organizer."

export type DestinationUnreadyReason =
  /** No stripe_connect account id on the payout profile at all. */
  | 'missing'
  /** The id is not an account this platform can read (other platform, deleted, junk). */
  | 'unavailable'
  /** The account exists but cannot take charges / receive transfers yet. */
  | 'charges_disabled'

export type DestinationVerdict =
  | { ok: true; /** true when Stripe could not be asked and we failed open. */ unverified?: boolean }
  | { ok: false; reason: DestinationUnreadyReason }

export type StripeAccountsReader = {
  accounts: { retrieve: (id: string) => Promise<any> }
}

/** A healthy verdict is reused for a few minutes: an organizer's account does not flap. */
const OK_TTL_MS = 5 * 60 * 1000
/** A bad verdict is short-lived so an organizer who just re-onboarded is unblocked quickly. */
const BAD_TTL_MS = 60 * 1000

const cache = new Map<string, { verdict: DestinationVerdict; expiresAt: number }>()

/** Test hook. */
export function clearDestinationReadinessCache(): void {
  cache.clear()
}

/**
 * Is a throw from `accounts.retrieve` "this id is not usable" (as opposed to
 * "Stripe could not be reached")?
 *
 * Verified against the live SDK by the publish gate: an account belonging to a
 * different platform comes back as `StripePermissionError` / `account_invalid`
 * (HTTP 403), not `resource_missing`. Both, and a plain invalid request, mean the
 * organizer has to reconnect.
 */
export function isUnusableAccountError(err: any): boolean {
  const type = String(err?.type || err?.rawType || '')
  const code = String(err?.code || err?.raw?.code || '')
  const status = Number(err?.statusCode || err?.raw?.statusCode || 0)
  return (
    code === 'account_invalid' ||
    code === 'resource_missing' ||
    type === 'StripeInvalidRequestError' ||
    type === 'StripePermissionError' ||
    status === 403 ||
    status === 404
  )
}

/** Pure: read readiness off a retrieved Account object. */
export function accountCanReceiveDestinationCharges(account: any): boolean {
  if (!account || typeof account !== 'object') return false
  // Destination charges move money through `transfers`; when Stripe reports the
  // capability, that is the precise answer.
  const transfers = account?.capabilities?.transfers
  if (typeof transfers === 'string') return transfers === 'active'
  return account.charges_enabled !== false
}

export async function checkDestinationReadiness(
  accountId: string | null | undefined,
  opts: { stripe: StripeAccountsReader; now?: number }
): Promise<DestinationVerdict> {
  const id = String(accountId || '').trim()
  if (!id) return { ok: false, reason: 'missing' }

  const now = opts.now ?? Date.now()
  const hit = cache.get(id)
  if (hit && hit.expiresAt > now) return hit.verdict

  let verdict: DestinationVerdict
  try {
    const account = await opts.stripe.accounts.retrieve(id)
    verdict = accountCanReceiveDestinationCharges(account)
      ? { ok: true }
      : { ok: false, reason: 'charges_disabled' }
  } catch (err: any) {
    if (isUnusableAccountError(err)) {
      verdict = { ok: false, reason: 'unavailable' }
    } else {
      // Stripe unreachable / rate limited: we could not prove the account is
      // broken, so do not refuse the sale on a blip. The create call that follows
      // still fails safely (and is sanitized) if the account really is bad.
      console.warn('destination readiness: could not verify account, failing open', {
        type: err?.type,
        code: err?.code,
      })
      return { ok: true, unverified: true }
    }
  }

  cache.set(id, { verdict, expiresAt: now + (verdict.ok ? OK_TTL_MS : BAD_TTL_MS) })
  return verdict
}
