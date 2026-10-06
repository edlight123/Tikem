/**
 * Event cancellation → refunds, through the real cancel + refund mechanics with
 * an in-memory Firestore and a mocked Stripe SDK. The tickets below use the
 * field names the purchase paths actually write (`price_paid`, `payment_id`,
 * `charged_amount`, `charged_currency`) — the bug this guards against was a
 * cancel that read `price` / `payment_intent_id` and so refunded no card buyer.
 */

import { FakeFirestore, type Doc } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))

const sendEmail = jest.fn(async (_args: any) => ({ success: true }))
jest.mock('@/lib/email', () => ({ sendEmail: (args: any) => sendEmail(args) }))

const stripeRefundsCreate = jest.fn()
const stripePaymentIntentsRetrieve = jest.fn()
jest.mock('stripe', () =>
  jest.fn(() => ({
    refunds: { create: (...args: any[]) => stripeRefundsCreate(...args) },
    paymentIntents: { retrieve: (...args: any[]) => stripePaymentIntentsRetrieve(...args) },
  }))
)

import { cancelEventWithRefunds, organizerSelfCancelBlock } from '@/lib/events/cancel'

const actor = { id: 'org_1', email: 'org@example.com', isAdmin: false }

function seed() {
  db.store.clear()
  db.write('events/ev1', { title: 'Konpa Night', organizer_id: 'org_1', status: 'published', currency: 'HTG' })
  db.write('users/buyer_card', { email: 'card@example.com' })
  db.write('users/buyer_connect', { email: 'connect@example.com' })
  db.write('users/buyer_moncash', { email: 'moncash@example.com' })
  db.write('users/buyer_free', { email: 'free@example.com' })
  db.write('users/buyer_done', { email: 'done@example.com' })

  // Platform card charge for an HTG event — charged in USD (webhook mirror shape:
  // attendee_id, no user_id).
  db.write('tickets/t_card', {
    event_id: 'ev1',
    attendee_id: 'buyer_card',
    status: 'confirmed',
    price_paid: 1500,
    currency: 'HTG',
    charged_amount: 11.5,
    charged_currency: 'USD',
    payment_method: 'stripe',
    payment_id: 'pi_card',
  })
  // Destination charge.
  db.write('tickets/t_connect', {
    event_id: 'ev1',
    attendee_id: 'buyer_connect',
    user_id: 'buyer_connect',
    status: 'valid',
    price_paid: 25,
    currency: 'USD',
    charged_amount: 27.4,
    charged_currency: 'USD',
    payment_method: 'stripe_connect',
    payment_id: 'pi_connect',
  })
  db.write('tickets/t_moncash', {
    event_id: 'ev1',
    attendee_id: 'buyer_moncash',
    user_id: 'buyer_moncash',
    status: 'confirmed',
    price_paid: 2000,
    currency: 'HTG',
    charged_amount: 2200,
    charged_currency: 'HTG',
    payment_method: 'moncash',
    payment_id: 'mc_tx_1',
  })
  db.write('tickets/t_free', {
    event_id: 'ev1',
    attendee_id: 'buyer_free',
    status: 'valid',
    price_paid: 0,
    currency: 'HTG',
    payment_method: 'free',
  })
  db.write('tickets/t_done', {
    event_id: 'ev1',
    attendee_id: 'buyer_done',
    status: 'refunded',
    refund_status: 'approved',
    price_paid: 20,
    currency: 'USD',
    charged_amount: 20,
    charged_currency: 'USD',
    payment_method: 'stripe',
    payment_id: 'pi_done',
  })
  // Another event's ticket must not be touched.
  db.write('tickets/t_other', { event_id: 'ev2', status: 'valid', price_paid: 10, payment_method: 'stripe', payment_id: 'pi_other' })
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123'
  seed()
  sendEmail.mockClear()
  stripeRefundsCreate.mockReset()
  stripeRefundsCreate.mockImplementation(async (params: any) => ({ id: `re_${params.payment_intent}` }))
  stripePaymentIntentsRetrieve.mockReset()
  stripePaymentIntentsRetrieve.mockImplementation(async (id: string) => ({ id, transfer_data: null }))
})

const ticket = (id: string) => db.store.get(`tickets/${id}`) as Doc

