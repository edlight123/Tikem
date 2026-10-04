/**
 * The MonCash checkout path pays a Digicel round trip for every OAuth token it
 * mints, so the token client must (a) share one in-flight request between
 * concurrent callers, (b) try the auth variant that last worked FIRST instead of
 * burning a 401 per rejected variant on every refresh, and (c) let a route start
 * minting early (prewarm) without ever throwing.
 *
 * Separately: a real fetch Response body can only be read once. The gateway
 * helpers used to re-read the first error body when no retry happened, which in
 * production threw "Body is unusable" and hid Digicel's answer — including the
 * 404 "not settled" answer reconciliation depends on. The mocks here use
 * single-use bodies so that regression cannot hide behind a lenient mock.
 */

// lib/capacity pulls in the Firestore admin wrapper; capacityFromEvent is pure.
jest.mock('@/lib/firebase-db/server', () => ({ createClient: jest.fn() }))

type MockResponse = {
  ok: boolean
  status: number
  json: () => Promise<any>
  text: () => Promise<string>
}

/** A Response stand-in whose body, like a real one, can be consumed only once. */
function onceResponse(status: number, body: unknown): MockResponse {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  let used = false
  const take = () => {
    if (used) throw new TypeError('Body is unusable: Body has already been read')
    used = true
    return raw
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(take()),
    text: async () => take(),
  }
}

const tokenOk = (token = 'test-token') =>
  onceResponse(200, { access_token: token, token_type: 'bearer', expires_in: 3600 })

function loadMonCash(): typeof import('@/lib/moncash') {
  let mod: typeof import('@/lib/moncash') | undefined
  jest.isolateModules(() => {
    mod = require('@/lib/moncash')
  })
  return mod!
}

describe('MonCash gateway client latency + robustness', () => {
  beforeEach(() => {
    process.env.MONCASH_CLIENT_ID = 'test-client'
    process.env.MONCASH_SECRET_KEY = 'test-secret'
    process.env.MONCASH_MODE = 'production'
    jest.spyOn(console, 'log').mockImplementation()
    jest.spyOn(console, 'info').mockImplementation()
    jest.spyOn(console, 'warn').mockImplementation()
    jest.spyOn(console, 'error').mockImplementation()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('shares one OAuth request between concurrent callers', async () => {
    const moncash = loadMonCash()
    let tokenCalls = 0
    global.fetch = jest.fn(async (url: any) => {
      if (String(url).includes('/Api/oauth/token')) {
        tokenCalls += 1
        await new Promise((r) => setTimeout(r, 5))
        return tokenOk()
      }
      return onceResponse(200, { payment_token: { token: 'pay-token' } })
    }) as unknown as typeof fetch

    // The checkout route's prewarm racing its own CreatePayment.
    const warm = moncash.prewarmMonCashAccessToken()
    const [payment] = await Promise.all([
      moncash.createMonCashGatewayPayment({ amount: 500, orderId: '123' }),
      warm,
    ])

    expect(tokenCalls).toBe(1)
    expect(payment.redirectUrl).toContain('/Moncash-middleware/Payment/Redirect?token=pay-token')
  })

  it('prewarm never throws, even when Digicel rejects every credential variant', async () => {
    const moncash = loadMonCash()
    global.fetch = jest.fn(async () => onceResponse(401, 'unauthorized')) as unknown as typeof fetch
    await expect(moncash.prewarmMonCashAccessToken()).resolves.toBeUndefined()
  })

  it('tries the last working credential variant first on the next refresh', async () => {
    const moncash = loadMonCash()
    const tokenAttempts: string[] = []
    const tokenResponses = [onceResponse(401, 'no'), onceResponse(401, 'no'), tokenOk('t1'), tokenOk('t2')]
    global.fetch = jest.fn(async (url: any, init: any) => {
      if (String(url).includes('/Api/oauth/token')) {
        const viaBasic = Boolean(init?.headers?.Authorization)
        const scope = new URLSearchParams(String(init?.body || '')).get('scope')
        tokenAttempts.push(`${viaBasic ? 'basic' : 'body'}:${scope}`)
        return tokenResponses.shift()!
      }
      // First CreatePayment: report the cached token expired, forcing a refresh.
      if (tokenAttempts.length === 3) return onceResponse(401, 'invalid_token')
      return onceResponse(200, { payment_token: { token: 'pay-token' } })
    }) as unknown as typeof fetch

    await moncash.createMonCashGatewayPayment({ amount: 500, orderId: '123' })

    // Cold: basic,basic → 401s, then body succeeds. Refresh: straight to body.
    expect(tokenAttempts).toEqual([
      'basic:read,write',
      'basic:read write',
      'body:read,write',
      'body:read,write',
    ])
  })

  it("surfaces CreatePayment's real error instead of 'Body is unusable'", async () => {
    const moncash = loadMonCash()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(onceResponse(400, { message: 'Invalid amount' })) as unknown as typeof fetch

    await expect(moncash.createMonCashGatewayPayment({ amount: 0, orderId: '1' })).rejects.toThrow(
      /CreatePayment failed \(400\).*Invalid amount/
    )
  })

  it('reads a 404 "not settled" answer from a single-use body as not-paid', async () => {
    const moncash = loadMonCash()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(
        onceResponse(404, { message: 'Transaction Not Found', status: 404 })
      ) as unknown as typeof fetch

    const result = await moncash.retrieveMonCashOrderPayment('78660467902')
    expect(result.success).toBe(false)
    expect(result.payment_status).toBe('Transaction Not Found')
  })

  it('still re-reads the RETRIED response after a token refresh', async () => {
    const moncash = loadMonCash()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(tokenOk('stale'))
      .mockResolvedValueOnce(onceResponse(401, 'invalid_token'))
      .mockResolvedValueOnce(tokenOk('fresh'))
      .mockResolvedValueOnce(onceResponse(500, 'gateway down')) as unknown as typeof fetch

    await expect(moncash.retrieveMonCashOrderPayment('1')).rejects.toThrow(/500.*gateway down/)
  })
})

describe('capacityFromEvent', () => {
  it('matches the counter-based verdict without a second read', () => {
    const { capacityFromEvent } = require('@/lib/capacity')
    expect(capacityFromEvent({ max_tickets: 10, tickets_sold: 8 }, 2)).toEqual({
      available: true,
      remaining: 2,
      isSoldOut: false,
    })
    expect(capacityFromEvent({ max_tickets: 10, tickets_sold: 10 }, 1)).toEqual({
      available: false,
      remaining: 0,
      isSoldOut: true,
    })
    expect(capacityFromEvent({}, 5).available).toBe(true)
    expect(capacityFromEvent(null, 5).available).toBe(true)
  })
})
