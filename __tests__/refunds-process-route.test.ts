/**
 * @jest-environment node
 *
 * POST /api/refunds/process — an organizer approving or denying a buyer's
 * refund request (web + mobile OrganizerRefundsScreen). Runs the real route and
 * refund mechanics against an in-memory Firestore with the Stripe SDK mocked.
 * The bug this guards: the route read `payment_intent_id` / `price`, which no
 * purchase path writes, so an approved card refund never reached Stripe and a
 * destination charge never had its transfer reversed.
 */

import { FakeFirestore, type Doc } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))

// The route's Supabase-shaped shim, backed by the same fake store.
let authUser: { id: string } | null = { id: 'org_1' }
function builder(table: string) {
  let filter: [string, unknown] | null = null
  let pendingUpdate: Doc | null = null
  const b: any = {
    select: () => b,
    eq: (field: string, value: unknown) => {
      filter = [field, value]
      return b
    },
    update: (data: Doc) => {
      pendingUpdate = data
      return b
    },
    single: async () => {
      const id = String(filter?.[1])
      const data = db.store.get(`${table}/${id}`)
      return data ? { data: { id, ...data }, error: null } : { data: null, error: { message: 'not found' } }
    },
    then: (resolve: (v: any) => void) => {
      if (pendingUpdate && filter) db.write(`${table}/${String(filter[1])}`, pendingUpdate, { merge: true })
      resolve({ error: null })
    },
  }
  return b
}
jest.mock('@/lib/firebase-db/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authUser }, error: null }) },
    from: (table: string) => builder(table),
  }),
}))

const sendEmail = jest.fn(async (_args: any) => ({ success: true }))
jest.mock('@/lib/email', () => ({
  sendEmail: (args: any) => sendEmail(args),
  getRefundProcessedEmail: (p: any) => `refund ${p.status} ${p.refundAmount}`,
  emailSubjects: { refundProcessed: (_l: any, t: string) => `Refund for ${t}` },
}))
jest.mock('@/lib/email-kit/recipient', () => ({
  resolveEmailLang: async () => 'en',
}))
jest.mock('@/lib/sms', () => ({
  sendSms: jest.fn(async () => ({ success: true })),
  getRefundApprovedSms: () => 'approved',
  getRefundDeniedSms: () => 'denied',
}))

const stripeRefundsCreate = jest.fn()
const stripePaymentIntentsRetrieve = jest.fn()
jest.mock('stripe', () =>
  jest.fn(() => ({
    refunds: { create: (...args: any[]) => stripeRefundsCreate(...args) },
    paymentIntents: { retrieve: (...args: any[]) => stripePaymentIntentsRetrieve(...args) },
  }))
)


// The coverage gate (lib/tickets/refundCoverage.ts) is exercised in
// refund-admin-review.test.ts; here every refund is covered.
jest.mock('@/lib/tickets/refundCoverage', () => ({
  loadRefundCoverageContext: async (eventId: string) => ({ eventId, input: {} }),
  coverageInTransaction: async () => ({
    currency: 'HTG',
    faceMinor: 0,
    organizerCostMinor: 0,
    coverageMinor: 0,
    shortfallMinor: 0,
    withdrawnMinor: 0,
  }),
}))

import { POST } from '@/app/api/refunds/process/route'

const requested = { status: 'valid', refund_status: 'requested', refund_reason: 'Cannot attend', attendee_id: 'buyer_1' }

function seed() {
  db.store.clear()
  db.write('events/ev1', { title: 'Rara Fest', organizer_id: 'org_1', status: 'published' })
  db.write('users/buyer_1', { email: 'buyer@example.com', full_name: 'Buyer' })
  db.write('tickets/t_card', {
    ...requested,
    event_id: 'ev1',
    price_paid: 1500,
    currency: 'HTG',
    charged_amount: 11.5,
    charged_currency: 'USD',
    payment_method: 'stripe',
    payment_id: 'pi_card',
  })
  db.write('tickets/t_connect', {
    ...requested,
    event_id: 'ev1',
    price_paid: 25,
    currency: 'USD',
    charged_amount: 27.4,
    charged_currency: 'USD',
    payment_method: 'stripe_connect',
    payment_id: 'pi_connect',
  })
  db.write('tickets/t_moncash', {
    ...requested,
    event_id: 'ev1',
    price_paid: 2000,
    currency: 'HTG',
    charged_amount: 2200,
    charged_currency: 'HTG',
    payment_method: 'moncash',
    payment_id: 'mc_tx_1',
  })
  db.write('tickets/t_free', { ...requested, event_id: 'ev1', price_paid: 0, currency: 'HTG', payment_method: 'free' })
  db.write('tickets/t_done', {
    event_id: 'ev1',
    status: 'refunded',
    refund_status: 'approved',
    payment_method: 'stripe',
    payment_id: 'pi_done',
    charged_amount: 10,
    charged_currency: 'USD',
  })
}

const call = (ticketId: string, action: 'approve' | 'deny') =>
  POST(new Request('http://localhost/api/refunds/process', { method: 'POST', body: JSON.stringify({ ticketId, action }) }))