describe('cancelEventWithRefunds', () => {
  it('refunds card buyers in the charged currency using payment_id', async () => {
    const out = await cancelEventWithRefunds({ eventId: 'ev1', actor, reason: 'Venue flooded' })

    const cardCall = stripeRefundsCreate.mock.calls.find(([p]) => p.payment_intent === 'pi_card')
    expect(cardCall).toBeDefined()
    expect(cardCall![0]).toEqual({ payment_intent: 'pi_card', amount: 1150 }) // 11.50 USD, not 1500 HTG
    expect(cardCall![1]).toEqual({ idempotencyKey: 'tikem-ticket-refund-t_card' })

    expect(ticket('t_card')).toMatchObject({
      status: 'refunded',
      refund_status: 'approved',
      refund_amount: 11.5,
      refund_currency: 'USD',
      refund_id: 're_pi_card',
      refund_reason: 'event_cancelled',
    })
    expect(out.refundsSucceeded).toBe(2)
    expect(db.store.get('events/ev1')).toMatchObject({ status: 'cancelled', payouts_frozen: true })
  })

  it('reverses the transfer and application fee for stripe_connect sales', async () => {
    await cancelEventWithRefunds({ eventId: 'ev1', actor })
    const call = stripeRefundsCreate.mock.calls.find(([p]) => p.payment_intent === 'pi_connect')
    expect(call![0]).toEqual({
      payment_intent: 'pi_connect',
      amount: 2740,
      reverse_transfer: true,
      refund_application_fee: true,
    })
    expect(ticket('t_connect')).toMatchObject({ status: 'refunded', refund_amount: 27.4, refund_currency: 'USD' })
  })

  it('treats a "stripe" ticket that Stripe says was a destination charge as connect', async () => {
    stripePaymentIntentsRetrieve.mockImplementation(async (id: string) => ({
      id,
      transfer_data: id === 'pi_card' ? { destination: 'acct_org' } : null,
    }))
    await cancelEventWithRefunds({ eventId: 'ev1', actor })
    const call = stripeRefundsCreate.mock.calls.find(([p]) => p.payment_intent === 'pi_card')
    expect(call![0]).toMatchObject({ reverse_transfer: true, refund_application_fee: true })
  })

  it('voids MonCash tickets and queues them for a manual payout, never Stripe', async () => {
    const out = await cancelEventWithRefunds({ eventId: 'ev1', actor })
    expect(stripeRefundsCreate.mock.calls.some(([p]) => p.payment_intent === 'mc_tx_1')).toBe(false)
    expect(ticket('t_moncash')).toMatchObject({ status: 'refund_pending', refund_status: 'manual_required', refund_amount: 2200 })
    const queue = db.docsIn('manual_refund_queue')
    expect(queue).toHaveLength(1)
    expect(queue[0][1]).toMatchObject({
      ticketId: 't_moncash',
      eventId: 'ev1',
      amount: 2200,
      currency: 'HTG',
      method: 'moncash',
      transactionId: 'mc_tx_1',
      reason: 'event_cancelled',
      status: 'pending',
    })
    expect(out.refundsQueuedManual).toBe(1)
  })

  it('voids free tickets without any refund, and leaves already-refunded ones alone', async () => {
    const out = await cancelEventWithRefunds({ eventId: 'ev1', actor })
    expect(ticket('t_free')).toMatchObject({ status: 'cancelled', cancellation_reason: 'event_cancelled' })
    expect(ticket('t_done')).toMatchObject({ status: 'refunded', refund_status: 'approved' })
    expect(stripeRefundsCreate.mock.calls.some(([p]) => p.payment_intent === 'pi_done')).toBe(false)
    expect(ticket('t_other')).toMatchObject({ status: 'valid' })
    expect(out).toMatchObject({
      alreadyCancelled: false,
      ticketsAffected: 4,
      refundsSucceeded: 2,
      refundsQueuedManual: 1,
      freeTicketsVoided: 1,
      refundsFailed: 0,
      alreadyHandled: 1,
    })
  })

  it('notifies each affected buyer once, in-app and by email', async () => {
    const out = await cancelEventWithRefunds({ eventId: 'ev1', actor, reason: 'Venue flooded' })
    expect(out.notified).toBe(4)
    const recipients = sendEmail.mock.calls.map(([a]) => a.to).sort()
    expect(recipients).toEqual(['card@example.com', 'connect@example.com', 'free@example.com', 'moncash@example.com'])
    const cardEmail = sendEmail.mock.calls.find(([a]) => a.to === 'card@example.com')![0]
    expect(cardEmail.html).toContain('11.5 USD')
    expect(cardEmail.html).toContain('refunded to your original payment method')
    expect(cardEmail.html).toContain('Venue flooded')
    const moncashEmail = sendEmail.mock.calls.find(([a]) => a.to === 'moncash@example.com')![0]
    expect(moncashEmail.html).toContain('sent by hand')
    expect(db.docsIn('users/buyer_card/notifications')).toHaveLength(1)
  })

  it('is idempotent: a second run refunds, queues and notifies nothing again', async () => {
    await cancelEventWithRefunds({ eventId: 'ev1', actor })
    const refundsAfterFirst = stripeRefundsCreate.mock.calls.length
    const emailsAfterFirst = sendEmail.mock.calls.length

    const second = await cancelEventWithRefunds({ eventId: 'ev1', actor })
    expect(stripeRefundsCreate.mock.calls.length).toBe(refundsAfterFirst)
    expect(sendEmail.mock.calls.length).toBe(emailsAfterFirst)
    expect(db.docsIn('manual_refund_queue')).toHaveLength(1)
    expect(second).toMatchObject({
      alreadyCancelled: true,
      ticketsAffected: 0,
      refundsSucceeded: 0,
      refundsQueuedManual: 0,
      notified: 0,
      alreadyHandled: 5,
    })
  })

  it('holds a failed card refund void and retries it on the next run with the same idempotency key', async () => {
    stripeRefundsCreate.mockImplementation(async (params: any) => {
      if (params.payment_intent === 'pi_card') throw new Error('stripe down')
      return { id: `re_${params.payment_intent}` }
    })
    const first = await cancelEventWithRefunds({ eventId: 'ev1', actor })
    expect(first.refundsFailed).toBe(1)
    expect(ticket('t_card')).toMatchObject({ status: 'refund_pending', refund_status: 'failed' })

    stripeRefundsCreate.mockImplementation(async (params: any) => ({ id: `re_${params.payment_intent}` }))
    const second = await cancelEventWithRefunds({ eventId: 'ev1', actor })
    expect(second).toMatchObject({ refundsSucceeded: 1, refundsFailed: 0 })
    const cardCalls = stripeRefundsCreate.mock.calls.filter(([p]) => p.payment_intent === 'pi_card')
    expect(cardCalls).toHaveLength(2)
    expect(cardCalls.every(([, o]) => o.idempotencyKey === 'tikem-ticket-refund-t_card')).toBe(true)
    expect(ticket('t_card')).toMatchObject({ status: 'refunded', refund_status: 'approved' })
    // The connect ticket refunded on the first run is not refunded again.
    expect(stripeRefundsCreate.mock.calls.filter(([p]) => p.payment_intent === 'pi_connect')).toHaveLength(1)
  })

  it('queues a paid card ticket it cannot refund automatically instead of leaving it live', async () => {
    db.write('tickets/t_card', { charged_amount: null, charged_currency: null }, { merge: true })
    await cancelEventWithRefunds({ eventId: 'ev1', actor })
    expect(stripeRefundsCreate.mock.calls.some(([p]) => p.payment_intent === 'pi_card')).toBe(false)
    expect(ticket('t_card')).toMatchObject({ status: 'refund_pending', refund_status: 'manual_required' })
    const entry = db.docsIn('manual_refund_queue').find(([, d]) => d.ticketId === 't_card')
    expect(entry![1]).toMatchObject({ needsReview: true, amount: 1500, currency: 'HTG', transactionId: 'pi_card' })
  })
})

