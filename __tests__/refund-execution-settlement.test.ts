/**
 * @jest-environment node
 *
 * lib/tickets/refundExecution.ts — what happens AFTER the money decision:
 *  - once Stripe accepts a refund, a failed Firestore write must never release
 *    the claim (that left a refunded ticket live and re-refundable); the ticket
 *    is flagged and a refund_reconciliation doc is written;
 *  - promoter commission is reversed on refunded and queued outcomes;
 *  - a queued mobile-money refund emails the admins (unless batched).
 * Plus the admin queue's mark paid / mark failed transitions.
 */

import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))

const processStripeRefund = jest.fn()
jest.mock('@/lib/refunds', () => ({
  isDestinationCharge: async () => false,
  processStripeRefund: (...args: any[]) => processStripeRefund(...args),
}))

const reversePromoterSaleForTicket = jest.fn(async (_id: string) => true)
jest.mock('@/lib/promoters', () => ({
  reversePromoterSaleForTicket: (id: string) => reversePromoterSaleForTicket(id),
}))

const sendEmail = jest.fn(async (_args: any) => ({ success: true }))
jest.mock('@/lib/email', () => ({
  sendEmail: (args: any) => sendEmail(args),
}))
jest.mock('@/lib/admin', () => ({
  getAdminEmails: () => ['ops@example.com'],
}))

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

import { refundTicket } from '@/lib/tickets/refundExecution'
import {
  listReconciliation,
  listStripeOrderFlags,
  resolveReconciliation,
  resolveRefundQueueItem,
  resolveStripeOrderFlag,
} from '@/lib/tickets/manualRefundQueue'

const event = { id: 'ev1', title: 'Rara Fest', organizer_id: 'org_1' }
const ticket = (id: string) => db.store.get(`tickets/${id}`) as Record<string, any>

beforeEach(() => {
  db.store.clear()
  processStripeRefund.mockReset()
  processStripeRefund.mockResolvedValue({ success: true, refundId: 're_1' })
  reversePromoterSaleForTicket.mockClear()
  sendEmail.mockClear()
  db.write('tickets/t_card', {
    event_id: 'ev1',
    status: 'valid',
    payment_method: 'stripe',
    payment_id: 'pi_card',
    price_paid: 25,
    charged_amount: 27,
    charged_currency: 'USD',
  })
  db.write('tickets/t_moncash', {
    event_id: 'ev1',
    status: 'confirmed',
    payment_method: 'moncash',
    payment_id: 'mc_1',
    attendee_id: 'buyer_1',
    price_paid: 2000,
    charged_amount: 2000,
    charged_currency: 'HTG',
  })
})

describe('refundTicket after Stripe accepts the refund', () => {
  it('records the refund and reverses promoter commission', async () => {
    const res = await refundTicket('t_card', { reason: 'organizer_refund', actorId: 'org_1', event, onFailure: 'release' })
    expect(res.outcome).toBe('refunded')
    expect(ticket('t_card')).toMatchObject({ status: 'refunded', refund_status: 'approved', refund_id: 're_1' })
    expect(reversePromoterSaleForTicket).toHaveBeenCalledWith('t_card')
  })

  it('never releases the claim when the write after a successful Stripe refund fails', async () => {
    // Fail every plain ref.set on the ticket after the claim (the claim is a tx write).
    const realRef = db.ref.bind(db)
    jest.spyOn(db, 'ref').mockImplementation((path: string) => {
      const r = realRef(path)
      if (path === 'tickets/t_card') {
        r.set = async () => {
          throw new Error('firestore unavailable')
        }
      }
      return r
    })

    const res = await refundTicket('t_card', { reason: 'organizer_refund', actorId: 'org_1', event, onFailure: 'release' })
    ;(db.ref as jest.Mock).mockRestore()

    expect(res).toMatchObject({ outcome: 'refunded', recordFailed: true, refundId: 're_1' })
    // The claim from the transaction is still there: not released back to live/retryable.
    expect(ticket('t_card').refund_status).toBe('processing')
    expect(db.store.get('refund_reconciliation/t_card')).toMatchObject({
      ticketId: 't_card',
      refundId: 're_1',
      resolved: false,
    })
    expect(processStripeRefund).toHaveBeenCalledTimes(1)
  })

  it('still releases the claim when Stripe itself refuses', async () => {
    processStripeRefund.mockResolvedValue({ success: false, error: 'card_declined' })
    const res = await refundTicket('t_card', { reason: 'organizer_refund', actorId: 'org_1', event, onFailure: 'release' })
    expect(res.outcome).toBe('failed')
    expect(ticket('t_card').refund_status).toBeNull()
    expect(reversePromoterSaleForTicket).not.toHaveBeenCalled()
  })
})

