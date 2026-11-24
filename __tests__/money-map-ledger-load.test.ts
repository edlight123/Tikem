/**
 * The Money map reads the WHOLE fund_transfers ledger: a capped read would
 * leave old movements out and understate every balance. Paged, in order.
 *
 * @jest-environment node
 */

const mockDocs: Array<{ id: string; data: Record<string, any> }> = []
const mockQueries: Array<{ limit: number; after: string | null }> = []

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => {
      const make = (limit: number, after: string | null): any => ({
        orderBy: () => make(limit, after),
        limit: (n: number) => make(n, after),
        startAfter: (snap: any) => make(limit, snap.id),
        get: async () => {
          mockQueries.push({ limit, after })
          const sorted = mockDocs.slice().sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)) || a.id.localeCompare(b.id))
          const start = after ? sorted.findIndex((d) => d.id === after) + 1 : 0
          const page = sorted.slice(start, start + limit)
          return { docs: page.map((d) => ({ id: d.id, data: () => d.data })), size: page.length }
        },
      })
      return make(Infinity, null)
    },
  },
}))
jest.mock('@/lib/payouts/prefunding-plan-server', () => ({
  loadPlanEvents: jest.fn(),
  loadUnsentMoncashWithdrawals: jest.fn(),
  readPoolBalance: jest.fn(),
}))
jest.mock('@/lib/currency', () => ({ fetchUsdToHtgRate: jest.fn() }))

import { loadFundTransfers } from '@/lib/payouts/money-map-server'

describe('loadFundTransfers', () => {
  beforeEach(() => {
    mockDocs.length = 0
    mockQueries.length = 0
    for (let i = 0; i < 1203; i++) {
      const day = String(1 + (i % 28)).padStart(2, '0')
      mockDocs.push({
        id: `t${String(i).padStart(4, '0')}`,
        data: { kind: 'movement', fromAccount: 'stripe_platform', toAccount: 'bank', amountMinor: 100, currency: 'USD', date: `2026-11-${day}` },
      })
    }
  })

  it('reads every entry across pages, none twice', async () => {
    const all = await loadFundTransfers(500)
    expect(all).toHaveLength(1203)
    expect(new Set(all.map((t) => t.id)).size).toBe(1203)
    expect(mockQueries.map((q) => q.limit)).toEqual([500, 500, 500])
  })

  it('stops after a short page', async () => {
    mockDocs.length = 10
    expect(await loadFundTransfers(500)).toHaveLength(10)
    expect(mockQueries).toHaveLength(1)
  })
})
