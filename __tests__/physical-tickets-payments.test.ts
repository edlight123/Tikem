/**
 * @jest-environment node
 *
 * Printed-ticket batch payments (lib/physical/payments): card amounts from the
 * guarded FX engine (never a hard-coded rate), each Checkout session verified
 * against its OWN expected amount, earlier sessions expired on restart,
 * expired sessions and stale unpaid batches cancelled (seats back), and a last
 * gateway check before the sweep cancels.
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))

const reserveSeats = jest.fn()
const releaseSeats = jest.fn()
jest.mock('@/lib/tickets/inventoryShards', () => ({
  reserveSeats: (...a: any[]) => reserveSeats(...a),
  releaseSeats: (...a: any[]) => releaseSeats(...a),
}))

const getUsdToHtgBaseRate = jest.fn()
jest.mock('@/lib/fx/usd-htg', () => ({
  getUsdToHtgBaseRate: (...a: any[]) => getUsdToHtgBaseRate(...a),
  isFxRateUnavailableError: (e: any) => e?.code === 'fx_rate_unavailable',
}))

const retrieveMonCashOrderPayment = jest.fn()
jest.mock('@/lib/moncash', () => ({ retrieveMonCashOrderPayment: (...a: any[]) => retrieveMonCashOrderPayment(...a) }))
jest.mock('@/lib/moncash-button', () => ({
  createMonCashButtonCheckoutToken: jest.fn(async () => ({ token: 'tok' })),
  getMonCashButtonRedirectUrl: (t: string) => `https://moncash.example/${t}`,
  isMonCashButtonPaidAmountAcceptable: (expected: number, cost: any) => ({
    ok: cost == null || Math.abs(Number(cost) - expected) <= 1,
    verified: cost != null,
    expected,
    paid: cost ?? null,
  }),
}))

const sessions = new Map<string, any>()
const stripeCreate = jest.fn(async (args: any) => {
  const id = `cs_${sessions.size + 1}`
  const s = { id, url: `https://stripe.example/${id}`, status: 'open', payment_status: 'unpaid', currency: 'usd', amount_total: args.line_items[0].price_data.unit_amount, metadata: args.metadata, payment_intent: `pi_${id}` }
  sessions.set(id, s)
  return s
})
const stripeExpire = jest.fn(async (id: string) => {
  sessions.get(id).status = 'expired'
})
jest.mock('stripe', () => () => ({
  checkout: {
    sessions: {
      create: (a: any) => stripeCreate(a),
      retrieve: async (id: string) => sessions.get(id),
      expire: (id: string) => stripeExpire(id),
    },
  },
}))

import { createBatch, getBatch } from '@/lib/physical/batches'
import {
  CardFxUnavailableError,
  cardSessionPaidInFull,
  expireUnpaidBatches,
  handleCardSessionExpired,
  startCardBatchPayment,
  startMonCashBatchPayment,
  verifyCardBatchPayment,
} from '@/lib/physical/payments'
import { PAYMENT_WINDOW_MS } from '@/lib/physical/rules'

const EVENT = 'ev1'
beforeEach(() => {
  db.store.clear()
  sessions.clear()
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  reserveSeats.mockReset().mockResolvedValue({ ok: true })
  releaseSeats.mockReset().mockResolvedValue({ released: true })
  getUsdToHtgBaseRate.mockReset().mockResolvedValue({ baseRate: 131.5, source: 'live', provider: 't', fetchedAtIso: '' })
  retrieveMonCashOrderPayment.mockReset()
  stripeCreate.mockClear()
  stripeExpire.mockClear()
  db.store.set(`events/${EVENT}`, { title: 'Fête', organizer_id: 'org1', currency: 'HTG' })
  db.store.set('ticket_tiers/vip', { event_id: EVENT, name: 'VIP' })
})

async function newBatch(method: 'card' | 'moncash' = 'card') {
  const r = await createBatch({ eventId: EVENT, event: db.store.get(`events/${EVENT}`)!, orgId: 'org1', tierId: 'vip', quantity: 100, method, createdBy: 'u1' })
  if (!r.ok) throw new Error(r.error)
  return r.batch
}

describe('card amount from the guarded FX engine', () => {
  it("uses fallback 'lowest' (more USD, never less) and stamps the amount on the session", async () => {
    const batch = await newBatch()
    const r = await startCardBatchPayment(batch, 'https://www.tikem.co')
    expect(getUsdToHtgBaseRate).toHaveBeenCalledWith({ fallback: 'lowest' })
    // 4000 HTG / 131.5 = 30.418… USD → 3042 cents (rounded up)
    expect(r.amountUsdCents).toBe(3042)
    const args = stripeCreate.mock.calls[0][0]
    expect(args.metadata.expectedUsdCents).toBe('3042')
    expect(args.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + 29 * 60)
    expect(args).not.toHaveProperty('payment_intent_data.transfer_data')
  })

  it('no trustworthy rate → card refused (MonCash still possible)', async () => {
    getUsdToHtgBaseRate.mockRejectedValue({ code: 'fx_rate_unavailable' })
    const batch = await newBatch()
    await expect(startCardBatchPayment(batch, 'https://x')).rejects.toBeInstanceOf(CardFxUnavailableError)
    expect(stripeCreate).not.toHaveBeenCalled()
    await expect(startMonCashBatchPayment(batch)).resolves.toMatchObject({ redirectUrl: 'https://moncash.example/tok' })
  })
})

describe('each session is verified against its own amount', () => {
  it('pure check', () => {
    const md = { expectedUsdCents: '3042' }
    expect(cardSessionPaidInFull({ payment_status: 'paid', amount_total: 3042, currency: 'usd', metadata: md })).toBe(true)
    expect(cardSessionPaidInFull({ payment_status: 'paid', amount_total: 3000, currency: 'usd', metadata: md })).toBe(false)
    expect(cardSessionPaidInFull({ payment_status: 'unpaid', amount_total: 3042, currency: 'usd', metadata: md })).toBe(false)
    expect(cardSessionPaidInFull({ payment_status: 'paid', amount_total: 3042, currency: 'usd', metadata: {} })).toBe(false)
  })

  it('a restart expires the earlier open session; an old completed session still verifies on its own amount', async () => {
    const batch = await newBatch()
    const first = await startCardBatchPayment(batch, 'https://x')
    // The rate moves; the organizer restarts.
    getUsdToHtgBaseRate.mockResolvedValue({ baseRate: 120, source: 'live', provider: 't', fetchedAtIso: '' })
    const second = await startCardBatchPayment((await getBatch(batch.id))!, 'https://x')
    expect(stripeExpire).toHaveBeenCalledWith(first.sessionId)
    expect(second.amountUsdCents).toBe(3334)
    // The first session had in fact been paid before it was expired.
    Object.assign(sessions.get(first.sessionId), { payment_status: 'paid', status: 'complete' })
    const r = await verifyCardBatchPayment(first.sessionId, batch.id)
    expect(r.paid).toBe(true)
    expect((await getBatch(batch.id))!.status).toBe('paid')
  })
})

describe('unpaid batches expire', () => {
  it('checkout.session.expired cancels only for the CURRENT session', async () => {
    const batch = await newBatch()
    const first = await startCardBatchPayment(batch, 'https://x')
    const second = await startCardBatchPayment((await getBatch(batch.id))!, 'https://x')
    expect(await handleCardSessionExpired(sessions.get(first.sessionId))).toBe(false)
    expect((await getBatch(batch.id))!.status).toBe('awaiting_payment')
    expect(await handleCardSessionExpired(sessions.get(second.sessionId))).toBe(true)
    expect((await getBatch(batch.id))!).toMatchObject({ status: 'cancelled', cancel_reason: 'card_session_expired' })
    expect(releaseSeats).toHaveBeenCalledWith(expect.objectContaining({ reservationId: `phys_${batch.id}` }))
  })

  it('the sweep cancels stale MonCash batches after one last gateway check, keeps fresh ones', async () => {
    const stale = await newBatch('moncash')
    await startMonCashBatchPayment(stale)
    const paidLate = await newBatch('moncash')
    const late = await startMonCashBatchPayment(paidLate)
    const fresh = await newBatch('moncash')
    retrieveMonCashOrderPayment.mockImplementation(async (orderId: string) =>
      orderId === late.orderId ? { success: true, cost: 4000, transactionId: 'mc1' } : { success: false, payment_status: 'pending' }
    )
    // Only the first two are past their window.
    for (const b of [stale, paidLate]) {
      db.store.set(`physical_batches/${b.id}`, { ...db.store.get(`physical_batches/${b.id}`)!, payment_expires_at: new Date(Date.now() - 1000).toISOString() })
    }
    const r = await expireUnpaidBatches()
    expect(r).toEqual({ checked: 2, cancelled: 1, paid: 1 })
    expect((await getBatch(stale.id))!.status).toBe('cancelled')
    expect((await getBatch(paidLate.id))!.status).toBe('paid')
    expect((await getBatch(fresh.id))!.status).toBe('awaiting_payment')
    expect(new Date((await getBatch(fresh.id))!.payment_expires_at).getTime()).toBeGreaterThan(Date.now() + PAYMENT_WINDOW_MS - 60_000)
  })

  it('a gateway that cannot answer keeps the batch (never cancels a possibly-paid order)', async () => {
    const b = await newBatch('moncash')
    await startMonCashBatchPayment(b)
    db.store.set(`physical_batches/${b.id}`, { ...db.store.get(`physical_batches/${b.id}`)!, payment_expires_at: new Date(0).toISOString() })
    retrieveMonCashOrderPayment.mockRejectedValue(new Error('timeout'))
    expect(await expireUnpaidBatches()).toEqual({ checked: 1, cancelled: 0, paid: 0 })
    expect((await getBatch(b.id))!.status).toBe('awaiting_payment')
  })
})

describe('an expired card session never cancels a live batch', () => {
  it('retry: the new session id is saved BEFORE the old one is expired', async () => {
    const batch = await newBatch()
    const first = await startCardBatchPayment(batch, 'https://x')
    let idAtExpiry: string | null = null
    stripeExpire.mockImplementationOnce(async (id: string) => {
      idAtExpiry = db.store.get(`physical_batches/${batch.id}`)!.payment.stripe_session_id
      sessions.get(id).status = 'expired'
    })
    const second = await startCardBatchPayment((await getBatch(batch.id))!, 'https://x')
    expect(idAtExpiry).toBe(second.sessionId)
    expect(await handleCardSessionExpired(sessions.get(first.sessionId))).toBe(false)
    expect((await getBatch(batch.id))!.status).toBe('awaiting_payment')
  })

  it('card then MonCash: the card session is cleared and expired, and its expiry cancels nothing', async () => {
    const batch = await newBatch()
    const card = await startCardBatchPayment(batch, 'https://x')
    await startMonCashBatchPayment((await getBatch(batch.id))!)
    const b = (await getBatch(batch.id))!
    expect(b.payment.stripe_session_id).toBeNull()
    expect(b.payment.method).toBe('moncash')
    expect(stripeExpire).toHaveBeenCalledWith(card.sessionId)
    expect(await handleCardSessionExpired(sessions.get(card.sessionId))).toBe(false)
    expect((await getBatch(batch.id))!.status).toBe('awaiting_payment')
  })

  it('the handler also requires the batch to be on card', async () => {
    const batch = await newBatch()
    const card = await startCardBatchPayment(batch, 'https://x')
    // Someone switched the method without clearing the id (older data).
    db.store.set(`physical_batches/${batch.id}`, { ...db.store.get(`physical_batches/${batch.id}`)!, payment: { ...db.store.get(`physical_batches/${batch.id}`)!.payment, method: 'moncash' } })
    expect(await handleCardSessionExpired(sessions.get(card.sessionId))).toBe(false)
    expect((await getBatch(batch.id))!.status).toBe('awaiting_payment')
  })
})