describe('refundTicket for mobile money', () => {
  it('queues, reverses commission and emails the admins', async () => {
    const res = await refundTicket('t_moncash', { reason: 'organizer_refund', actorId: 'org_1', event, onFailure: 'release' })
    expect(res.outcome).toBe('queued')
    expect(db.store.get('manual_refund_queue/ticket_t_moncash')).toMatchObject({ status: 'pending', amount: 2000 })
    expect(reversePromoterSaleForTicket).toHaveBeenCalledWith('t_moncash')
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: 'ops@example.com' })
    expect(sendEmail.mock.calls[0][0].html).toContain('/admin/money/refunds')
  })

  it('skips the per-ticket email when the caller batches it', async () => {
    await refundTicket('t_moncash', {
      reason: 'event_cancelled',
      actorId: 'org_1',
      event,
      onFailure: 'hold',
      cancellation: true,
      notifyAdmins: false,
    })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('resolveRefundQueueItem', () => {
  beforeEach(async () => {
    await refundTicket('t_moncash', { reason: 'organizer_refund', actorId: 'org_1', event, onFailure: 'release' })
    db.write('pending_transactions/pt_1', { order_id: 'o1', amount: 500, currency: 'HTG', needs_refund: true })
    db.write('pending_transactions/pt_2', { order_id: 'o2', amount: 500, currency: 'HTG', status: 'failed' })
  })

  it('marks a ticket item paid and finishes the ticket as refunded', async () => {
    await resolveRefundQueueItem({ kind: 'ticket', id: 'ticket_t_moncash', action: 'paid', actorId: 'admin_1', note: 'MC ref 123' })
    expect(db.store.get('manual_refund_queue/ticket_t_moncash')).toMatchObject({
      status: 'paid',
      resolvedBy: 'admin_1',
      resolutionNote: 'MC ref 123',
    })
    expect(ticket('t_moncash')).toMatchObject({ status: 'refunded', refund_status: 'approved' })
  })

  it('failed → paid is allowed, paid is final', async () => {
    await resolveRefundQueueItem({ kind: 'ticket', id: 'ticket_t_moncash', action: 'failed', actorId: 'admin_1' })
    expect(ticket('t_moncash').status).toBe('refund_pending')
    await expect(
      resolveRefundQueueItem({ kind: 'ticket', id: 'ticket_t_moncash', action: 'failed', actorId: 'admin_1' })
    ).rejects.toMatchObject({ status: 409 })
    await resolveRefundQueueItem({ kind: 'ticket', id: 'ticket_t_moncash', action: 'paid', actorId: 'admin_1' })
    await expect(
      resolveRefundQueueItem({ kind: 'ticket', id: 'ticket_t_moncash', action: 'paid', actorId: 'admin_1' })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('marks an unhonored order paid, and refuses an order not owed a refund', async () => {
    await resolveRefundQueueItem({ kind: 'order', id: 'pt_1', action: 'paid', actorId: 'admin_1' })
    expect(db.store.get('pending_transactions/pt_1')).toMatchObject({ refund_queue_status: 'paid', needs_refund: true })
    await expect(
      resolveRefundQueueItem({ kind: 'order', id: 'pt_2', action: 'paid', actorId: 'admin_1' })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('404s an unknown item', async () => {
    await expect(
      resolveRefundQueueItem({ kind: 'ticket', id: 'nope', action: 'paid', actorId: 'admin_1' })
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('refund reconciliation records', () => {
  it('resolving applies the intended refund to a ticket still on its claim', async () => {
    const realRef = db.ref.bind(db)
    const spy = jest.spyOn(db, 'ref').mockImplementation((path: string) => {
      const r = realRef(path)
      if (path === 'tickets/t_card') {
        r.set = async () => {
          throw new Error('firestore unavailable')
        }
      }
      return r
    })
    await refundTicket('t_card', { reason: 'organizer_refund', actorId: 'org_1', event, onFailure: 'release' })
    spy.mockRestore()

    const open = await listReconciliation()
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ ticketId: 't_card', refundId: 're_1', ticketRefundStatus: 'processing' })

    const res = await resolveReconciliation({ ticketId: 't_card', actorId: 'admin_1', note: 'checked in Stripe' })
    expect(res.appliedToTicket).toBe(true)
    expect(ticket('t_card')).toMatchObject({
      status: 'refunded',
      refund_status: 'approved',
      refund_id: 're_1',
      refund_needs_reconciliation: false,
    })
    expect(await listReconciliation()).toHaveLength(0)
    await expect(resolveReconciliation({ ticketId: 't_card', actorId: 'admin_1' })).rejects.toMatchObject({ status: 409 })
  })
})

describe('flagged stripe_orders', () => {
  beforeEach(() => {
    db.write('events/ev1', { title: 'Rara Fest' })
    db.write('stripe_orders/pi_a', { status: 'refund_failed', needs_refund: true, refund_error: 'card_declined' })
    db.write('stripe_orders/pi_b', { status: 'fulfilled', event_id: 'ev1', needs_reconcile: true, reconcile_promoter: true })
    db.write('stripe_orders/pi_c', { status: 'fulfilled', event_id: 'ev1', refund_unallocated_cents: 500, needs_reconcile: true })
    db.write('stripe_orders/pi_ok', { status: 'fulfilled', event_id: 'ev1', needs_refund: false, refund_unallocated_cents: 0 })
  })

  it('lists each flagged order once, with what is wrong', async () => {
    const items = await listStripeOrderFlags()
    expect(items.map((i) => i.paymentId).sort()).toEqual(['pi_a', 'pi_b', 'pi_c'])
    const b = items.find((i) => i.paymentId === 'pi_b')!
    expect(b).toMatchObject({ needsReconcile: true, reconcileSteps: ['promoter'], eventTitle: 'Rara Fest' })
    expect(items.find((i) => i.paymentId === 'pi_c')!.unallocatedCents).toBe(500)
  })

  it('mark resolved clears the flags but never the order status', async () => {
    await resolveStripeOrderFlag({ paymentId: 'pi_a', actorId: 'admin_1', note: 'refunded in dashboard' })
    await resolveStripeOrderFlag({ paymentId: 'pi_b', actorId: 'admin_1' })
    await resolveStripeOrderFlag({ paymentId: 'pi_c', actorId: 'admin_1' })
    expect(db.store.get('stripe_orders/pi_a')).toMatchObject({ status: 'refund_failed', needs_refund: false })
    expect(db.store.get('stripe_orders/pi_b')).toMatchObject({ needs_reconcile: false, reconcile_promoter: false })
    expect(db.store.get('stripe_orders/pi_c')).toMatchObject({ refund_unallocated_resolved_cents: 500 })
    expect(await listStripeOrderFlags()).toHaveLength(0)
    await expect(resolveStripeOrderFlag({ paymentId: 'pi_ok', actorId: 'admin_1' })).rejects.toMatchObject({ status: 409 })
    await expect(resolveStripeOrderFlag({ paymentId: 'missing', actorId: 'admin_1' })).rejects.toMatchObject({ status: 404 })
  })

  it('a later unallocated refund on a resolved order reappears', async () => {
    await resolveStripeOrderFlag({ paymentId: 'pi_c', actorId: 'admin_1' })
    db.write('stripe_orders/pi_c', { refund_unallocated_cents: 900 }, { merge: true })
    const items = await listStripeOrderFlags()
    expect(items.find((i) => i.paymentId === 'pi_c')!.unallocatedCents).toBe(400)
  })
})
