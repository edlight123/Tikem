/**
 * Card checkout asks whether the organizer's Connect account can take a
 * destination charge BEFORE creating the PaymentIntent. The case that matters is
 * the one a tester hit: an acct_ id from the previous platform account, which
 * Stripe reports as StripePermissionError / account_invalid.
 */
import {
  accountCanReceiveDestinationCharges,
  checkDestinationReadiness,
  clearDestinationReadinessCache,
  isUnusableAccountError,
} from '@/lib/checkout/destination-readiness'

function stripeReturning(impl: (id: string) => Promise<any>) {
  const retrieve = jest.fn(impl)
  return { stripe: { accounts: { retrieve } }, retrieve }
}

beforeEach(() => {
  clearDestinationReadinessCache()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('checkDestinationReadiness', () => {
  it('refuses when the payout profile has no account id, without calling Stripe', async () => {
    const { stripe, retrieve } = stripeReturning(async () => ({}))
    await expect(checkDestinationReadiness(undefined, { stripe })).resolves.toEqual({ ok: false, reason: 'missing' })
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('flags an account that belongs to another platform (the build-39 failure)', async () => {
    const { stripe } = stripeReturning(async () => {
      throw Object.assign(new Error("The provided key does not have access to account 'acct_1SfytLC6CSO7g3zh'"), {
        type: 'StripePermissionError',
        code: 'account_invalid',
        statusCode: 403,
      })
    })
    await expect(checkDestinationReadiness('acct_1SfytLC6CSO7g3zh', { stripe })).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    })
  })

  it('flags an account that exists but cannot take charges yet', async () => {
    const { stripe } = stripeReturning(async () => ({ charges_enabled: false }))
    await expect(checkDestinationReadiness('acct_x', { stripe })).resolves.toEqual({
      ok: false,
      reason: 'charges_disabled',
    })
  })

  it('passes a healthy account and caches the answer', async () => {
    const { stripe, retrieve } = stripeReturning(async () => ({
      charges_enabled: true,
      capabilities: { transfers: 'active', card_payments: 'active' },
    }))
    const now = 1_000_000
    await expect(checkDestinationReadiness('acct_ok', { stripe, now })).resolves.toEqual({ ok: true })
    await checkDestinationReadiness('acct_ok', { stripe, now: now + 60_000 })
    expect(retrieve).toHaveBeenCalledTimes(1)
    // ...but not forever.
    await checkDestinationReadiness('acct_ok', { stripe, now: now + 10 * 60_000 })
    expect(retrieve).toHaveBeenCalledTimes(2)
  })

  it('re-checks a bad account quickly, so a re-onboarded organizer is not stuck', async () => {
    let healthy = false
    const { stripe } = stripeReturning(async () => ({ charges_enabled: healthy }))
    const now = 5_000_000
    expect((await checkDestinationReadiness('acct_r', { stripe, now })).ok).toBe(false)
    healthy = true
    expect((await checkDestinationReadiness('acct_r', { stripe, now: now + 2 * 60_000 })).ok).toBe(true)
  })

  it('fails OPEN when Stripe cannot be reached, and does not cache that', async () => {
    const { stripe, retrieve } = stripeReturning(async () => {
      throw Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' })
    })
    await expect(checkDestinationReadiness('acct_n', { stripe })).resolves.toEqual({ ok: true, unverified: true })
    await checkDestinationReadiness('acct_n', { stripe })
    expect(retrieve).toHaveBeenCalledTimes(2)
  })
})

describe('accountCanReceiveDestinationCharges', () => {
  it('prefers the transfers capability when Stripe reports it', () => {
    expect(accountCanReceiveDestinationCharges({ charges_enabled: true, capabilities: { transfers: 'inactive' } })).toBe(false)
    expect(accountCanReceiveDestinationCharges({ charges_enabled: true, capabilities: { transfers: 'active' } })).toBe(true)
  })
  it('falls back to charges_enabled', () => {
    expect(accountCanReceiveDestinationCharges({ charges_enabled: true })).toBe(true)
    expect(accountCanReceiveDestinationCharges({ charges_enabled: false })).toBe(false)
    expect(accountCanReceiveDestinationCharges(null)).toBe(false)
  })
})

describe('isUnusableAccountError', () => {
  it('separates a bad id from an outage', () => {
    expect(isUnusableAccountError({ code: 'resource_missing' })).toBe(true)
    expect(isUnusableAccountError({ type: 'StripeInvalidRequestError' })).toBe(true)
    expect(isUnusableAccountError({ type: 'StripeAPIError', statusCode: 500 })).toBe(false)
    expect(isUnusableAccountError({ type: 'StripeRateLimitError', statusCode: 429 })).toBe(false)
  })
})
