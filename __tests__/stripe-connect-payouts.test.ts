/**
 * Stripe Connect lifecycle + payout_releases truth:
 *  - H1: a stored account id from the old platform is archived and replaced on
 *    /connect; status / login-link report "reconnect needed" instead of throwing.
 *  - H4: Connect payout.failed makes the money re-releasable (under a fresh
 *    idempotency key), notifies the organizer once, is idempotent on
 *    redelivery, and repeated failures park the event for an admin.
 *
 * @jest-environment node
 */

import { createFakeFirestore } from './helpers/fakeFirestoreTracking'

const mockFake = createFakeFirestore()
const mockState: any = {
  event: null,
  profile: null,
  markets: [] as string[],
  retrieve: null as any,
  created: [] as any[],
}

const mockStripe: any = {
  webhooks: { constructEvent: jest.fn(() => mockState.event) },
  accounts: {
    retrieve: jest.fn(async (id: string) => {
      const r = mockState.retrieve
      if (typeof r === 'function') return r(id)
      return r
    }),
    create: jest.fn(async (params: any) => {
      const acct = { id: `acct_new_${mockState.created.length + 1}`, ...params }
      mockState.created.push(acct)
      return acct
    }),
    del: jest.fn(async () => ({ deleted: true })),
    createLoginLink: jest.fn(async () => {
      throw Object.assign(new Error("No such account: 'acct_old'"), { code: 'account_invalid', statusCode: 400 })
    }),
  },
  accountLinks: { create: jest.fn(async ({ account }: any) => ({ url: `https://connect.stripe.com/setup/${account}` })) },
  payouts: { retrieve: jest.fn(), list: jest.fn() },
}

jest.mock('@/lib/firebase/admin', () => ({ adminDb: mockFake.db }))
jest.mock('firebase-admin/firestore', () => require('./helpers/fakeFirestoreTracking').fieldValueModule)
jest.mock('stripe', () => () => mockStripe, { virtual: true })
jest.mock('@/lib/auth', () => ({ requireAuth: jest.fn(async () => ({ user: { id: 'org1' }, error: null })) }))
jest.mock('@/lib/firestore/payout-profiles', () => ({
  getPayoutProfile: jest.fn(async () => mockState.profile),
  // Subcollections are flattened for the fake store.
  getPayoutProfileRef: (organizerId: string, profileId: string) =>
    mockFake.db.collection('payoutProfiles').doc(`${organizerId}__${profileId}`),
}))
jest.mock('@/lib/firestore/payout', () => ({ updatePayoutProfileConfig: jest.fn(async () => ({ success: true })) }))
jest.mock('@/lib/firestore/organizer-markets', () => ({ getDeclaredMarkets: jest.fn(async () => mockState.markets) }))
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: jest.fn(async () => 'n1') }))
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: jest.fn(async () => undefined) }))
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn(async () => ({ success: true })) }))
jest.mock('@/lib/disputes', () => ({ handleStripeDisputeEvent: jest.fn(async () => ({})) }))
jest.mock('@/lib/guest/checkout', () => ({ guestRecipientFromOrder: jest.fn(() => null) }))
jest.mock('@/lib/tickets/stripe-fulfillment', () => ({
  fulfillStripeOrder: jest.fn(),
  applyStripeChargeRefund: jest.fn(),
  stripeOrderHasTickets: jest.fn(async () => false),
}))

const connectRoute = require('@/app/api/organizer/stripe/connect/route')
const statusRoute = require('@/app/api/organizer/stripe/status/route')
const loginLinkRoute = require('@/app/api/organizer/stripe/login-link/route')
const webhookRoute = require('@/app/api/webhooks/stripe/route')
const { updatePayoutProfileConfig } = require('@/lib/firestore/payout')
const { createNotification } = require('@/lib/notifications/helpers')
const { sendEmail } = require('@/lib/email')
const {
  isStaleStripeAccountError,
  toStripeConnectCountry,
} = require('@/lib/stripe-connect-account')
const {
  summarizeEventReleases,
  releaseAttemptDocId,
  nextReleaseStatus,
  failureCapCleared,
  reconcileStuckPayoutReleases,
  MAX_STRIPE_PAYOUT_FAILURES,
} = require('@/lib/stripe-payout-releases')

const staleError = () =>
  Object.assign(new Error("No such account: 'acct_old'"), { code: 'account_invalid', type: 'StripeInvalidRequestError', statusCode: 400 })

const profileDoc = () => mockFake.get('payoutProfiles', 'org1__stripe_connect')

