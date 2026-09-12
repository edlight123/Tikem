/**
 * The publish gate for PAID events — the single source of truth shared by the
 * web publish route, the mobile preflight endpoint, and their tests.
 *
 * Launch policy is "verify at the money, not at the door": Haiti organizers may
 * publish paid events with no payout profile and no KYC, because the withdrawal
 * routes enforce both before any money leaves. Stripe Connect markets (US/CA/FR)
 * keep the full pre-publish gate, because destination charges simply cannot
 * collect money until onboarding is complete — publishing there would put a
 * ticket on sale that no buyer can pay for.
 *
 * Every failure path returns a typed verdict. Nothing in here throws for an
 * expected condition: a Stripe account that no longer exists on this platform is
 * a normal, actionable state (it is exactly what an organizer looks like after a
 * platform-account migration), not a server error.
 */
import { adminDb } from '@/lib/firebase/admin'
import { countrySupport, isComingSoon, normalizeSupportedCountry } from '@/lib/country-support'
import { getPayoutProfile, getRequiredPayoutProfileIdForEventCountry } from '@/lib/firestore/payout-profiles'

export type PublishGateBlockCode =
  | 'coming_soon'
  | 'verification_required'
  | 'stripe_connect_required'
  | 'stripe_onboarding_incomplete'
  | 'stripe_account_unavailable'
  | 'stripe_unreachable'

export type PublishGateWarning = Record<string, any>

export type PublishGateResult =
  | { ok: true; warnings: PublishGateWarning[] }
  | { ok: false; status: number; code: PublishGateBlockCode; error: string }

/** Minimal shape we need from Stripe, so tests can inject a stub. */
export type StripeAccountsReader = {
  accounts: { retrieve: (id: string) => Promise<any> }
}

function defaultStripe(): StripeAccountsReader {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY)
}

export async function isOrganizerVerified(userId: string): Promise<boolean> {
  const userDoc = await adminDb.collection('users').doc(userId).get()
  const userData = userDoc.exists ? userDoc.data() : null

  const userVerified = userData?.is_verified === true || userData?.verification_status === 'approved'
  if (userVerified) return true

  const requestDoc = await adminDb.collection('verification_requests').doc(userId).get()
  const requestData = requestDoc.exists ? requestDoc.data() : null
  return requestData?.status === 'approved'
}

/**
 * Classify a throw from `stripe.accounts.retrieve`.
 *
 * The important case is an account id this platform cannot read: the id on the
 * payout profile is real, but it does not belong to THIS platform account —
 * which is every organizer's state after the platform moved to a new acct_.
 * Before this was classified, it escaped as an unhandled throw and surfaced as a
 * blank 500, so the one organizer who could act on it was never told to re-onboard.
 *
 * Verified against the live SDK rather than assumed: retrieving an account that
 * belongs to a different platform returns `StripePermissionError` with code
 * `account_invalid` (HTTP 403) — NOT the `resource_missing` you would expect from
 * the generic "no such object" family. Both are matched, since a deleted account
 * and a rejected id are the same problem to the organizer.
 */
function classifyStripeError(err: any): { status: number; code: PublishGateBlockCode; error: string } {
  const type = String(err?.type || '')
  const code = String(err?.code || '')

  if (
    code === 'account_invalid' ||
    code === 'resource_missing' ||
    type === 'StripeInvalidRequestError' ||
    type === 'StripePermissionError'
  ) {
    return {
      status: 403,
      code: 'stripe_account_unavailable',
      error:
        'Your Stripe payout account could not be found. Reconnect Stripe in Payout settings before publishing paid events.',
    }
  }

  // Stripe itself is unreachable or misconfigured. We cannot confirm the
  // organizer can take money, so fail closed — but say it is temporary, and use
  // a retryable status so this is never confused with "you must go do something".
  return {
    status: 503,
    code: 'stripe_unreachable',
    error: "We couldn't verify your Stripe payout account just now. Please try publishing again in a moment.",
  }
}

