/**
 * @jest-environment node
 *
 * Promoter money guards:
 *  - an event's organizer cannot claim (and so cash out) its own promoter link
 *  - a withdrawal needs identity (own SMS-verified phone = the wallet, or KYC),
 *    pays only the SAVED number, and a new number is saved behind the email
 *    step-up with a 24h hold
 *  - a negative (reversed-after-withdrawal) balance blocks withdrawals
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
const authUsers: Record<string, any> = {}
const stepUp = { verified: false }
const kyc: Record<string, string> = {}

jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
  adminAuth: {
    getUser: async (uid: string) => {
      if (!authUsers[uid]) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' })
      return authUsers[uid]
    },
  },
}))
const session = { uid: 'promoter1' }
jest.mock('@/lib/auth', () => ({ getCurrentUser: async () => ({ id: session.uid }) }))
jest.mock('@/lib/firestore/payout', () => ({
  ...jest.requireActual('@/lib/firestore/payout'),
  requireRecentPayoutDetailsChangeVerification: async () => {
    if (!stepUp.verified) throw new Error('PAYOUT_CHANGE_VERIFICATION_REQUIRED')
  },
  consumePayoutDetailsChangeVerification: async () => {
    stepUp.verified = false
  },
  getOrganizerIdentityVerificationStatus: async (uid: string) => kyc[uid] || 'pending',
}))
jest.mock('@/lib/payouts/availability-server', () => ({
  loadEventAvailability: async () => ({ reason: 'eligible', releasedNow: true, availableAt: null, refundRequestedMinor: 0, refundInFlightMinor: 0 }),
}))
jest.mock('@/lib/payouts/withdrawal-gate', () => ({ previewRelease: async () => null }))
jest.mock('@/lib/promoters', () => ({
  ...jest.requireActual('@/lib/promoters'),
  excludeStripeConnectSales: async (rows: any[]) => rows,
}))
jest.mock('@/lib/notifications/withdrawal-outcome', () => ({ notifyWithdrawalOutcome: async () => undefined }))
jest.mock('@/lib/moncash', () => ({}))
jest.mock('@/lib/currency', () => ({ fetchUsdToHtgRate: async () => 130 }))

import { POST as claim } from '@/app/api/promoter/claim/route'
import { executePromoterWithdrawal } from '@/lib/promoter-wallet'
import { promoterTokenFor } from '@/lib/promoters'

function seed() {
  db.store.clear()
  for (const k of Object.keys(authUsers)) delete authUsers[k]
  for (const k of Object.keys(kyc)) delete kyc[k]
  stepUp.verified = false
  session.uid = 'promoter1'
  db.write('events/ev1', { organizer_id: 'org1', title: 'Konpa' })
  db.write('event_promoters/p1', { event_id: 'ev1', organizer_id: 'org1', code: 'STREET', stats_key: 'sk1', claimed_by_uid: 'promoter1' })
  db.write('promoter_sales/s1', { promoter_id: 'p1', event_id: 'ev1', funded: true, status: 'accrued', commission_cents: 80_000, currency: 'HTG' })
  db.write('config/payouts', { prefunding: { enabled: false } })
  authUsers.promoter1 = { uid: 'promoter1', phoneNumber: '+50937007294' }
  authUsers.org1 = { uid: 'org1', email: 'org@example.com', emailVerified: true }
}

beforeEach(seed)

const SK2 = 'ab'.repeat(24)

describe('promoter claim', () => {
  const call = () => claim(new Request('http://x/api/promoter/claim', { method: 'POST', body: JSON.stringify({ token: promoterTokenFor(SK2) }) }))

  beforeEach(() => {
    db.write('event_promoters/p2', { event_id: 'ev1', organizer_id: 'org1', code: 'SELF', stats_key: SK2 })
  })

  it("refuses the event's organizer", async () => {
    session.uid = 'org1'
    const res = await call()
    expect(res.status).toBe(403)
    expect(db.store.get('event_promoters/p2')?.claimed_by_uid).toBeUndefined()
  })

  it('refuses another account with the organizer\'s verified email', async () => {
    session.uid = 'alt'
    authUsers.alt = { uid: 'alt', email: 'ORG@example.com', emailVerified: true }
    expect((await call()).status).toBe(403)
  })

  it('lets anyone else claim it', async () => {
    session.uid = 'promoter2'
    authUsers.promoter2 = { uid: 'promoter2', email: 'p2@example.com', emailVerified: true }
    expect((await call()).status).toBe(200)
    expect(db.store.get('event_promoters/p2')?.claimed_by_uid).toBe('promoter2')
  })
})

describe('promoter withdrawal', () => {
  it('needs identity: the wallet must be the account\'s verified phone, or KYC', async () => {
    const r = await executePromoterWithdrawal('promoter1', '3811 2233')
    expect(r).toMatchObject({ ok: false, code: 'identity_required' })
    kyc.promoter1 = 'verified'
    stepUp.verified = true
    const saved = await executePromoterWithdrawal('promoter1', '3811 2233')
    expect(saved).toMatchObject({ ok: false, code: 'destination_on_hold' })
  })

  it('a first/new number is saved (no email code needed for the own verified phone) and held 24h', async () => {
    const first = await executePromoterWithdrawal('promoter1', '+509 3700 7294')
    expect(first).toMatchObject({ ok: false, code: 'destination_on_hold' })
    expect(db.store.get('promoter_wallets/promoter1')).toMatchObject({ moncash_phone: '50937007294', moncash_phone_verified_via: 'auth_phone' })
    expect(db.docsIn('withdrawal_requests')).toHaveLength(0)

    // Still held.
    expect(await executePromoterWithdrawal('promoter1', '37007294')).toMatchObject({ code: 'destination_on_hold' })

    // Hold over: paid to the saved number.
    db.write('promoter_wallets/promoter1', { moncash_phone_hold_until: new Date(Date.now() - 1000).toISOString() }, { merge: true })
    const paid = await executePromoterWithdrawal('promoter1', '37007294')
    expect(paid).toMatchObject({ ok: true, instant: false })
    const [[, row]] = db.docsIn('withdrawal_requests')
    expect(row).toMatchObject({ moncashNumber: '50937007294', payee_type: 'promoter' })
  })

  it('a different number than the saved one needs the email code and restarts the hold', async () => {
    kyc.promoter1 = 'verified'
    db.write('promoter_wallets/promoter1', {
      moncash_phone: '50937007294',
      moncash_phone_fingerprint: jest.requireActual('@/lib/firestore/payout').mobileMoneyFingerprint('50937007294'),
      moncash_phone_hold_until: new Date(Date.now() - 1000).toISOString(),
    })
    expect(await executePromoterWithdrawal('promoter1', '3811 2233')).toMatchObject({ code: 'verification_required' })
    stepUp.verified = true
    expect(await executePromoterWithdrawal('promoter1', '3811 2233')).toMatchObject({ code: 'destination_on_hold' })
    expect(db.docsIn('withdrawal_requests')).toHaveLength(0)
  })

  it('a balance made negative by reversals after a withdrawal blocks withdrawals', async () => {
    db.write('promoter_wallets/promoter1', {
      moncash_phone: '50937007294',
      moncash_phone_fingerprint: jest.requireActual('@/lib/firestore/payout').mobileMoneyFingerprint('50937007294'),
      moncash_phone_hold_until: new Date(Date.now() - 1000).toISOString(),
      withdrawn_by_currency: { HTG: 120_000 },
    })
    expect(await executePromoterWithdrawal('promoter1', '37007294')).toMatchObject({ ok: false, code: 'balance_negative' })
  })

  it("an organizer's commission on their own event is never withdrawable", async () => {
    db.write('event_promoters/p1', { claimed_by_uid: 'org1' }, { merge: true })
    authUsers.org1.phoneNumber = '+50937007294'
    db.write('promoter_wallets/org1', {
      moncash_phone: '50937007294',
      moncash_phone_fingerprint: jest.requireActual('@/lib/firestore/payout').mobileMoneyFingerprint('50937007294'),
      moncash_phone_hold_until: new Date(Date.now() - 1000).toISOString(),
    })
    expect(await executePromoterWithdrawal('org1', '37007294')).toMatchObject({ ok: false, code: 'nothing_available' })
  })
})