const connect = async (body: any) => {
  const { NextRequest } = require('next/server')
  const res = await connectRoute.POST(
    new NextRequest('https://www.tikem.co/api/organizer/stripe/connect', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', host: 'www.tikem.co' },
    })
  )
  return { status: res.status as number, json: await res.json() }
}

const postWebhook = async () => {
  const res = await webhookRoute.POST(
    new Request('https://www.tikem.co/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'sig' },
      body: '{}',
    })
  )
  return { status: res.status as number, json: await res.json() }
}

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform'
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect'
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

beforeEach(() => {
  jest.clearAllMocks()
  mockFake.reset()
  mockState.event = null
  mockState.profile = null
  mockState.markets = []
  mockState.retrieve = null
  mockState.created = []
})

// ── H1: stale account ids ───────────────────────────────────────────────────

describe('stale-account detection', () => {
  it('recognises the old-platform failures and nothing broader', () => {
    expect(isStaleStripeAccountError(staleError())).toBe(true)
    expect(isStaleStripeAccountError({ raw: { message: "The provided key 'sk_live_…' does not have access to account 'acct_x' (or that account does not exist). Application access may have been revoked." }, type: 'StripePermissionError' })).toBe(true)
    expect(isStaleStripeAccountError({ code: 'resource_missing', param: 'account', message: 'No such account' })).toBe(true)
    expect(isStaleStripeAccountError({ code: 'rate_limit', message: 'Too many requests' })).toBe(false)
    expect(isStaleStripeAccountError({ type: 'StripeInvalidRequestError', message: 'Invalid email' })).toBe(false)
    expect(isStaleStripeAccountError({ type: 'StripeConnectionError', message: 'socket hang up' })).toBe(false)
  })

  it('normalises Connect countries and refuses everything else', () => {
    expect(toStripeConnectCountry('united_states')).toBe('US')
    expect(toStripeConnectCountry('canada')).toBe('CA')
    expect(toStripeConnectCountry('FR')).toBe('FR')
    expect(toStripeConnectCountry('haiti')).toBeNull()
    expect(toStripeConnectCountry('')).toBeNull()
  })
})

describe('/connect with a stale stored id', () => {
  it('archives the old id, creates a fresh Express account server-side and returns a new link', async () => {
    mockState.profile = { stripeAccountId: 'acct_old', accountLocation: 'united_states' }
    mockFake.seed('payoutProfiles', 'org1__stripe_connect', { stripeAccountId: 'acct_old', accountLocation: 'united_states' })
    mockState.retrieve = () => {
      throw staleError()
    }

    const { status, json } = await connect({ accountLocation: 'canada' })

    expect(status).toBe(200)
    expect(json.reconnected).toBe(true)
    expect(json.stripeAccountId).toBe('acct_new_1')
    expect(json.url).toContain('acct_new_1')
    expect(mockStripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'express',
        country: 'CA',
        metadata: { organizerId: 'org1' },
        settings: { payouts: { schedule: { interval: 'manual' } } },
      })
    )
    expect(mockStripe.accountLinks.create).toHaveBeenCalledWith(expect.objectContaining({ account: 'acct_new_1' }))

    const stored = profileDoc()!
    expect(stored.stripeAccountId).toBe('acct_new_1')
    expect(stored.accountLocation).toBe('canada')
    expect(stored.previousStripeAccountIds).toEqual([
      expect.objectContaining({ id: 'acct_old', reason: 'account_invalid', archivedAt: expect.any(String) }),
    ])
  })

  it('reuses a healthy account untouched', async () => {
    mockState.profile = { stripeAccountId: 'acct_ok', accountLocation: 'united_states' }
    mockState.retrieve = { id: 'acct_ok', country: 'US', metadata: { organizerId: 'org1' } }
    const { status, json } = await connect({ accountLocation: 'united_states' })
    expect(status).toBe(200)
    expect(json.stripeAccountId).toBe('acct_ok')
    expect(json.reconnected).toBeUndefined()
    expect(mockStripe.accounts.create).not.toHaveBeenCalled()
  })

  it('treats an account stamped for another organizer as stale', async () => {
    mockState.profile = { stripeAccountId: 'acct_theirs', accountLocation: 'united_states' }
    mockState.retrieve = { id: 'acct_theirs', country: 'US', metadata: { organizerId: 'someone_else' } }
    const { json } = await connect({ accountLocation: 'united_states' })
    expect(json.stripeAccountId).toBe('acct_new_1')
    expect(profileDoc()!.previousStripeAccountIds[0]).toEqual(expect.objectContaining({ id: 'acct_theirs', reason: 'foreign_account' }))
  })

  it('refuses to silently re-country a submitted account', async () => {
    mockState.profile = { stripeAccountId: 'acct_ok', accountLocation: 'united_states' }
    mockState.retrieve = { id: 'acct_ok', country: 'US', details_submitted: true, metadata: { organizerId: 'org1' } }
    const { status, json } = await connect({ accountLocation: 'france' })
    expect(status).toBe(409)
    expect(json.code).toBe('country_mismatch')
    expect(mockStripe.accounts.create).not.toHaveBeenCalled()
  })

  it('first-time creation still goes through the profile writer', async () => {
    const { status, json } = await connect({ accountLocation: 'us' })
    expect(status).toBe(200)
    expect(json.stripeAccountId).toBe('acct_new_1')
    expect(updatePayoutProfileConfig).toHaveBeenCalledWith('org1', 'stripe_connect', expect.objectContaining({ stripeAccountId: 'acct_new_1', accountLocation: 'united_states' }))
  })
})

