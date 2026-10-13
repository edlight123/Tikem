/**
 * Seat-hold follow-ups: the client-immutable shard count (firestore.rules), the
 * MonCash 'confirming' status poll (/api/moncash-button/status) and NatCash in
 * the reconcile retry.
 *
 * @jest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mockOrders: Record<string, any> = {}
const mockRate = { limited: false }
const mockUser = { id: null as string | null }

jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))
jest.mock('@/lib/firebase-db/server', () => ({
  createClient: async () => ({
    from: () => {
      let id = ''
      const q: any = {
        select: () => q,
        eq: (_f: string, v: any) => {
          id = String(v)
          return q
        },
        single: async () => ({ data: mockOrders[id] ?? null }),
      }
      return q
    },
  }),
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => (mockUser.id ? { id: mockUser.id } : null)) }))
jest.mock('@/lib/rate-limit', () => ({ consumeRateLimit: jest.fn(async () => ({ limited: mockRate.limited })) }))
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

/* eslint-disable @typescript-eslint/no-var-requires */
const { GET } = require('@/app/api/moncash-button/status/route')
const { orderStatusToken } = require('@/lib/tickets/seatHolds')
const { reconcileMethod, selectReconcileCandidates } = require('@/lib/moncash-reconcile')

const poll = async (qs: string) => {
  const res = await GET(new Request(`http://localhost/api/moncash-button/status?${qs}`, { headers: { 'x-forwarded-for': '1.2.3.4' } }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  for (const k of Object.keys(mockOrders)) delete mockOrders[k]
  mockOrders['111'] = { order_id: '111', user_id: 'u1', status: 'pending', ticket_id: null }
  mockRate.limited = false
  mockUser.id = null
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('firestore.rules: inventory_shards_n is server-only', () => {
  const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8')
  it('cannot be set on create or changed on update by a client', () => {
    expect(rules).toContain("request.resource.data.get('inventory_shards_n', null) == null")
    expect(rules).toContain(
      "request.resource.data.get('inventory_shards_n', null) == resource.data.get('inventory_shards_n', null)"
    )
  })
})

describe('/api/moncash-button/status', () => {
  it('the signed status token from the processing URL authorizes the poll (app WebView)', async () => {
    const r = await poll(`orderId=111&st=${encodeURIComponent(orderStatusToken('111'))}`)
    expect(r).toEqual({ status: 200, body: { status: 'pending', ticketId: null, failureReason: null } })
  })

  it('the signed-in buyer may poll without a token', async () => {
    mockUser.id = 'u1'
    expect((await poll('orderId=111')).status).toBe(200)
  })

  it('unknown and not-yours both answer 404 (no id probing)', async () => {
    expect((await poll('orderId=999')).status).toBe(404)
    expect((await poll('orderId=111')).status).toBe(404)
    mockUser.id = 'someone-else'
    expect((await poll('orderId=111')).status).toBe(404)
    expect((await poll(`orderId=111&st=${encodeURIComponent(orderStatusToken('222'))}`)).status).toBe(404)
  })

  it('is rate-limited per IP', async () => {
    mockRate.limited = true
    expect((await poll(`orderId=111&st=${encodeURIComponent(orderStatusToken('111'))}`)).status).toBe(429)
  })
})

describe('reconcile: NatCash is retried while enabled', () => {
  const natcash = { order_id: 'n1', mobile_money_provider: 'natcash', payment_method: 'natcash', status: 'pending', created_at: new Date(Date.now() - 20 * 60_000).toISOString() }
  it('only with NATCASH_ENABLED', () => {
    expect(reconcileMethod(natcash, {})).toBeNull()
    expect(reconcileMethod(natcash, { NATCASH_ENABLED: 'true' })).toBe('natcash')
    expect(selectReconcileCandidates([natcash], Date.now(), {})).toHaveLength(0)
    expect(selectReconcileCandidates([natcash], Date.now(), { NATCASH_ENABLED: 'true' })).toHaveLength(1)
  })
  it('MonCash orders are unchanged', () => {
    expect(reconcileMethod({ payment_method: 'moncash', mobile_money_provider: 'moncash' }, {})).toBe('moncash')
  })
})
