/**
 * MonCash gateway token shared across serverless functions (lib/moncash.ts,
 * 2026-11-17). Covers the audit findings on that change:
 *  - the shared doc is keyed by mode + client (a sandbox token must never be
 *    served to production, since local dev uses the same Firebase project);
 *  - a shared token is reused without a Digicel OAuth round trip;
 *  - a token Digicel rejects is never re-adopted from the shared doc: the
 *    retry mints a fresh one.
 *
 * @jest-environment node
 */

const store = new Map<string, Record<string, any>>()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (col: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const d = store.get(`${col}/${id}`)
          return { exists: !!d, data: () => d }
        },
        set: async (data: Record<string, any>) => {
          store.set(`${col}/${id}`, data)
        },
      }),
    }),
  },
}))
jest.mock('@/lib/firebase-db/server', () => ({ createClient: jest.fn() }))

function res(status: number, body: unknown) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(raw), text: async () => raw }
}
const tokenOk = (token: string) => res(200, { access_token: token, token_type: 'bearer', expires_in: 3600 })
const paymentOk = () => res(200, { payment_token: { token: 'pay-tok', expired: '2099-01-01 00:00:00' }, status: 202 })

function loadMonCash(): typeof import('@/lib/moncash') {
  let mod: typeof import('@/lib/moncash') | undefined
  jest.isolateModules(() => {
    mod = require('@/lib/moncash')
  })
  return mod!
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('MonCash shared gateway token', () => {
  let fetchMock: jest.Mock

  beforeEach(() => {
    store.clear()
    process.env.MONCASH_CLIENT_ID = 'client-A'
    process.env.MONCASH_SECRET_KEY = 'secret'
    process.env.MONCASH_MODE = 'production'
    fetchMock = jest.fn()
    ;(global as any).fetch = fetchMock
    jest.spyOn(console, 'log').mockImplementation()
    jest.spyOn(console, 'info').mockImplementation()
    jest.spyOn(console, 'warn').mockImplementation()
  })
  afterEach(() => jest.restoreAllMocks())

  const oauthCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/oauth/token')).length

  it('writes the minted token to a doc keyed by mode, never a single shared name', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/oauth/token') ? tokenOk('prod-token') : paymentOk()
    )
    await loadMonCash().createMonCashGatewayPayment({ amount: 100, orderId: 'o1' })
    await flush()
    const keys = [...store.keys()]
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/^server_cache\/moncash_gateway_token_production_[0-9a-f]{16}$/)
    expect(keys[0]).not.toContain('client-A')
  })

  it('a sandbox instance never reads the production token', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/oauth/token') ? tokenOk('prod-token') : paymentOk()
    )
    await loadMonCash().createMonCashGatewayPayment({ amount: 100, orderId: 'o1' })
    await flush()

    process.env.MONCASH_MODE = 'sandbox'
    fetchMock.mockClear()
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/oauth/token') ? tokenOk('sandbox-token') : paymentOk()
    )
    await loadMonCash().createMonCashGatewayPayment({ amount: 100, orderId: 'o2' })
    expect(oauthCalls()).toBe(1) // minted its own instead of borrowing production's
    const bearer = fetchMock.mock.calls.find(([u]) => String(u).includes('CreatePayment'))?.[1]?.headers?.Authorization
    expect(bearer).toBe('Bearer sandbox-token')
  })

  it('reuses a valid shared token without an OAuth round trip', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/oauth/token') ? tokenOk('first') : paymentOk()
    )
    await loadMonCash().createMonCashGatewayPayment({ amount: 100, orderId: 'o1' })
    await flush()

    fetchMock.mockClear()
    // A different function instance (fresh module state) borrows it.
    await loadMonCash().createMonCashGatewayPayment({ amount: 100, orderId: 'o2' })
    expect(oauthCalls()).toBe(0)
  })

  it('never re-adopts a token Digicel rejected: the retry mints a fresh one', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/oauth/token') ? tokenOk('stale') : paymentOk()
    )
    await loadMonCash().createMonCashGatewayPayment({ amount: 100, orderId: 'o1' })
    await flush()

    // New instance: the shared doc still holds "stale", which Digicel now rejects.
    fetchMock.mockClear()
    fetchMock.mockImplementation(async (url: string, init: any) => {
      if (String(url).includes('/oauth/token')) return tokenOk('fresh')
      return init?.headers?.Authorization === 'Bearer stale' ? res(401, { error: 'invalid_token' }) : paymentOk()
    })
    const out = await loadMonCash().createMonCashGatewayPayment({ amount: 100, orderId: 'o2' })
    expect(out.redirectUrl).toContain('pay-tok')
    expect(oauthCalls()).toBe(1)
    const bearers = fetchMock.mock.calls
      .filter(([u]) => String(u).includes('CreatePayment'))
      .map(([, i]) => i?.headers?.Authorization)
    expect(bearers).toEqual(['Bearer stale', 'Bearer fresh'])
  })
})
