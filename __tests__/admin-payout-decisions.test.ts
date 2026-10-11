/**
 * @jest-environment node
 *
 * Admin money decisions (2026-10):
 *  - M1: a dismissed payout review can be REOPENED (dismissed → pending), and
 *    a dismissed event's buyers can be refunded through the shared
 *    cancellation sweep (reason required, dismissed rows only).
 *  - M2: the organizer is told when a review is released or dismissed.
 *  - M3: a ban freezes payouts; an unban does not lift the freeze.
 *  - M5: approve/complete re-check identity, profile status, ban/freeze and the
 *    bank destination, and refuse with the reasons.
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))
jest.mock('@/lib/auth', () => ({
  requireAdmin: async () => ({ user: { id: 'admin1', email: 'a@tikem.co' }, error: null }),
}))
jest.mock('@/lib/admin/audit-log', () => ({ logAdminAction: async () => undefined }))

const cancelCalls: any[] = []
jest.mock('@/lib/events/cancel', () => ({
  cancelEventWithRefunds: async (args: any) => {
    cancelCalls.push(args)
    return {
      eventId: args.eventId,
      alreadyCancelled: false,
      ticketsAffected: 3,
      refundsSucceeded: 1,
      refundsQueuedManual: 0,
      refundsSentToReview: 2,
      refundsFailed: 0,
      freeTicketsVoided: 0,
      alreadyHandled: 0,
      notified: 3,
      failures: [],
    }
  },
}))
const reviewNotices: any[] = []
jest.mock('@/lib/payouts/review-notice', () => ({
  notifyPayoutReviewOutcome: async (...args: any[]) => {
    reviewNotices.push(args)
    return { sent: true }
  },
}))
const withdrawalNotices: any[] = []
jest.mock('@/lib/notifications/withdrawal-outcome', () => ({
  notifyWithdrawalOutcome: async (...args: any[]) => {
    withdrawalNotices.push(args)
    return { sent: true }
  },
}))
jest.mock('@/lib/moncash', () => ({ moncashPrefundedTransactionStatus: async () => ({ raw: {} }) }))

const identity: Record<string, string> = {}
jest.mock('@/lib/firestore/payout', () => ({
  getOrganizerIdentityVerificationStatus: async (uid: string) => identity[uid] || 'pending',
  reviewWithdrawalDestination: async () => 'not_applicable',
}))
const profiles: Record<string, any> = {}
jest.mock('@/lib/firestore/payout-profiles', () => ({ getPayoutProfile: async (uid: string) => profiles[uid] ?? null }))
const bankDest: { current: any } = { current: null }
jest.mock('@/lib/firestore/payout-destinations', () => ({ getDecryptedBankDestination: async () => bankDest.current }))

import { POST as reviewPOST } from '@/app/api/admin/payouts/review/[eventId]/route'
import { POST as organizerAction } from '@/app/api/admin/organizer-actions/route'
import { POST as withdrawalAction } from '@/app/api/admin/withdrawals/[id]/route'

const req = (body: any) => ({ json: async () => body }) as any
const review = (eventId: string, body: any) => reviewPOST(req(body), { params: Promise.resolve({ eventId }) })

beforeEach(() => {
  db.store.clear()
  cancelCalls.length = 0
  reviewNotices.length = 0
  withdrawalNotices.length = 0
  for (const k of Object.keys(identity)) delete identity[k]
  for (const k of Object.keys(profiles)) delete profiles[k]
  bankDest.current = null
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('payout review decisions', () => {
  beforeEach(() => {
    db.write('payout_review_queue/evt1', { eventId: 'evt1', organizerId: 'org1', status: 'pending', amountMinor: 1000 })
  })

  it('release / dismiss notify the organizer (M2)', async () => {
    expect((await review('evt1', { action: 'dismiss' })).status).toBe(200)
    expect(reviewNotices).toHaveLength(1)
    expect(reviewNotices[0][0]).toMatchObject({ eventId: 'evt1', organizerId: 'org1' })
    expect(reviewNotices[0][1]).toBe('dismissed')
  })

  it('reopen moves dismissed back to pending, and only a dismissed row (M1)', async () => {
    expect((await review('evt1', { action: 'reopen' })).status).toBe(200) // pending already: idempotent
    await review('evt1', { action: 'dismiss' })
    const res = await review('evt1', { action: 'reopen', note: 'new evidence' })
    expect(res.status).toBe(200)
    expect(db.store.get('payout_review_queue/evt1')).toMatchObject({
      status: 'pending',
      reopenedBy: 'admin1',
      previousResolution: expect.objectContaining({ status: 'dismissed' }),
    })
    await review('evt1', { action: 'release' })
    expect((await review('evt1', { action: 'reopen' })).status).toBe(409) // a released row may have paid
  })

  it('refund_buyers needs a dismissed row and a reason, then runs the cancellation sweep (M1)', async () => {
    expect((await review('evt1', { action: 'refund_buyers', note: 'fraud' })).status).toBe(409) // still pending
    await review('evt1', { action: 'dismiss' })
    expect((await review('evt1', { action: 'refund_buyers' })).status).toBe(400) // no reason
    const res = await review('evt1', { action: 'refund_buyers', note: 'Event did not happen' })
    expect(res.status).toBe(200)
    expect(cancelCalls).toEqual([
      expect.objectContaining({ eventId: 'evt1', reason: 'Event did not happen', actor: expect.objectContaining({ isAdmin: true }) }),
    ])
    expect(db.store.get('payout_review_queue/evt1')).toMatchObject({
      status: 'dismissed',
      buyerRefund: expect.objectContaining({ refundsSentToReview: 2, reason: 'Event did not happen' }),
    })
    expect(reviewNotices.map((n) => n[1])).toEqual(['dismissed', 'refunding_buyers'])
  })
})

describe('ban freezes payouts (M3)', () => {
  beforeEach(() => db.write('users/org1', { email: 'o@x.co', status: 'active' }))

  it('ban sets organizers.payoutsFrozen + highRisk; unban leaves the freeze; unfreeze lifts it', async () => {
    db.write('organizers/org1', { payoutRelease: { highRisk: false } })
    expect((await organizerAction(req({ organizerId: 'org1', action: 'ban' }))).status).toBe(200)
    expect(db.store.get('organizers/org1')).toMatchObject({ payoutsFrozen: true, payoutsFrozenReason: 'organizer_banned' })
    expect(db.store.get('organizers/org1')?.payoutRelease).toMatchObject({ highRisk: true })

    await organizerAction(req({ organizerId: 'org1', action: 'unban' }))
    expect(db.store.get('users/org1')?.status).toBe('active')
    expect(db.store.get('organizers/org1')?.payoutsFrozen).toBe(true)

    await organizerAction(req({ organizerId: 'org1', action: 'unfreeze_payouts' }))
    expect(db.store.get('organizers/org1')).toMatchObject({ payoutsFrozen: false })
    expect(db.store.get('organizers/org1')?.payoutRelease).toMatchObject({ highRisk: false })
  })
})

describe('admin approve/complete re-checks (M5)', () => {
  const withdrawal = (over: any = {}) =>
    db.write('withdrawal_requests/w1', {
      organizerId: 'org1',
      eventId: 'evt1',
      method: 'bank',
      status: 'pending',
      amount: 100_000,
      currency: 'HTG',
      bankDestinationId: 'dest1',
      bankDetails: { accountNumber: '****6789', accountHolder: 'Marie Joseph', bankName: 'Unibank' },
      ...over,
    })
  const act = (action: string, extra: any = {}) => withdrawalAction(req({ withdrawalId: 'w1', action, ...extra }))

  beforeEach(() => {
    identity.org1 = 'verified'
    profiles.org1 = { status: 'active', verificationStatus: { identity: 'verified' } }
    bankDest.current = { accountNumber: '000123456789', accountHolder: 'Marie Joseph', bankName: 'Unibank' }
    db.write('events/evt1', { organizer_id: 'org1', status: 'published' })
    db.write('verification_requests/org1', { status: 'approved', steps: { organizerInfo: { fields: { full_name: 'Marie Joseph' } } } })
    withdrawal()
  })

  it('approves when everything still holds', async () => {
    const res = await act('approve')
    expect(res.status).toBe(200)
    expect(db.store.get('withdrawal_requests/w1')?.status).toBe('processing')
  })

  it.each([
    ['identity revoked', () => (identity.org1 = 'failed'), 'identity_not_verified'],
    ['profile on hold', () => (profiles.org1 = { status: 'on_hold', payoutHoldUntil: '2030-01-01T00:00:00Z' }), 'payout_profile_inactive'],
    ['banned', () => db.write('users/org1', { status: 'banned' }), 'payouts_frozen'],
    ['bank account changed', () => (bankDest.current = { ...bankDest.current, accountNumber: '0000111' }), 'bank_account_changed'],
    ['holder not the KYC name', () => (bankDest.current = { ...bankDest.current, accountHolder: 'Paul Joseph' }), 'bank_holder_mismatch'],
    ['bank proof rejected', () => db.write('organizers/org1/verificationDocuments/bank_dest1', { status: 'failed' }), 'bank_proof_rejected'],
    ['event cancelled', () => db.write('events/evt1', { status: 'cancelled' }), 'event_payouts_frozen'],
  ])('refuses approve when %s', async (_label, setup, code) => {
    setup()
    const res = await act('approve')
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe('approval_blocked')
    expect(body.blockers.map((b: any) => b.code)).toContain(code)
    expect(db.store.get('withdrawal_requests/w1')?.status).toBe('pending')
    expect(withdrawalNotices).toHaveLength(0)
  })

  it('complete re-checks too, but an admin who already paid by hand can acknowledge with a note', async () => {
    withdrawal({ status: 'processing' })
    identity.org1 = 'pending'
    expect((await act('complete')).status).toBe(409)
    expect((await act('complete', { acknowledgeBlockers: true })).status).toBe(409) // a note is required
    const res = await act('complete', { acknowledgeBlockers: true, internalNote: 'Paid by hand on 10/09' })
    expect(res.status).toBe(200)
    expect(db.store.get('withdrawal_requests/w1')?.status).toBe('completed')
  })

  it('reject is never blocked (it returns the money)', async () => {
    db.write('users/org1', { status: 'banned' })
    const res = await act('reject', { payeeReasonCode: 'other', payeeReasonText: 'Account under review' })
    expect(res.status).toBe(200)
  })
})