describe('/connect location validation (audit L9)', () => {
  it('rejects a location outside US/CA/FR instead of falling back', async () => {
    mockState.profile = { stripeAccountId: null, accountLocation: 'united_states' }
    const { status, json } = await connect({ accountLocation: 'haiti' })
    expect(status).toBe(400)
    expect(json.code).toBe('unsupported_location')
  })

  it('rejects a country outside the declared Stripe markets', async () => {
    mockState.markets = ['HT', 'US']
    const { status, json } = await connect({ accountLocation: 'france' })
    expect(status).toBe(400)
    expect(json.code).toBe('location_not_in_markets')
  })

  it('allows any Connect country when no Stripe market is declared', async () => {
    mockState.markets = ['HT']
    const { status } = await connect({ accountLocation: 'france' })
    expect(status).toBe(200)
  })
})

describe('status / login-link with a stale id', () => {
  it('status reports reconnect_needed as a state, not an error', async () => {
    mockState.profile = { stripeAccountId: 'acct_old' }
    mockState.retrieve = () => {
      throw staleError()
    }
    const res = await statusRoute.GET(new (require('next/server').NextRequest)('https://www.tikem.co/api/organizer/stripe/status'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual(expect.objectContaining({ connected: false, status: 'reconnect_needed', reconnectRequired: true }))
  })

  it('login-link answers 409 reconnect_needed', async () => {
    mockState.profile = { stripeAccountId: 'acct_old' }
    const res = await loginLinkRoute.POST(new (require('next/server').NextRequest)('https://www.tikem.co/api/organizer/stripe/login-link', { method: 'POST' }))
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.code).toBe('reconnect_needed')
  })
})

// ── H4: payout lifecycle ────────────────────────────────────────────────────

const seedRelease = (id: string, data: Record<string, any>) =>
  mockFake.seed('payout_releases', id, {
    eventId: 'evt1',
    organizerId: 'org1',
    stripeAccountId: 'acct_1',
    amountMinor: 5000,
    currency: 'usd',
    status: 'pending',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...data,
  })

const payoutEvent = (id: string, type: string, payout: Record<string, any>, account: string | null = 'acct_1') => ({
  id,
  type,
  ...(account ? { account } : {}),
  created: 1_760_000_000,
  data: { object: { object: 'payout', currency: 'usd', ...payout } },
})

describe('pure release accounting', () => {
  it('failed and canceled payouts stop counting as released; reserved still counts', () => {
    const summary = summarizeEventReleases([
      { status: 'paid', amountMinor: 1000 },
      { status: 'reserved', amountMinor: 200 },
      { status: 'failed', amountMinor: 5000, stripeFailed: true, failedAt: '2026-10-02T00:00:00Z', failureCode: 'account_closed' },
      { status: 'failed', amountMinor: 700 }, // create-time error, never left
    ])
    expect(summary.releasedMinor).toBe(1200)
    expect(summary.stripeFailureCount).toBe(1)
    expect(summary.lastFailureCode).toBe('account_closed')
  })

  it('a Stripe-side failure gives the retry a new doc id / idempotency key', () => {
    expect(releaseAttemptDocId('evt1', '20261005', 0)).toBe('evt1_20261005')
    expect(releaseAttemptDocId('evt1', '20261005', 1)).toBe('evt1_20261005_r1')
  })

  it('status only moves forward; paid can still fail, failed is final', () => {
    expect(nextReleaseStatus('pending', 'paid')).toBe('paid')
    expect(nextReleaseStatus('paid', 'failed')).toBe('failed')
    expect(nextReleaseStatus('failed', 'paid')).toBeNull()
    expect(nextReleaseStatus('paid', 'in_transit')).toBeNull()
    expect(nextReleaseStatus('pending', 'pending')).toBeNull()
  })

  it('the failure cap is only cleared by an admin release after the last failure', () => {
    expect(failureCapCleared(null, '2026-10-02T00:00:00Z')).toBe(false)
    expect(failureCapCleared({ status: 'released', resolvedAt: '2026-10-01T00:00:00Z' }, '2026-10-02T00:00:00Z')).toBe(false)
    expect(failureCapCleared({ status: 'released', resolvedAt: '2026-10-03T00:00:00Z' }, '2026-10-02T00:00:00Z')).toBe(true)
    expect(failureCapCleared({ status: 'held', resolvedAt: '2026-10-03T00:00:00Z' }, '2026-10-02T00:00:00Z')).toBe(false)
  })
})

describe('Connect payout webhooks', () => {
  it('payout.failed makes the funds re-releasable and tells the organizer', async () => {
    seedRelease('evt1_20261001', { payoutId: 'po_1' })
    mockFake.seed('users', 'org1', { email: 'org@example.com', language: 'fr' })
    mockState.event = payoutEvent('evt_po_failed', 'payout.failed', {
      id: 'po_1',
      status: 'failed',
      failure_code: 'account_closed',
      failure_message: 'The bank account has been closed.',
    })

    const { status } = await postWebhook()
    expect(status).toBe(200)

    const row = mockFake.get('payout_releases', 'evt1_20261001')!
    expect(row.status).toBe('failed')
    expect(row.stripeFailed).toBe(true)
    expect(row.failureCode).toBe('account_closed')
    expect(row.reReleaseEligible).toBe(true)

    const summary = summarizeEventReleases(mockFake.all('payout_releases').map(([, d]) => d))
    expect(summary.releasedMinor).toBe(0)
    expect(releaseAttemptDocId('evt1', '20261001', summary.stripeFailureCount)).toBe('evt1_20261001_r1')

    expect(createNotification).toHaveBeenCalledTimes(1)
    expect(createNotification.mock.calls[0][0]).toBe('org1')
    expect(createNotification.mock.calls[0][2]).toMatch(/virement/i)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'org@example.com' }))
    expect(mockFake.get('webhook_events', 'stripe__evt_po_failed')!.status).toBe('completed')
  })

  it('is idempotent: a redelivered or re-sent failure notifies once', async () => {
    seedRelease('evt1_20261001', { payoutId: 'po_1' })
    mockFake.seed('users', 'org1', { email: 'org@example.com' })
    mockState.event = payoutEvent('evt_dup', 'payout.failed', { id: 'po_1', status: 'failed' })
    await postWebhook()
    const second = await postWebhook()
    expect(second.json.idempotent).toBe(true)

    // A different event id for the same failure (Stripe can send both
    // payout.updated and payout.failed) still does not re-notify.
    mockState.event = payoutEvent('evt_dup_2', 'payout.updated', { id: 'po_1', status: 'failed' })
    await postWebhook()

    expect(createNotification).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('payout.paid after payout.failed never resurrects the payout', async () => {
    seedRelease('evt1_20261001', { payoutId: 'po_1' })
    mockState.event = payoutEvent('evt_f', 'payout.failed', { id: 'po_1', status: 'failed' })
    await postWebhook()
    mockState.event = payoutEvent('evt_p', 'payout.paid', { id: 'po_1', status: 'paid' })
    await postWebhook()
    expect(mockFake.get('payout_releases', 'evt1_20261001')!.status).toBe('failed')
  })

  it('payout.paid marks the release paid', async () => {
    seedRelease('evt1_20261001', { payoutId: 'po_1' })
    mockState.event = payoutEvent('evt_paid', 'payout.paid', { id: 'po_1', status: 'paid' })
    await postWebhook()
    expect(mockFake.get('payout_releases', 'evt1_20261001')!.status).toBe('paid')
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('finds a reservation by metadata when payoutId was not written yet', async () => {
    seedRelease('evt1_20261001', { status: 'reserved', payoutId: null })
    mockState.event = payoutEvent('evt_meta', 'payout.failed', {
      id: 'po_9',
      status: 'failed',
      metadata: { releaseDocId: 'evt1_20261001' },
    })
    await postWebhook()
    const row = mockFake.get('payout_releases', 'evt1_20261001')!
    expect(row.status).toBe('failed')
    expect(row.payoutId).toBe('po_9')
  })

  it('ignores a metadata match on a different connected account', async () => {
    seedRelease('evt1_20261001', { status: 'reserved', payoutId: null, stripeAccountId: 'acct_other' })
    mockState.event = payoutEvent('evt_x', 'payout.failed', { id: 'po_9', status: 'failed', metadata: { releaseDocId: 'evt1_20261001' } })
    await postWebhook()
    expect(mockFake.get('payout_releases', 'evt1_20261001')!.status).toBe('reserved')
  })

  it("ignores the platform's own payouts (no event.account)", async () => {
    seedRelease('evt1_20261001', { payoutId: 'po_1' })
    mockState.event = payoutEvent('evt_platform', 'payout.failed', { id: 'po_1', status: 'failed' }, null)
    const { json } = await postWebhook()
    expect(json.ignored).toBe(true)
    expect(mockFake.get('payout_releases', 'evt1_20261001')!.status).toBe('pending')
  })

  it('verifies against the Connect secret when the platform secret does not match', async () => {
    mockStripe.webhooks.constructEvent.mockImplementationOnce(() => {
      throw new Error('No signatures found matching the expected signature')
    })
    seedRelease('evt1_20261001', { payoutId: 'po_1' })
    mockState.event = payoutEvent('evt_sig', 'payout.paid', { id: 'po_1', status: 'paid' })
    const { status } = await postWebhook()
    expect(status).toBe(200)
    expect(mockStripe.webhooks.constructEvent.mock.calls.map((c: any[]) => c[2])).toEqual(['whsec_platform', 'whsec_connect'])
  })

  it('rejects a payload no configured secret signed', async () => {
    mockStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('bad sig')
    })
    const { status } = await postWebhook()
    expect(status).toBe(400)
    mockStripe.webhooks.constructEvent.mockImplementation(() => mockState.event)
  })

  it(`parks the event for an admin after ${MAX_STRIPE_PAYOUT_FAILURES} Stripe failures`, async () => {
    mockFake.seed('users', 'admin1', { role: 'admin' })
    seedRelease('evt1_a', { status: 'failed', stripeFailed: true, failedAt: '2026-10-01T00:00:00Z', payoutId: 'po_a' })
    seedRelease('evt1_b', { status: 'failed', stripeFailed: true, failedAt: '2026-10-02T00:00:00Z', payoutId: 'po_b' })
    seedRelease('evt1_c', { payoutId: 'po_c' })
    mockState.event = payoutEvent('evt_third', 'payout.failed', { id: 'po_c', status: 'failed', failure_code: 'no_account' })
    await postWebhook()

    const review = mockFake.get('payout_review_queue', 'evt1')!
    expect(review.status).toBe('pending')
    expect(review.reason).toBe('stripe_payout_failed_repeatedly')
    expect(review.payoutFailureCount).toBe(3)
    const adminCalls = createNotification.mock.calls.filter((c: any[]) => c[0] === 'admin1')
    expect(adminCalls).toHaveLength(1)
  })
})

