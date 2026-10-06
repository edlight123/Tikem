/**
 * @jest-environment node
 *
 * Payout-destination and step-up guards:
 *  - MonCash destinations compare on the FULL number (fingerprint), never last 4
 *  - bank account-holder name matching
 *  - the payout step-up code is wiped after 5 wrong guesses
 *  - a refund claim bumps the ledger counter a withdrawal debit re-checks
 */

type Doc = Record<string, any>
const store: Record<string, Doc | undefined> = {}
const rateLimited = { current: false }

jest.mock('@/lib/firebase/admin', () => {
  const ref = (path: string): any => ({
    path,
    get: async () => ({ exists: store[path] !== undefined, data: () => store[path] }),
    set: async (data: Doc, opts?: any) => {
      store[path] = opts?.merge ? { ...(store[path] || {}), ...data } : data
    },
    collection: (sub: string) => ({ doc: (id: string) => ref(`${path}/${sub}/${id}`) }),
  })
  return {
    adminDb: {
      collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
      runTransaction: async (fn: any) => {
        const writes: Array<() => void> = []
        const tx = {
          get: (r: any) => r.get(),
          set: (r: any, data: Doc, opts?: any) => writes.push(() => void r.set(data, opts)),
          update: (r: any, data: Doc) => writes.push(() => void r.set(data, { merge: true })),
        }
        const out = await fn(tx)
        writes.forEach((w) => w())
        return out
      },
    },
    adminAuth: { verifySessionCookie: async () => ({ uid: 'org1' }) },
  }
})
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'session' }) }) }))
jest.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: async () => ({ limited: rateLimited.current }),
  clientIp: () => '1.2.3.4',
}))
jest.mock('@/lib/moncash', () => ({}))

import crypto from 'crypto'
import {
  checkMobileMoneyDestination,
  mobileMoneyFingerprint,
  sameAccountHolderName,
  updatePayoutProfileConfig,
} from '@/lib/firestore/payout'
import { bumpRefundClaimVersionInTransaction, refundClaimVersionOf } from '@/lib/earnings'
import { POST as verifyCode } from '@/app/api/organizer/payout-details-change/verify-email-code/route'

describe('mobile-money destination binding', () => {
  const saved = { mobileMoneyDetails: { phoneNumberFingerprint: mobileMoneyFingerprint('+509 3700 7294'), phoneNumberLast4: '7294' } } as any

  it('matches the saved number in any format', () => {
    expect(checkMobileMoneyDestination(saved, '3700 7294')).toMatchObject({ ok: true, via: 'profile' })
    expect(checkMobileMoneyDestination(saved, '50937007294')).toMatchObject({ ok: true, via: 'profile' })
  })

  it('refuses a different wallet even when its last 4 digits are the same', () => {
    expect(checkMobileMoneyDestination(saved, '3811 7294')).toMatchObject({ ok: false, code: 'PAYOUT_DESTINATION_MISMATCH' })
  })

  it('a legacy profile (no fingerprint) only passes on last 4, flagged for the step-up', () => {
    const legacy = { mobileMoneyDetails: { phoneNumberLast4: '7294' } } as any
    expect(checkMobileMoneyDestination(legacy, '3700 7294')).toMatchObject({ ok: true, via: 'legacy_last4' })
    expect(checkMobileMoneyDestination(legacy, '3700 1111')).toMatchObject({ ok: false })
    expect(checkMobileMoneyDestination({} as any, '3700 7294')).toMatchObject({ ok: false })
  })
})

describe('sameAccountHolderName', () => {
  it('ignores case, accents, punctuation and word order', () => {
    expect(sameAccountHolderName('Jean-Pierre Étienne', 'etienne jean pierre')).toBe(true)
  })
  it('tolerates a middle name on one side only', () => {
    expect(sameAccountHolderName('Marie Claire Joseph', 'Marie Joseph')).toBe(true)
  })
  it('refuses a different person and empty names', () => {
    expect(sameAccountHolderName('Marie Joseph', 'Paul Joseph')).toBe(false)
    expect(sameAccountHolderName('', 'Paul Joseph')).toBe(false)
    expect(sameAccountHolderName('Joseph', 'Marie Joseph')).toBe(false)
  })
})

describe('refund-claim counter', () => {
  it('a claim bumps the counter on the ledger row it read', () => {
    const updates: any[] = []
    const tx = { update: (ref: any, data: any) => updates.push([ref, data]) }
    bumpRefundClaimVersionInTransaction(tx, { ref: 'row', data: { refundClaimVersion: 2 } })
    expect(updates).toHaveLength(1)
    expect(updates[0][1].refundClaimVersion).toBe(3)
    expect(refundClaimVersionOf({})).toBe(0)
  })
})

describe('payout step-up code', () => {
  const PATH = 'organizers/org1/security/payoutDetailsChangeVerification'
  const hash = (salt: string, code: string) => crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex')
  const call = (code: string) => verifyCode({ json: async () => ({ code }), headers: { get: () => null } } as any)

  beforeEach(() => {
    rateLimited.current = false
    store[PATH] = {
      salt: 's1',
      codeHash: hash('s1', '123456'),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }
  })

  it('accepts the right code', async () => {
    const res = await call('123456')
    expect(res.status).toBe(200)
    expect(store[PATH]?.verifiedUntil).toBeTruthy()
  })

  it('wipes the code after 5 wrong guesses, so the right one no longer works', async () => {
    for (let i = 0; i < 4; i++) expect((await call('000000')).status).toBe(400)
    const fifth = await call('000000')
    expect((await fifth.json()).error).toMatch(/new code/i)
    expect(store[PATH]?.codeHash).toBeNull()
    expect((await call('123456')).status).toBe(400)
    expect(store[PATH]?.verifiedUntil).toBeFalsy()
  })

  it('is rate limited per account and IP', async () => {
    rateLimited.current = true
    expect((await call('123456')).status).toBe(429)
  })
})

describe('payout profile change step-up (resolved profile)', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
  })

  it('a destination living only in legacy payoutConfig/main still makes a profile change sensitive', async () => {
    store['organizers/org1/payoutConfig/main'] = {
      method: 'mobile_money',
      mobileMoneyDetails: { provider: 'moncash', phoneNumber: '****7294', phoneNumberLast4: '7294' },
    }
    const res = await updatePayoutProfileConfig('org1', 'haiti', {
      method: 'mobile_money',
      mobileMoneyDetails: { provider: 'moncash', phoneNumber: '38112233', accountName: 'X' },
    } as any)
    expect(res).toMatchObject({ success: false })
    expect(String(res.error)).toContain('PAYOUT_CHANGE_VERIFICATION_REQUIRED')
    expect(store['organizers/org1/payoutProfiles/haiti']).toBeUndefined()
  })

  it('a first-time setup stores the server-computed fingerprint, never a client-sent one', async () => {
    const res = await updatePayoutProfileConfig('org1', 'haiti', {
      method: 'mobile_money',
      mobileMoneyDetails: { provider: 'moncash', phoneNumber: '+509 3700 7294', accountName: 'X', phoneNumberFingerprint: 'forged' },
    } as any)
    expect(res.success).toBe(true)
    const mm = store['organizers/org1/payoutProfiles/haiti']?.mobileMoneyDetails
    expect(mm.phoneNumberFingerprint).toBe(mobileMoneyFingerprint('37007294'))
    expect(mm.phoneNumber).not.toContain('3700')
  })
})
