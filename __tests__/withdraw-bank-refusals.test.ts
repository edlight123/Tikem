/**
 * @jest-environment node
 *
 * The bank withdrawal route must never leave a pending request behind when the
 * balance debit is refused, and must say "under review" (not "insufficient
 * balance") for an earnings row flagged for the currency review.
 */

type Doc = Record<string, any>
const requests = new Map<string, Doc>()
let nextId = 1

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () =>
          name === 'events'
            ? { exists: true, data: () => ({ organizer_id: 'org1', country: 'HT', currency: 'HTG', status: 'published' }) }
            : { exists: false, data: () => undefined },
      }),
      add: async (data: Doc) => {
        const id = `wr${nextId++}`
        requests.set(id, { ...data })
        return {
          id,
          update: async (patch: Doc) => {
            requests.set(id, { ...requests.get(id), ...patch })
          },
        }
      },
    }),
  },
}))

jest.mock('@/lib/auth', () => ({ requireAuth: async () => ({ user: { id: 'org1' }, error: null }) }))
jest.mock('@/lib/firestore/payout-profiles', () => ({
  getPayoutProfile: async () => ({ status: 'active', method: 'bank_transfer' }),
  getRequiredPayoutProfileIdForEventCountry: () => 'haiti',
}))
jest.mock('@/lib/payouts/withdrawal-gate', () => ({ gateHaitiWithdrawal: async () => ({ allowed: true }) }))
jest.mock('@/lib/firestore/payout-destinations', () => ({
  addSecondaryBankDestination: jest.fn(),
  getDecryptedBankDestination: async () => ({ accountNumber: '123', bankName: 'Unibank', accountHolder: 'Org One' }),
}))
jest.mock('@/lib/firestore/payout', () => ({
  requireRecentPayoutDetailsChangeVerification: jest.fn(),
  consumePayoutDetailsChangeVerification: jest.fn(),
}))

const earningsState: { current: Doc } = { current: {} }
const debitResult: { current: any } = { current: { success: true } }
const flagged: string[] = []

jest.mock('@/lib/earnings', () => {
  const actual = jest.requireActual('@/lib/earnings')
  return {
    EARNINGS_CURRENCY_REVIEW_CODE: actual.EARNINGS_CURRENCY_REVIEW_CODE,
    EARNINGS_CURRENCY_REVIEW_MESSAGE: actual.EARNINGS_CURRENCY_REVIEW_MESSAGE,
    flagEarningsCurrencyReview: async (eventId: string) => {
      flagged.push(eventId)
    },
    getEventEarnings: async () => earningsState.current,
    withdrawFromEarnings: async () => debitResult.current,
  }
})

import { POST } from '@/app/api/organizer/withdraw-bank/route'
import { EARNINGS_CURRENCY_REVIEW_CODE } from '@/lib/earnings'

const call = (amount = 200_000) =>
  POST({ json: async () => ({ eventId: 'evt1', amount, bankDestinationId: 'dest1' }) } as any)

beforeEach(() => {
  requests.clear()
  flagged.length = 0
  earningsState.current = { settlementStatus: 'ready', availableToWithdraw: 500_000, currency: 'HTG' }
  debitResult.current = { success: true }
})

describe('withdraw-bank refusals', () => {
  it('says "under review" for a currency-flagged earnings row, and creates no request', async () => {
    earningsState.current = {
      settlementStatus: 'ready',
      availableToWithdraw: 0,
      currency: 'HTG',
      withdrawalBlocked: { code: EARNINGS_CURRENCY_REVIEW_CODE },
    }
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe(EARNINGS_CURRENCY_REVIEW_CODE)
    expect(body.error).not.toMatch(/insufficient/i)
    expect(flagged).toEqual(['evt1'])
    expect(requests.size).toBe(0)
  })

  it('marks the request failed (never pending) when the debit is refused', async () => {
    debitResult.current = { success: false, error: 'Insufficient available balance' }
    const res = await call()
    expect(res.status).toBe(409)
    const rows = Array.from(requests.values())
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('failed')
  })

  it('still submits normally when the debit succeeds', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(Array.from(requests.values())[0].status).not.toBe('failed')
  })
})
