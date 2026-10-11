/**
 * @jest-environment node
 *
 * Bank rail hardening (2026-10):
 *  - H3: a new bank destination is created ON HOLD; its holder must EXACTLY
 *    match the KYC-verified legal name (not a substring of users.full_name);
 *    a holder mismatch on a saved destination BLOCKS the withdrawal.
 *  - L6: a destination whose bank proof was rejected is not withdrawable.
 *  - M3: a banned organizer withdraws nothing.
 *  - L4: the real inactive reason.
 *  - L5: a bank withdrawal sends the "request received" notice.
 *  - M9: the debit nets organizer debt.
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))
jest.mock('@/lib/auth', () => ({ requireAuth: async () => ({ user: { id: 'org1' }, error: null }) }))

const profileState: { current: any } = { current: null }
jest.mock('@/lib/firestore/payout-profiles', () => ({
  getPayoutProfile: async () => profileState.current,
  getRequiredPayoutProfileIdForEventCountry: () => 'haiti',
}))
jest.mock('@/lib/payouts/withdrawal-gate', () => ({ gateHaitiWithdrawal: async () => ({ allowed: true }) }))
jest.mock('@/lib/payouts/availability-server', () => ({
  loadEventAvailability: async () => ({
    eventId: 'evt1',
    currency: 'HTG',
    reason: 'eligible',
    balanceMinor: 500_000,
    ceilingMinor: 500_000,
    availableNowMinor: 500_000,
    gateInputs: { grossMinor: 555_556, refundedMinor: 0, availableMinor: 500_000 },
  }),
}))
const debitCalls: any[] = []
jest.mock('@/lib/earnings', () => {
  const actual = jest.requireActual('@/lib/earnings')
  return {
    EARNINGS_CURRENCY_REVIEW_CODE: actual.EARNINGS_CURRENCY_REVIEW_CODE,
    EARNINGS_CURRENCY_REVIEW_MESSAGE: actual.EARNINGS_CURRENCY_REVIEW_MESSAGE,
    flagEarningsCurrencyReview: async () => undefined,
    readRefundClaimVersion: async () => 0,
    withdrawFromEarnings: async (...args: any[]) => {
      debitCalls.push(args)
      return { success: true }
    },
  }
})
jest.mock('@/lib/payouts/organizer-debt', () => ({ syncOrganizerDebt: async () => ({ failed: [] }) }))
const destination: { current: any } = { current: null }
jest.mock('@/lib/security/encryption', () => ({
  encryptJson: (v: any) => ({ v: 1, iv: 'iv', tag: 'tag', ciphertext: JSON.stringify(v) }),
  decryptJson: (e: any) => JSON.parse(e.ciphertext),
}))
jest.mock('@/lib/firestore/payout-destinations', () => ({
  ...jest.requireActual('@/lib/firestore/payout-destinations'),
  getDecryptedBankDestination: async () => destination.current,
}))
const stepUp = { verified: true }
jest.mock('@/lib/firestore/payout', () => ({
  ...jest.requireActual('@/lib/firestore/payout'),
  requireRecentPayoutDetailsChangeVerification: async () => {
    if (!stepUp.verified) throw new Error('PAYOUT_CHANGE_VERIFICATION_REQUIRED')
  },
  consumePayoutDetailsChangeVerification: async () => undefined,
}))
const notices: any[] = []
jest.mock('@/lib/notifications/withdrawal-outcome', () => ({
  notifyWithdrawalOutcome: async (...args: any[]) => {
    notices.push(args)
    return { sent: true }
  },
}))

import { POST as withdrawBank } from '@/app/api/organizer/withdraw-bank/route'
import { POST as addDestination } from '@/app/api/organizer/payout-destinations/bank/route'

const ACTIVE = {
  status: 'active',
  method: 'bank_transfer',
  bankDetails: { accountName: 'Marie Joseph' },
  verificationStatus: { identity: 'verified' },
}
const approvedKyc = (full_name = 'Marie Claire Joseph') =>
  db.write('verification_requests/org1', { status: 'approved', steps: { organizerInfo: { fields: { full_name } } } })

const call = (over: any = {}) =>
  withdrawBank({ json: async () => ({ eventId: 'evt1', amount: 200_000, bankDestinationId: 'dest1', ...over }) } as any)

beforeEach(() => {
  db.store.clear()
  debitCalls.length = 0
  notices.length = 0
  stepUp.verified = true
  profileState.current = { ...ACTIVE }
  destination.current = { accountNumber: '000123456789', bankName: 'Unibank', accountHolder: 'Joseph Marie Claire' }
  db.write('events/evt1', { organizer_id: 'org1', country: 'HT', currency: 'HTG', status: 'published' })
  db.write('organizers/org1/payoutDestinations/dest1', { type: 'bank' })
  approvedKyc()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('withdraw-bank', () => {
  it('pays a saved destination whose holder exactly matches the KYC name; notifies; nets debt', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(debitCalls).toHaveLength(1)
    expect(debitCalls[0][3]).toMatchObject({ debt: { organizerId: 'org1', currency: 'HTG' } })
    expect(notices).toHaveLength(1)
    expect(notices[0][1]).toBe('submitted')
    expect(notices[0][2].row).toMatchObject({ method: 'bank', amount: 200_000 })
  })

  it('BLOCKS a saved destination whose holder does not exactly match (no more review flag only)', async () => {
    destination.current = { ...destination.current, accountHolder: 'Marie Joseph' } // middle name missing
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PAYOUT_HOLDER_NAME_MISMATCH')
    expect(debitCalls).toHaveLength(0)
  })

  it('refuses a destination whose bank proof was rejected (L6)', async () => {
    db.write('organizers/org1/verificationDocuments/bank_dest1', { status: 'failed' })
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('BANK_PROOF_REJECTED')
    expect(debitCalls).toHaveLength(0)
  })

  it('refuses a banned organizer before anything else (M3)', async () => {
    db.write('users/org1', { status: 'banned' })
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('payouts_frozen')
    expect(debitCalls).toHaveLength(0)
  })

  it('says WHY the profile cannot withdraw (L4)', async () => {
    profileState.current = { ...ACTIVE, status: 'on_hold', payoutHoldUntil: '2030-01-01T00:00:00.000Z' }
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body).toMatchObject({ code: 'payout_on_hold', availableAt: '2030-01-01T00:00:00.000Z' })
    profileState.current = { ...ACTIVE, status: 'pending_verification', verificationStatus: { identity: 'pending' } }
    expect((await (await call()).json()).code).toBe('identity_pending')
  })

  it('a new account in the KYC name is saved ON HOLD and nothing is filed', async () => {
    const res = await call({
      bankDestinationId: undefined,
      bankDetails: { accountNumber: '999', bankName: 'Sogebank', accountHolder: 'marie claire joseph' },
    })
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe('PAYOUT_DESTINATION_ON_HOLD')
    const saved = db.store.get(`organizers/org1/payoutDestinations/${body.bankDestinationId}`)
    expect(Date.parse(saved?.holdUntil) - Date.now()).toBeGreaterThan(23 * 3_600_000)
    expect(debitCalls).toHaveLength(0)
  })
})

describe('POST /api/organizer/payout-destinations/bank (H3)', () => {
  const add = (accountHolder: string) =>
    addDestination({ json: async () => ({ bankDetails: { accountNumber: '4444', bankName: 'BNC', accountHolder } }) } as any)

  it('requires an approved identity verification', async () => {
    db.store.delete('verification_requests/org1')
    const res = await add('Marie Claire Joseph')
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('IDENTITY_REQUIRED')
  })

  it('refuses a holder that only partially matches the KYC legal name (the old substring rule passed it)', async () => {
    db.write('users/org1', { full_name: 'Marie' })
    const res = await add('Marie')
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('PAYOUT_HOLDER_NAME_MISMATCH')
  })

  it('creates an exact-match destination with a 24h hold', async () => {
    const res = await add('Joseph, Marie-Claire')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(Date.parse(body.holdUntil) - Date.now()).toBeGreaterThan(23 * 3_600_000)
    const saved = db.store.get(`organizers/org1/payoutDestinations/${body.destinationId}`)
    expect(saved).toMatchObject({ isPrimary: false, holdUntil: body.holdUntil })
  })
})