describe('account.updated', () => {
  it("records requirements on the organizer's current profile", async () => {
    mockFake.seed('payoutProfiles', 'org1__stripe_connect', { stripeAccountId: 'acct_1' })
    mockState.event = {
      id: 'evt_acct',
      type: 'account.updated',
      account: 'acct_1',
      created: 1_760_000_100,
      data: {
        object: {
          id: 'acct_1',
          country: 'US',
          metadata: { organizerId: 'org1' },
          details_submitted: true,
          charges_enabled: true,
          payouts_enabled: false,
          requirements: { currently_due: ['external_account'], disabled_reason: 'requirements.past_due', past_due: ['external_account'] },
        },
      },
    }
    await postWebhook()
    const snap = profileDoc()!.stripeAccountStatus
    expect(snap).toEqual(
      expect.objectContaining({
        accountId: 'acct_1',
        payoutsEnabled: false,
        disabledReason: 'requirements.past_due',
        currentlyDue: ['external_account'],
        needsMoreInfo: true,
        state: 'requires_more_info',
      })
    )

    // An older event delivered late does not overwrite the newer snapshot.
    mockState.event = { ...mockState.event, id: 'evt_acct_old', created: 1_760_000_000, data: { object: { ...mockState.event.data.object, payouts_enabled: true, requirements: {} } } }
    await postWebhook()
    expect(profileDoc()!.stripeAccountStatus.payoutsEnabled).toBe(false)
  })

  it('does not write an archived account over the current one', async () => {
    mockFake.seed('payoutProfiles', 'org1__stripe_connect', { stripeAccountId: 'acct_new' })
    mockState.event = {
      id: 'evt_acct2',
      type: 'account.updated',
      account: 'acct_old',
      created: 1,
      data: { object: { id: 'acct_old', metadata: { organizerId: 'org1' } } },
    }
    await postWebhook()
    expect(profileDoc()!.stripeAccountStatus).toBeUndefined()
  })
})

