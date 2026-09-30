/**
 * MonCash signals "this order did not settle" with HTTP 404, not a 200 body.
 * Treating every non-2xx as an exception makes the caller's `if (!isPaid)`
 * branch unreachable, so a genuinely failed payment can never be recorded as
 * failed — it surfaces as a generic processing error and the order is left
 * pending forever.
 *
 * A 404 is an ANSWER. A 401/500 is not, and must still throw so a transient
 * Digicel outage is never mistaken for a failed payment.
 */
import { retrieveMonCashOrderPayment } from '@/lib/moncash'

const TOKEN_RESPONSE = {
  ok: true,
  status: 200,
  json: async () => ({ access_token: 'test-token', token_type: 'bearer', expires_in: 3600 }),
  text: async () => '',
}

function gatewayResponse(status: number, body: unknown) {
  const raw = JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(raw),
    text: async () => raw,
  }
}

describe('retrieveMonCashOrderPayment', () => {
  beforeEach(() => {
    process.env.MONCASH_CLIENT_ID = 'test-client'
    process.env.MONCASH_SECRET_KEY = 'test-secret'
    process.env.MONCASH_MODE = 'production'
    jest.spyOn(console, 'log').mockImplementation()
    jest.spyOn(console, 'warn').mockImplementation()
    jest.spyOn(console, 'error').mockImplementation()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('reports an unsettled order as not-paid instead of throwing', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(TOKEN_RESPONSE)
      .mockResolvedValueOnce(
        gatewayResponse(404, {
          path: '/Api/v1/RetrieveOrderPayment',
          error: 'Not Found',
          message: 'Transaction Not Found',
          status: 404,
        })
      ) as unknown as typeof fetch

    const result = await retrieveMonCashOrderPayment('504914281769')

    expect(result.success).toBe(false)
    expect(result.payment_status).toBe('Transaction Not Found')
  })

  it("surfaces Digicel's rejection reason so it can be recorded on the order", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      gatewayResponse(404, {
        transaction_id: '0',
        path: '/Api/v1/RetrieveOrderPayment',
        error: 'Not Found',
        message:
          'Failed to match a reason type because the Identity Type factor of the credit party does not match.',
        status: 404,
      })
    ) as unknown as typeof fetch

    const result = await retrieveMonCashOrderPayment('505632730545')

    expect(result.success).toBe(false)
    expect(result.payment_status).toMatch(/Identity Type factor of the credit party/)
  })

  it('still throws when the gateway is broken, so an outage is never read as a failed payment', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(gatewayResponse(500, { error: 'Internal Server Error' })) as unknown as typeof fetch

    await expect(retrieveMonCashOrderPayment('504914281769')).rejects.toThrow(/500/)
  })

  it('reports a settled order as paid', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      gatewayResponse(200, {
        payment: {
          reference: '504914281769',
          transaction_id: '1234567',
          cost: 50,
          message: 'successful',
          payer: '509xxxxxxxx',
        },
        status: 200,
      })
    ) as unknown as typeof fetch

    const result = await retrieveMonCashOrderPayment('504914281769')

    expect(result.success).toBe(true)
    expect(result.cost).toBe(50)
    expect(result.reference).toBe('504914281769')
  })
})