const ticket = (id: string) => db.store.get(`tickets/${id}`) as Doc

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123'
  authUser = { id: 'org_1' }
  seed()
  sendEmail.mockClear()
  stripeRefundsCreate.mockReset()
  stripeRefundsCreate.mockImplementation(async (params: any) => ({ id: `re_${params.payment_intent}` }))
  stripePaymentIntentsRetrieve.mockReset()
  stripePaymentIntentsRetrieve.mockImplementation(async (id: string) => ({ id, transfer_data: null }))
})

describe('POST /api/refunds/process', () => {
  it('refunds an approved card request through Stripe in the charged currency, via payment_id', async () => {
    const res = await call('t_card', 'approve')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, refundAmount: 11.5, refundCurrency: 'USD', manual: false })
    expect(stripeRefundsCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_card', amount: 1150 },
      { idempotencyKey: 'tikem-ticket-refund-t_card' }
    )
    expect(ticket('t_card')).toMatchObject({
      status: 'refunded',
      refund_status: 'approved',
      refund_amount: 11.5,
      refund_currency: 'USD',
      refund_id: 're_pi_card',
      // The buyer's reason survives; the refund's cause goes alongside it.
      refund_reason: 'Cannot attend',
      refund_source: 'organizer_refund',
    })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'buyer@example.com' }))
  })

  it('reverses the transfer but keeps Tikèm\'s application fee on a buyer-requested stripe_connect refund', async () => {
    const res = await call('t_connect', 'approve')
    expect(res.status).toBe(200)
    // The service fee is non-refundable on a buyer's request: no refund_application_fee.
    expect(stripeRefundsCreate.mock.calls[0][0]).toEqual({
      payment_intent: 'pi_connect',
      amount: 2740,
      reverse_transfer: true,
    })
    expect(ticket('t_connect')).toMatchObject({ refund_fee_policy: 'retained' })
  })

  it('queues an approved MonCash request for a manual payout without calling Stripe', async () => {
    const res = await call('t_moncash', 'approve')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ refundAmount: 2200, refundCurrency: 'HTG', manual: true })
    expect(stripeRefundsCreate).not.toHaveBeenCalled()
    expect(ticket('t_moncash')).toMatchObject({ status: 'refund_pending', refund_status: 'manual_required', refund_reason: 'Cannot attend' })
    const queue = db.docsIn('manual_refund_queue')
    expect(queue).toHaveLength(1)
    expect(queue[0][1]).toMatchObject({ ticketId: 't_moncash', amount: 2200, currency: 'HTG', method: 'moncash', status: 'pending' })
  })

  it('retires an approved free ticket without any refund', async () => {
    const res = await call('t_free', 'approve')
    expect(res.status).toBe(200)
    expect(stripeRefundsCreate).not.toHaveBeenCalled()
    expect(db.docsIn('manual_refund_queue')).toHaveLength(0)
    expect(ticket('t_free')).toMatchObject({ status: 'refunded', refund_status: 'approved', refund_amount: 0 })
  })

  it('refuses an already-refunded ticket, and a second approval never refunds twice', async () => {
    const done = await call('t_done', 'approve')
    expect(done.status).toBe(400)

    await call('t_card', 'approve')
    const again = await call('t_card', 'approve')
    expect(again.status).toBe(400)
    expect(stripeRefundsCreate).toHaveBeenCalledTimes(1)
  })

  it('puts the request back to requested when Stripe fails, so the organizer can retry', async () => {
    stripeRefundsCreate.mockImplementation(async () => {
      throw new Error('stripe down')
    })
    const res = await call('t_card', 'approve')
    expect(res.status).toBe(502)
    expect(ticket('t_card')).toMatchObject({ status: 'valid', refund_status: 'requested', refund_claimed_at: null })
  })

  it('denies without moving money', async () => {
    const res = await call('t_card', 'deny')
    expect(res.status).toBe(200)
    expect(stripeRefundsCreate).not.toHaveBeenCalled()
    expect(ticket('t_card')).toMatchObject({ status: 'valid', refund_status: 'denied' })
  })

  it('keeps its authorization: only the event organizer may act', async () => {
    authUser = { id: 'someone_else' }
    expect((await call('t_card', 'approve')).status).toBe(403)
    authUser = null
    expect((await call('t_card', 'approve')).status).toBe(401)
    expect(stripeRefundsCreate).not.toHaveBeenCalled()
  })

  it('refuses to approve a request made by someone who no longer holds the ticket', async () => {
    db.write('tickets/t_card', { refund_requested_by: 'buyer_1', attendee_id: 'buyer_2', user_id: 'buyer_2', transfer_count: 1 }, { merge: true })
    const res = await call('t_card', 'approve')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('holder_changed')
    expect(stripeRefundsCreate).not.toHaveBeenCalled()
  })

  it('a checked-in ticket needs an explicit override to be refunded', async () => {
    db.write('tickets/t_card', { checked_in: true, checked_in_at: '2026-10-01T20:00:00.000Z' }, { merge: true })
    const res = await call('t_card', 'approve')
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'checked_in', requiresOverride: true })
    expect(stripeRefundsCreate).not.toHaveBeenCalled()

    const overridden = await POST(
      new Request('http://localhost/api/refunds/process', {
        method: 'POST',
        body: JSON.stringify({ ticketId: 't_card', action: 'approve', allowCheckedIn: true }),
      })
    )
    expect(overridden.status).toBe(200)
  })
})
