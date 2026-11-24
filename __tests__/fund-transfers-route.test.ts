/**
 * /api/admin/fund-transfers and /api/admin/money-map: admin only; the ledger
 * is append-only and validated; an organizer wire is tied to a real bank
 * withdrawal of the same organizer, once. Firestore is an in-memory fake.
 *
 * @jest-environment node
 */

const mockAdmin = { user: null as any, error: null as string | null }
jest.mock('@/lib/auth', () => ({
  requireAdmin: jest.fn(async () => ({ user: mockAdmin.user, error: mockAdmin.error })),
}))
const mockAudit = jest.fn(async () => undefined)
jest.mock('@/lib/admin/audit-log', () => ({ logAdminAction: (...a: any[]) => (mockAudit as any)(...a) }))
const mockLoadMap = jest.fn(async () => ({ currencies: [] }))
const mockLoadTransfers = jest.fn(async () => [])
jest.mock('@/lib/payouts/money-map-server', () => ({
  loadMoneyMap: (...a: any[]) => (mockLoadMap as any)(...a),
  loadFundTransfers: (...a: any[]) => (mockLoadTransfers as any)(...a),
}))

const mockStore: Record<string, Record<string, any>> = {}
jest.mock('@/lib/firebase/admin', () => {
  let seq = 0
  const collection = (name: string) => {
    mockStore[name] = mockStore[name] || {}
    const filters: Array<[string, any]> = []
    const api: any = {
      doc: (id?: string) => {
        const docId = id || `auto${++seq}`
        return {
          id: docId,
          get: async () => ({ exists: docId in mockStore[name], data: () => mockStore[name][docId] }),
          set: async (data: any) => {
            mockStore[name][docId] = data
          },
          // Firestore create(): refuses an existing doc with ALREADY_EXISTS (6).
          create: async (data: any) => {
            if (docId in mockStore[name]) {
              const err: any = new Error('6 ALREADY_EXISTS: Document already exists')
              err.code = 6
              throw err
            }
            mockStore[name][docId] = data
          },
        }
      },
      where: (f: string, _op: string, v: any) => {
        filters.push([f, v])
        return api
      },
      limit: () => api,
      get: async () => {
        const docs = Object.entries(mockStore[name])
          .filter(([, d]) => filters.every(([f, v]) => d[f] === v))
          .map(([id, d]) => ({ id, data: () => d }))
        return { empty: docs.length === 0, docs, size: docs.length }
      },
    }
    return api
  }
  return { adminDb: { collection } }
})

const transfersRoute = require('@/app/api/admin/fund-transfers/route')
const mapRoute = require('@/app/api/admin/money-map/route')

const post = async (body: any) => {
  const res = await transfersRoute.POST(
    new Request('http://localhost/api/admin/fund-transfers', { method: 'POST', body: JSON.stringify(body) }) as any
  )
  return { status: res.status, data: await res.json() }
}

const movement = {
  kind: 'movement',
  fromAccount: 'stripe_platform',
  toAccount: 'bank',
  amount: 1250.5,
  currency: 'USD',
  reference: 'po_123',
  date: '2026-11-20',
}

const wire = {
  kind: 'organizer_payout',
  fromAccount: 'bank',
  toAccount: 'organizer',
  amount: 760,
  currency: 'USD',
  toCurrency: 'HTG',
  fxRate: 131.58,
  fee: 45,
  reference: 'FT26324XYZ',
  date: '2026-11-21',
  withdrawalId: 'w1',
}

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

beforeEach(() => {
  mockAdmin.user = { id: 'admin1', email: 'ops@tikem.co' }
  mockAdmin.error = null
  mockAudit.mockClear()
  for (const k of Object.keys(mockStore)) delete mockStore[k]
  mockStore.withdrawal_requests = {
    w1: { method: 'bank', status: 'pending', organizerId: 'org1', amount: 10_000_000, currency: 'HTG', eventId: 'evt1' },
    wm: { method: 'moncash', status: 'pending', organizerId: 'org1', amount: 500_000, currency: 'HTG' },
    wf: { method: 'bank', status: 'failed', organizerId: 'org1', amount: 500_000, currency: 'HTG' },
  }
})

