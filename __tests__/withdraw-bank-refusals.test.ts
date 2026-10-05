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

const availabilityState: { current: Doc } = { current: {} }
const debitResult: { current: any } = { current: { success: true } }
const debitCalls: any[] = []
const flagged: string[] = []

// The route's balance comes from the ONE shared availability function.
jest.mock('@/lib/payouts/availability-server', () => ({
  loadEventAvailability: async () => availabilityState.current,
}))

jest.mock('@/lib/earnings', () => {
  const actual = jest.requireActual('@/lib/earnings')
  return {
    EARNINGS_CURRENCY_REVIEW_CODE: actual.EARNINGS_CURRENCY_REVIEW_CODE,
    EARNINGS_CURRENCY_REVIEW_MESSAGE: actual.EARNINGS_CURRENCY_REVIEW_MESSAGE,
    flagEarningsCurrencyReview: async (eventId: string) => {
      flagged.push(eventId)
    },
    withdrawFromEarnings: async (...args: any[]) => {
      debitCalls.push(args)
      return debitResult.current
    },
  }
})

import { POST } from '@/app/api/organizer/withdraw-bank/route'
import { EARNINGS_CURRENCY_REVIEW_CODE } from '@/lib/earnings'

const call = (amount = 200_000) =>
  POST({ json: async () => ({ eventId: 'evt1', amount, bankDestinationId: 'dest1' }) } as any)

beforeEach(() => {
  requests.clear()
  flagged.length = 0
  availabilityState.current = {
    eventId: 'evt1',
    currency: 'HTG',
    reason: 'eligible',
    balanceMinor: 500_000,
    ceilingMinor: 500_000,
    availableNowMinor: 500_000,
    gateInputs: { grossMinor: 555_556, refundedMinor: 0, availableMinor: 500_000 },
  }
  debitResult.current = { success: true }
  debitCalls.length = 0
})

describe('withdraw-bank refusals', () => {
  it('says "under review" for a currency-flagged earnings row, and creates no request', async () => {
    availabilityState.current = {
      ...availabilityState.current,
      reason: EARNINGS_CURRENCY_REVIEW_CODE,
      availableNowMinor: 0,
    }
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe(EARNINGS_CURRENCY_REVIEW_CODE)
    expect(body.error).not.toMatch(/insufficient/i)
    expect(flagged).toEqual(['evt1'])
    expect(requests.size).toBe(0)
  })

  it('writes NO request when the debit is refused (the request is filed inside the debit transaction)', async () => {
    debitResult.current = { success: false, error: 'Insufficient available balance' }
    const res = await call()
    expect(res.status).toBe(409)
    expect(requests.size).toBe(0)
    expect(debitCalls).toHaveLength(1)
  })

  it('still submits normally when the debit succeeds, debiting against the shared ceiling', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(debitCalls).toHaveLength(1)
    // The pending request is handed to the debit, to be written in its transaction.
    expect(debitCalls[0][3]).toMatchObject({
      ceilingMinor: 500_000,
      fileRequest: { data: expect.objectContaining({ status: 'pending', amount: 200_000, method: 'bank' }) },
    })
  })

  it('refuses above the shared balance before writing anything', async () => {
    const res = await call(500_001)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Insufficient balance. Available: 5000.00 HTG/)
    expect(requests.size).toBe(0)
    expect(debitCalls).toHaveLength(0)
  })
})