describe('cron reconciliation of stuck payouts', () => {
  const now = new Date('2026-10-20T00:00:00.000Z')

  it('retrieves payouts pending > 10 days and applies the real status', async () => {
    seedRelease('old_pending', { payoutId: 'po_old', createdAt: '2026-10-01T00:00:00.000Z' })
    seedRelease('fresh_pending', { payoutId: 'po_new', createdAt: '2026-10-18T00:00:00.000Z' })
    mockStripe.payouts.retrieve.mockResolvedValueOnce({ id: 'po_old', status: 'failed', failure_code: 'could_not_process' })

    const summary = await reconcileStuckPayoutReleases(mockStripe, now)

    expect(mockStripe.payouts.retrieve).toHaveBeenCalledTimes(1)
    expect(mockStripe.payouts.retrieve).toHaveBeenCalledWith('po_old', { stripeAccount: 'acct_1' })
    expect(summary.newlyFailed).toBe(1)
    expect(mockFake.get('payout_releases', 'old_pending')!.status).toBe('failed')
    expect(mockFake.get('payout_releases', 'fresh_pending')!.status).toBe('pending')
  })

  it('flags a payout Stripe still reports in transit for an admin', async () => {
    seedRelease('stuck', { payoutId: 'po_s', status: 'in_transit', createdAt: '2026-10-01T00:00:00.000Z' })
    mockStripe.payouts.retrieve.mockResolvedValueOnce({ id: 'po_s', status: 'in_transit' })
    const summary = await reconcileStuckPayoutReleases(mockStripe, now)
    expect(summary.stillPending).toBe(1)
    expect(mockFake.get('payout_releases', 'stuck')!.needsAdminAttention).toBe(true)
  })

  it('a reservation Stripe never created is failed so it becomes releasable', async () => {
    seedRelease('evt1_20261015', { status: 'reserved', payoutId: null, createdAt: '2026-10-15T00:00:00.000Z' })
    mockStripe.payouts.list.mockResolvedValueOnce({ data: [{ id: 'po_other', metadata: { releaseDocId: 'something_else' } }], has_more: false })
    await reconcileStuckPayoutReleases(mockStripe, now)
    const row = mockFake.get('payout_releases', 'evt1_20261015')!
    expect(row.status).toBe('failed')
    expect(row.stripeFailed).toBeUndefined()
  })
})