describe('auth', () => {
  it('refuses a signed-out caller (401) and a non-admin (403), and writes nothing', async () => {
    mockAdmin.user = null
    mockAdmin.error = 'Not authenticated'
    expect((await post(movement)).status).toBe(401)
    mockAdmin.error = 'Admin access required'
    expect((await post(movement)).status).toBe(403)
    expect((await transfersRoute.GET()).status).toBe(403)
    const mapRes = await mapRoute.GET(new Request('http://localhost/api/admin/money-map') as any)
    expect(mapRes.status).toBe(403)
    expect(mockStore.fund_transfers).toBeUndefined()
    expect(mockLoadMap).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/fund-transfers', () => {
  it('records a movement in minor units with an audit entry', async () => {
    const { status, data } = await post(movement)
    expect(status).toBe(201)
    expect(data.transfer).toEqual(
      expect.objectContaining({
        kind: 'movement',
        fromAccount: 'stripe_platform',
        toAccount: 'bank',
        amountMinor: 125_050,
        toAmountMinor: 125_050,
        toCurrency: 'USD',
        fxRate: null,
        feeMinor: 0,
        createdBy: 'admin1',
      })
    )
    expect(Object.values(mockStore.fund_transfers)).toHaveLength(1)
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'money.fund_transfer.record', adminId: 'admin1' }))
  })

  it('converts with the rate when only the rate is given', async () => {
    const { data } = await post({ ...movement, toAccount: 'moncash_prefunded', toCurrency: 'HTG', fxRate: 131.58, amount: 100 })
    expect(data.transfer.toAmountMinor).toBe(1_315_800)
  })

  it('validates: bad date, same account, missing rate across currencies, payee misuse', async () => {
    expect((await post({ ...movement, date: '20/11/2026' })).status).toBe(400)
    expect((await post({ ...movement, toAccount: 'stripe_platform' })).status).toBe(400)
    expect((await post({ ...movement, toCurrency: 'HTG' })).status).toBe(400)
    expect((await post({ ...movement, toAccount: 'organizer' })).status).toBe(400)
    expect((await post({ ...movement, amount: -5 })).status).toBe(400)
    expect((await post({ ...movement, fromAccount: 'paypal' })).status).toBe(400)
    expect(mockStore.fund_transfers).toBeUndefined()
  })

  it('records an organizer wire against its bank withdrawal, with the fee and the HTG equivalent', async () => {
    const { status, data } = await post(wire)
    expect(status).toBe(201)
    expect(data.transfer).toEqual(
      expect.objectContaining({
        kind: 'organizer_payout',
        toAccount: 'organizer',
        amountMinor: 76_000,
        feeMinor: 4_500,
        toAmountMinor: 10_000_080,
        toCurrency: 'HTG',
        organizerId: 'org1',
        withdrawalId: 'w1',
        withdrawal: { amountMinor: 10_000_000, currency: 'HTG', status: 'pending', eventId: 'evt1' },
      })
    )
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'money.organizer_payout.record' }))
  })

  it('a movement cannot name a withdrawal or an organizer (it would take the payout slot)', async () => {
    const res = await post({ ...movement, withdrawalId: 'w1' })
    expect(res.status).toBe(400)
    expect(res.data.error).toMatch(/Only an organizer payout/)
    expect((await post({ ...movement, organizerId: 'org1' })).status).toBe(400)
    // The real wire still goes through.
    expect((await post(wire)).status).toBe(201)
  })

  it('a payout for a withdrawal has one deterministic doc, so two at once cannot both land', async () => {
    const [a, b] = await Promise.all([post(wire), post({ ...wire, reference: 'other' })])
    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect(Object.keys(mockStore.fund_transfers)).toEqual(['payout_w1'])
  })

  it('refuses a withdrawal id that is not a doc id', async () => {
    expect((await post({ ...wire, withdrawalId: 'a/b' })).status).toBe(400)
  })

  it('refuses a wire for a missing, non-bank, failed, other-organizer or already-paid withdrawal', async () => {
    expect((await post({ ...wire, withdrawalId: 'nope' })).status).toBe(404)
    expect((await post({ ...wire, withdrawalId: 'wm' })).status).toBe(409)
    expect((await post({ ...wire, withdrawalId: 'wf' })).status).toBe(409)
    expect((await post({ ...wire, organizerId: 'someone_else' })).status).toBe(409)
    expect((await post(wire)).status).toBe(201)
    const again = await post(wire)
    expect(again.status).toBe(409)
    expect(again.data.error).toMatch(/already recorded/)
  })

  it('an organizer wire must name the organizer or the withdrawal', async () => {
    const { withdrawalId: _w, ...noLink } = wire
    expect((await post(noLink)).status).toBe(400)
    expect((await post({ ...noLink, organizerId: 'org1' })).status).toBe(201)
  })
})

describe('GET /api/admin/money-map', () => {
  it('passes a valid range through and rejects a bad one', async () => {
    const ok = await mapRoute.GET(new Request('http://localhost/api/admin/money-map?from=2026-11-01&to=2026-11-30') as any)
    expect(ok.status).toBe(200)
    expect(mockLoadMap).toHaveBeenCalledWith({ from: '2026-11-01', to: '2026-11-30' })
    expect((await mapRoute.GET(new Request('http://localhost/api/admin/money-map?from=nov') as any)).status).toBe(400)
    expect(
      (await mapRoute.GET(new Request('http://localhost/api/admin/money-map?from=2026-12-01&to=2026-11-01') as any)).status
    ).toBe(400)
  })
})