describe('the payout-ledger cancellation stamp fails loudly', () => {
  it('retries, then reports ledgerStampFailed — refunds still run', async () => {
    seed()
    const realCollection = db.collection.bind(db)
    let attempts = 0
    const spy = jest.spyOn(db, 'collection').mockImplementation(((name: string) => {
      const c: any = realCollection(name)
      if (name !== 'event_earnings') return c
      return {
        ...c,
        doc: (id: string) => ({
          ...c.doc(id),
          set: async () => {
            attempts++
            throw new Error('ledger unavailable')
          },
        }),
      }
    }) as any)
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const out = await cancelEventWithRefunds({ eventId: 'ev1', actor })
      expect(attempts).toBe(3)
      expect(out.ledgerStampFailed).toBe('ledger unavailable')
      expect(out.ticketsAffected).toBeGreaterThan(0)
    } finally {
      spy.mockRestore()
      errSpy.mockRestore()
    }
  })

  it('a successful stamp reports no failure', async () => {
    seed()
    const out = await cancelEventWithRefunds({ eventId: 'ev1', actor })
    expect(out.ledgerStampFailed).toBeUndefined()
    expect(db.store.get('event_earnings/ev1')).toMatchObject({ settlementStatus: 'cancelled' })
  })
})

describe('cancellation after a withdrawal', () => {
  // The organizer already took out more than the Tikèm-held sales leave after
  // the platform fee, so nothing unwithdrawn covers a Tikèm-held refund.
  function seedWithdrawn() {
    seed()
    db.write('event_earnings/ev1', { eventId: 'ev1', organizerId: 'org_1', currency: 'HTG', withdrawnAmount: 300_000 })
  }

  it("an organizer's cancellation sends what the balance cannot cover to refund_reviews", async () => {
    seedWithdrawn()
    const errSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const out = await cancelEventWithRefunds({ eventId: 'ev1', actor })
      // Tikèm-held sales (platform card, MonCash) wait for an admin; nothing moved.
      expect(out.refundsSentToReview).toBe(2)
      expect(stripeRefundsCreate.mock.calls.find(([p]) => p.payment_intent === 'pi_card')).toBeUndefined()
      expect(ticket('t_card')).toMatchObject({ refund_status: 'admin_review' })
      expect(ticket('t_moncash')).toMatchObject({ refund_status: 'admin_review' })
      expect(db.store.get('refund_reviews/t_card')).toMatchObject({ status: 'pending', event_id: 'ev1' })
      expect(db.store.get('refund_reviews/t_moncash')).toMatchObject({ status: 'pending' })
      // A destination charge comes out of the organizer's own Stripe balance: refunded.
      expect(stripeRefundsCreate.mock.calls.find(([p]) => p.payment_intent === 'pi_connect')).toBeDefined()
    } finally {
      errSpy.mockRestore()
    }
  })

  it("an admin's cancellation still refunds every buyer regardless", async () => {
    seedWithdrawn()
    const out = await cancelEventWithRefunds({ eventId: 'ev1', actor: { id: 'admin_1', isAdmin: true } })
    expect(out.refundsSentToReview).toBe(0)
    expect(stripeRefundsCreate.mock.calls.find(([p]) => p.payment_intent === 'pi_card')).toBeDefined()
    expect(db.store.get('refund_reviews/t_card')).toBeUndefined()
  })
})

