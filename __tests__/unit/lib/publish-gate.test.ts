/**
 * Unit tests for checkPaidPublishGate() — the pre-publish gate for PAID events.
 *
 * The case that motivated extracting this: stripe.accounts.retrieve() throwing
 * `resource_missing` because the stored account id belongs to the PREVIOUS
 * platform account. That is the state every US/CA/FR organizer is in after a
 * platform migration, and it used to escape the route as an unhandled throw and
 * surface to the organizer as a blank 500 "Internal server error" — so the one
 * person who could fix it was never told to reconnect Stripe.
 *
 * Firestore is modelled in memory (same approach as haiti-withdrawal-gate.test.ts).
 */

type Doc = Record<string, any>

const store = new Map<string, Doc>()

jest.mock('@/lib/firebase/admin', () => {
  const makeDocRef = (key: string) => ({
    get: async () => {
      const data = store.get(key)
      return { exists: data !== undefined, data: () => data }
    },
  })
  return {
    adminDb: {
      collection: (name: string) => ({
        doc: (id: string) => makeDocRef(`${name}/${id}`),
      }),
    },
  }
})

// The gate reads the payout profile through this helper; stub it so the test
// stays about the gate's decisions rather than profile storage shape.
const mockGetPayoutProfile = jest.fn()
jest.mock('@/lib/firestore/payout-profiles', () => ({
  ...jest.requireActual('@/lib/firestore/payout-profiles'),
  getPayoutProfile: (...args: any[]) => mockGetPayoutProfile(...args),
}))

import { checkPaidPublishGate } from '@/lib/events/publish-gate'

const ORGANIZER = 'org_1'

function stripeReturning(account: any) {
  return { accounts: { retrieve: jest.fn(async () => account) } }
}

function stripeThrowing(err: any) {
  return {
    accounts: {
      retrieve: jest.fn(async () => {
        throw err
      }),
    },
  }
}

const GOOD_ACCOUNT = {
  details_submitted: true,
  charges_enabled: true,
  payouts_enabled: true,
  country: 'US',
  default_currency: 'usd',
}

beforeEach(() => {
  store.clear()
  mockGetPayoutProfile.mockReset()
  // Verified organizer by default; individual tests override.
  store.set(`users/${ORGANIZER}`, { is_verified: true })
  mockGetPayoutProfile.mockResolvedValue({ stripeAccountId: 'acct_old' })
})

describe('Haiti and other non-Stripe markets', () => {
  it('never gates at publish — KYC is enforced at withdrawal instead', async () => {
    store.set(`users/${ORGANIZER}`, { is_verified: false })
    mockGetPayoutProfile.mockResolvedValue(null)

    const res = await checkPaidPublishGate({ organizerId: ORGANIZER, country: 'HT' })

    expect(res.ok).toBe(true)
  })
})

describe('coming-soon markets', () => {
  it('blocks paid events in the Dominican Republic', async () => {
    const res = await checkPaidPublishGate({ organizerId: ORGANIZER, country: 'DO' })

    expect(res).toMatchObject({ ok: false, status: 403, code: 'coming_soon' })
  })
})

describe('Stripe Connect markets', () => {
  it.each(['US', 'CA', 'FR'])('gates %s, not just US/CA', async (country) => {
    mockGetPayoutProfile.mockResolvedValue(null)

    const res = await checkPaidPublishGate({ organizerId: ORGANIZER, country })

    expect(res).toMatchObject({ ok: false, code: 'stripe_connect_required' })
  })

  it('requires identity verification first', async () => {
    store.set(`users/${ORGANIZER}`, { is_verified: false })

    const res = await checkPaidPublishGate({
      organizerId: ORGANIZER,
      country: 'US',
      stripe: stripeReturning(GOOD_ACCOUNT),
    })

    expect(res).toMatchObject({ ok: false, status: 403, code: 'verification_required' })
  })

  it('allows publish when onboarding is complete', async () => {
    const res = await checkPaidPublishGate({
      organizerId: ORGANIZER,
      country: 'US',
      stripe: stripeReturning(GOOD_ACCOUNT),
    })

    expect(res).toEqual({ ok: true, warnings: [] })
  })

  it('blocks when charges are not yet enabled', async () => {
    const res = await checkPaidPublishGate({
      organizerId: ORGANIZER,
      country: 'US',
      stripe: stripeReturning({ ...GOOD_ACCOUNT, charges_enabled: false }),
    })

    expect(res).toMatchObject({ ok: false, status: 403, code: 'stripe_onboarding_incomplete' })
  })

  it('warns (without blocking) when the account country differs from the event country', async () => {
    const res = await checkPaidPublishGate({
      organizerId: ORGANIZER,
      country: 'CA',
      stripe: stripeReturning({ ...GOOD_ACCOUNT, country: 'US', default_currency: 'usd' }),
    })

    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('unreachable')
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toMatchObject({
      code: 'payout_country_mismatch',
      eventCountry: 'CA',
      accountCountry: 'US',
      payoutCurrency: 'USD',
    })
  })
})

describe('Stripe errors are verdicts, not crashes', () => {
  it('turns a stale account id from a previous platform account into an actionable 403', async () => {
    const err: any = new Error('No such account: acct_old')
    err.type = 'StripeInvalidRequestError'
    err.code = 'resource_missing'

    const res = await checkPaidPublishGate({
      organizerId: ORGANIZER,
      country: 'US',
      stripe: stripeThrowing(err),
    })

    expect(res).toMatchObject({ ok: false, status: 403, code: 'stripe_account_unavailable' })
    if (res.ok) throw new Error('unreachable')
    expect(res.error).toMatch(/reconnect stripe/i)
  })

  it('handles the shape Stripe ACTUALLY returns for another platform\'s account', async () => {
    // Captured from the live SDK against sk_test: retrieving an account this
    // platform does not own gives StripePermissionError/account_invalid — not the
    // resource_missing you would guess. Pinned here so the classifier is tested
    // against observed behaviour rather than an assumption about it.
    const err: any = new Error("The provided key does not have access to account 'acct_x'")
    err.type = 'StripePermissionError'
    err.code = 'account_invalid'
    err.statusCode = 403

    const res = await checkPaidPublishGate({
      organizerId: ORGANIZER,
      country: 'US',
      stripe: stripeThrowing(err),
    })

    expect(res).toMatchObject({ ok: false, status: 403, code: 'stripe_account_unavailable' })
    if (res.ok) throw new Error('unreachable')
    expect(res.error).toMatch(/reconnect stripe/i)
  })

  it('fails closed but retryable when Stripe itself is unreachable', async () => {
    const err: any = new Error('network')
    err.type = 'StripeConnectionError'

    const res = await checkPaidPublishGate({
      organizerId: ORGANIZER,
      country: 'US',
      stripe: stripeThrowing(err),
    })

    expect(res).toMatchObject({ ok: false, status: 503, code: 'stripe_unreachable' })
  })

  it('never throws out of the gate for any Stripe failure', async () => {
    const err: any = new Error('boom')
    err.type = 'StripeAPIError'

    await expect(
      checkPaidPublishGate({ organizerId: ORGANIZER, country: 'US', stripe: stripeThrowing(err) })
    ).resolves.toMatchObject({ ok: false })
  })
})
