/**
 * @jest-environment node
 *
 * SogePay server callback: a paid notice is fulfilled only with a present,
 * matching amount (fail closed; a mismatch or missing amount goes to the refund
 * queue), and a replayed "not paid" never moves a non-pending order.
 */
import crypto from 'crypto'

type Doc = Record<string, any>
const orders = new Map<string, Doc>()
const fulfill = jest.fn(async (_args: any) => ({ outcome: 'fulfilled', ticketId: 't1' }))

jest.mock('@/lib/firebase-db/server', () => ({
  createClient: async () => ({
    from: () => {
      let id = ''
      let patch: Doc | null = null
      const b: any = {
        select: () => b,
        update: (p: Doc) => {
          patch = p
          return b
        },
        eq: (_f: string, v: string) => {
          id = v
          return b
        },
        single: async () => ({ data: orders.get(id) ?? null, error: null }),
        then: (resolve: any) => {
          if (patch) orders.set(id, { ...(orders.get(id) || {}), ...patch })
          resolve({ error: null })
        },
      }
      return b
    },
  }),
}))
jest.mock('@/lib/tickets/fulfillment', () => ({ fulfillPaidOrder: (a: any) => fulfill(a) }))
jest.mock('@/lib/auth', () => ({ getCurrentUser: async () => null }))

import { POST } from '@/app/api/sogepay/callback/route'

const SECRET = 'whsec_test'
function signed(payload: Doc) {
  const raw = JSON.stringify(payload)
  const sig = crypto.createHmac('sha256', SECRET).update(raw).digest('hex')
  return POST({
    text: async () => raw,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : h.toLowerCase().includes('signature') ? sig : null) },
    url: 'http://localhost/api/sogepay/callback',
  } as any)
}

beforeEach(() => {
  process.env.SOGEPAY_ENABLED = 'true'
  process.env.SOGEPAY_WEBHOOK_SECRET = SECRET
  orders.clear()
  orders.set('o1', { order_id: 'o1', status: 'pending', amount: 1000 })
  fulfill.mockClear()
})

describe('SogePay callback', () => {
  it('fulfills a paid notice whose amount matches', async () => {
    const res = await signed({ orderId: 'o1', status: 'paid', amount: 1000 })
    expect((await res.json()).ok).toBe(true)
    expect(fulfill).toHaveBeenCalledTimes(1)
  })

  it('fails closed on a paid notice with no amount: no tickets, queued for refund', async () => {
    const res = await signed({ orderId: 'o1', status: 'paid' })
    expect(await res.json()).toMatchObject({ ok: false, error: 'amount_unverified', needsRefund: true })
    expect(fulfill).not.toHaveBeenCalled()
    expect(orders.get('o1')).toMatchObject({ status: 'failed', needs_refund: true, failure_reason: 'amount_unverified' })
  })

  it('an amount mismatch is queued for refund, not just failed', async () => {
    await signed({ orderId: 'o1', status: 'paid', amount: 10 })
    expect(fulfill).not.toHaveBeenCalled()
    expect(orders.get('o1')).toMatchObject({ status: 'failed', needs_refund: true, failure_reason: 'amount_mismatch' })
  })

  it('a replayed "not paid" never changes a non-pending order', async () => {
    orders.set('o1', { order_id: 'o1', status: 'processing', amount: 1000 })
    const res = await signed({ orderId: 'o1', status: 'declined' })
    expect(await res.json()).toMatchObject({ ignored: true })
    expect(orders.get('o1')?.status).toBe('processing')
  })
})