describe('failure-cap flag respects admin decisions', () => {
  const { flagRepeatedPayoutFailures } = require('@/lib/stripe-payout-releases')
  const summary = { releasedMinor: 0, stripeFailureCount: 3, lastFailureAt: '2026-10-02T00:00:00.000Z', lastFailureCode: 'no_account' }

  it('re-opens an item resolved before the failures', async () => {
    mockFake.seed('payout_review_queue', 'evt1', { status: 'released', resolvedAt: '2026-10-01T00:00:00.000Z', reason: 'low_attendance' })
    await flagRepeatedPayoutFailures({ eventId: 'evt1', organizerId: 'org1', stripeAccountId: 'acct_1', summary })
    const row = mockFake.get('payout_review_queue', 'evt1')!
    expect(row.status).toBe('pending')
    expect(row.previousResolution).toEqual(expect.objectContaining({ status: 'released', reason: 'low_attendance' }))
  })

  it('leaves a hold an admin set after the failures alone', async () => {
    mockFake.seed('payout_review_queue', 'evt1', { status: 'held', resolvedAt: '2026-10-03T00:00:00.000Z' })
    await flagRepeatedPayoutFailures({ eventId: 'evt1', organizerId: 'org1', stripeAccountId: 'acct_1', summary })
    expect(mockFake.get('payout_review_queue', 'evt1')!.status).toBe('held')
  })
})