/**
 * Decide whether `organizerId` may publish a PAID event in `country`.
 *
 * Callers are responsible for establishing that the event is in fact paid; a
 * free/RSVP event is never gated.
 */
export async function checkPaidPublishGate(params: {
  organizerId: string
  country: unknown
  stripe?: StripeAccountsReader
}): Promise<PublishGateResult> {
  const { organizerId, country } = params
  const warnings: PublishGateWarning[] = []

  // Coming-soon markets (Dominican Republic): payouts aren't wired yet, so a
  // PAID event may not be published there. The country stays browsable and
  // free/RSVP events publish normally — only priced events are blocked.
  if (isComingSoon(country)) {
    const name = countrySupport(country)?.name || 'this country'
    return { ok: false, status: 403, code: 'coming_soon', error: `Paid events are coming soon in ${name}` }
  }

  // Haiti (and other non-Stripe markets): no publish-time gate — KYC is
  // enforced at disbursement instead.
  if (getRequiredPayoutProfileIdForEventCountry(country) !== 'stripe_connect') {
    return { ok: true, warnings }
  }

  if (!(await isOrganizerVerified(organizerId))) {
    return {
      ok: false,
      status: 403,
      code: 'verification_required',
      error: 'Verification required to publish paid events',
    }
  }

  const stripeProfile = await getPayoutProfile(organizerId, 'stripe_connect')
  const stripeAccountId = stripeProfile?.stripeAccountId
  if (!stripeAccountId) {
    return {
      ok: false,
      status: 403,
      code: 'stripe_connect_required',
      error: 'Stripe Connect required to publish paid events in this country.',
    }
  }

  let account: any
  try {
    account = await (params.stripe || defaultStripe()).accounts.retrieve(stripeAccountId)
  } catch (err: any) {
    console.error('publish gate: stripe.accounts.retrieve failed', {
      organizerId,
      stripeAccountId,
      type: err?.type,
      code: err?.code,
    })
    return { ok: false, ...classifyStripeError(err) }
  }

  const verifiedStripe = Boolean(
    account?.details_submitted && account?.charges_enabled && account?.payouts_enabled
  )
  if (!verifiedStripe) {
    return {
      ok: false,
      status: 403,
      code: 'stripe_onboarding_incomplete',
      error: 'Stripe Connect onboarding required before publishing paid events in this country.',
    }
  }

  // ── Cross-border advisory (WARN, never block) ──
  // A Stripe Express account's country is fixed when it is created, and an
  // organizer holds exactly ONE stripe_connect profile. So a US-registered
  // organizer running a Canadian event still gets paid — but into their USD
  // account, with an FX conversion nobody warned them about. Getting a
  // genuinely local payout would mean a second connected account, which this
  // model does not support. Say so at publish rather than at payout.
  const accountCountry = String(account?.country || '').toUpperCase()
  const eventCountryCode = normalizeSupportedCountry(country)
  if (accountCountry && eventCountryCode && accountCountry !== eventCountryCode) {
    const payoutCurrency = String(account?.default_currency || '').toUpperCase()
    warnings.push({
      code: 'payout_country_mismatch',
      eventCountry: eventCountryCode,
      eventCountryName: countrySupport(eventCountryCode)?.name || eventCountryCode,
      accountCountry,
      accountCountryName: countrySupport(accountCountry)?.name || accountCountry,
      payoutCurrency: payoutCurrency || null,
      message:
        `This event is in ${countrySupport(eventCountryCode)?.name || eventCountryCode}, but your connected payout account is registered in ` +
        `${countrySupport(accountCountry)?.name || accountCountry}. You'll still be paid — into that account, in ` +
        `${payoutCurrency || 'its own currency'}, with a currency conversion applied. ` +
        `Being paid locally would require a separate connected account for ${countrySupport(eventCountryCode)?.name || eventCountryCode}, which Tikèm doesn't support yet.`,
    })
  }

  return { ok: true, warnings }
}