describe('organizerSelfCancelBlock', () => {
  const future = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString()
  const past = new Date(Date.now() - 24 * 3_600_000).toISOString()

  it('allows an organizer before any withdrawal and before the end', async () => {
    seed()
    const event = { ...(db.store.get('events/ev1') as Doc), end_datetime: future }
    expect(await organizerSelfCancelBlock('ev1', event)).toBeNull()
  })

  it('refuses once money has been withdrawn for the event', async () => {
    seed()
    db.write('event_earnings/ev1', { eventId: 'ev1', organizerId: 'org_1', currency: 'HTG', withdrawnAmount: 1000 })
    const event = { ...(db.store.get('events/ev1') as Doc), end_datetime: future }
    expect(await organizerSelfCancelBlock('ev1', event)).toMatchObject({ status: 403, code: 'cancel_after_withdrawal' })
  })

  it('refuses a live withdrawal request even before the ledger is debited', async () => {
    seed()
    db.write('withdrawal_requests/w1', { eventId: 'ev1', status: 'pending', amount: 5000 })
    const event = { ...(db.store.get('events/ev1') as Doc), end_datetime: future }
    expect(await organizerSelfCancelBlock('ev1', event)).toMatchObject({ code: 'cancel_after_withdrawal' })
  })

  it('refuses after the event has ended', async () => {
    seed()
    const event = { ...(db.store.get('events/ev1') as Doc), end_datetime: past }
    expect(await organizerSelfCancelBlock('ev1', event)).toMatchObject({ status: 403, code: 'cancel_after_event_end' })
  })
})
