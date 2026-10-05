/**
 * lib/tickets/stripe-fulfillment: the one pipeline behind the Stripe webhook and
 * the client-confirm route.
 *
 * @jest-environment node
 */

import { createFakeFirestore } from './helpers/fakeFirestoreTracking'

const mockFake = createFakeFirestore()
const mockInventory = { ok: true as boolean }
const mockRefund = { success: true as boolean, error: undefined as string | undefined }

jest.mock('@/lib/firebase/admin', () => ({ adminDb: mockFake.db }))
jest.mock('firebase-admin/firestore', () => require('./helpers/fakeFirestoreTracking').fieldValueModule)
jest.mock('@/lib/earnings', () => ({ addTicketToEarnings: jest.fn(async () => undefined) }))
jest.mock('@/lib/tickets/confirmation', () => ({ sendTicketConfirmation: jest.fn(async () => ({})) }))
jest.mock('@/lib/notifications/helpers', () => ({
  notifyTicketPurchase: jest.fn(async () => undefined),
  notifyOrganizerTicketSale: jest.fn(async () => undefined),
}))
jest.mock('@/lib/notifications/campaigns', () => ({ onSaleCompleted: jest.fn(async () => undefined) }))
jest.mock('@/lib/tracking-links', () => ({ recordAttributedSale: jest.fn(async () => null) }))
jest.mock('@/lib/guest/identity', () => ({ attachTicketsToGuestOrder: jest.fn(async () => undefined) }))
jest.mock('@/lib/tickets/inventory', () => ({
  buildTierSoldIncrements: jest.fn(() => []),
  reserveInventoryAtomic: jest.fn(async () => (mockInventory.ok ? { ok: true } : { ok: false, reason: 'event_capacity' })),
}))
jest.mock('@/lib/refunds', () => ({
  isDestinationCharge: jest.fn(async () => null),
  processStripeRefund: jest.fn(async () =>
    mockRefund.success ? { success: true, refundId: 're_1' } : { success: false, error: mockRefund.error }
  ),
}))
jest.mock('@/lib/tickets/refundExecution', () => ({ reversePromoterCommission: jest.fn(async () => true) }))

/* eslint-disable @typescript-eslint/no-var-requires */
const { addTicketToEarnings } = require('@/lib/earnings')
const { reserveInventoryAtomic } = require('@/lib/tickets/inventory')
const { processStripeRefund } = require('@/lib/refunds')
const { sendTicketConfirmation } = require('@/lib/tickets/confirmation')
const {
  applyStripeChargeRefund,
  deterministicTicketId,
  fulfillStripeOrder,
} = require('@/lib/tickets/stripe-fulfillment') as typeof import('@/lib/tickets/stripe-fulfillment')
type StripeOrderInput = import('@/lib/tickets/stripe-fulfillment').StripeOrderInput

function order(over: Partial<StripeOrderInput> = {}, md: Record<string, any> = {}): StripeOrderInput {
  return {
    source: 'payment_intent',
    paymentId: 'pi_1',
    paymentIntentId: 'pi_1',
    metadata: {
      eventId: 'evt1',
      userId: 'u1',
      quantity: '2',
      originalCurrency: 'EUR',
      priceInOriginalCurrency: '20',
      finalPrice: '20',
      ...md,
    },
    buyerId: 'u1',
    guestRecipient: null,
    amountTotalCents: 4400,
    chargedCurrency: 'eur',
    destinationCharge: false,
    logPrefix: '[test]',
    ...over,
  }
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

beforeEach(() => {
  jest.clearAllMocks()
  mockFake.reset()
  mockInventory.ok = true
  mockRefund.success = true
  mockRefund.error = undefined
  mockFake.seed('events', 'evt1', { title: 'Soirée', organizer_id: 'org1', currency: 'EUR' })
  mockFake.seed('users', 'u1', { email: 'u@x.com', full_name: 'U' })
})

const tickets = () => mockFake.all('tickets').map(([id, d]) => ({ id, ...d }))

describe('issuance', () => {
  it('issues deterministic tickets, keeps EUR, books earnings once', async () => {
    const res = await fulfillStripeOrder(order())
    expect(res.outcome).toBe('fulfilled')
    const ids = [deterministicTicketId('pi_1', 0), deterministicTicketId('pi_1', 1)]
    expect(tickets().map((t) => t.id).sort()).toEqual(ids.sort())
    for (const t of tickets()) {
      expect(t.currency).toBe('EUR')
      expect(t.original_currency).toBe('EUR')
      expect(t.attendee_id).toBe('u1')
      expect(t.user_id).toBe('u1')
      expect(t.qr_code_data).toBe(t.id)
      expect(t.status).toBe('valid')
    }
    expect(addTicketToEarnings).toHaveBeenCalledTimes(1)
    expect((addTicketToEarnings as jest.Mock).mock.calls[0][1]).toBe(4000)
    expect((addTicketToEarnings as jest.Mock).mock.calls[0][3].currency).toBe('EUR')
  })

  it('ticket ids are not derivable from the PaymentIntent id alone', () => {
    expect(deterministicTicketId('pi_1', 1)).not.toBe('pi_1_1')
    expect(deterministicTicketId('pi_1', 1)).toBe(deterministicTicketId('pi_1', 1))
  })

  it('a re-run (stale claim, redelivery, other path) never issues or books twice', async () => {
    await fulfillStripeOrder(order())
    const again = await fulfillStripeOrder(order({ source: 'client_confirm' }))
    expect(again).toEqual(expect.objectContaining({ outcome: 'fulfilled', alreadyFulfilled: true }))
    expect(tickets()).toHaveLength(2)
    expect(reserveInventoryAtomic).toHaveBeenCalledTimes(1)
    expect(addTicketToEarnings).toHaveBeenCalledTimes(1)
    expect(sendTicketConfirmation).toHaveBeenCalledTimes(1)
  })

  it('a re-run after the ledger lost its status still does not double anything', async () => {
    await fulfillStripeOrder(order())
    const ledger = mockFake.get('stripe_orders', 'pi_1')!
    mockFake.seed('stripe_orders', 'pi_1', { ...ledger, status: 'issued' })
    await fulfillStripeOrder(order())
    expect(tickets()).toHaveLength(2)
    expect(reserveInventoryAtomic).toHaveBeenCalledTimes(1)
    expect(addTicketToEarnings).toHaveBeenCalledTimes(1)
  })

  it('adopts tickets issued by the pre-ledger pipeline instead of issuing a second set', async () => {
    mockFake.seed('tickets', 'legacyA', { payment_id: 'pi_1', event_id: 'evt1', status: 'valid' })
    const res = await fulfillStripeOrder(order())
    expect(res).toEqual(expect.objectContaining({ outcome: 'fulfilled', ticketIds: ['legacyA'] }))
    expect(tickets()).toHaveLength(1)
    expect(reserveInventoryAtomic).not.toHaveBeenCalled()
  })

  it('a failed bookkeeping step reports partial and the retry finishes only that step', async () => {
    ;(addTicketToEarnings as jest.Mock).mockRejectedValueOnce(new Error('ledger down'))
    const first = await fulfillStripeOrder(order())
    expect(first.outcome).toBe('partial')
    expect(tickets()).toHaveLength(2)

    const second = await fulfillStripeOrder(order())
    expect(second.outcome).toBe('fulfilled')
    expect(tickets()).toHaveLength(2)
    expect(reserveInventoryAtomic).toHaveBeenCalledTimes(1)
    expect(addTicketToEarnings).toHaveBeenCalledTimes(2)
    expect(sendTicketConfirmation).toHaveBeenCalledTimes(1)
  })
})

describe('promoter commission', () => {
  beforeEach(() => {
    mockFake.seed('event_promoters', 'p1', {
      event_id: 'evt1',
      organizer_id: 'org1',
      code: 'STEEVE',
      commission_type: 'percentage',
      commission_value: 10,
    })
  })

  it('platform charge: funded row, commission withheld from the organizer', async () => {
    await fulfillStripeOrder(order({}, { promoterId: 'p1' }))
    const [[, sale]] = mockFake.all('promoter_sales')
    expect(sale.funded).toBe(true)
    expect((addTicketToEarnings as jest.Mock).mock.calls[0][3].promoterCommissionCents).toBe(400)
  })

  it('destination (Connect) charge: unfunded row, nothing withheld', async () => {
    await fulfillStripeOrder(order({ destinationCharge: true }, { promoterId: 'p1', payoutProvider: 'stripe_connect' }))
    const [[, sale]] = mockFake.all('promoter_sales')
    expect(sale.funded).toBe(false)
    expect((addTicketToEarnings as jest.Mock).mock.calls[0][3].promoterCommissionCents).toBe(0)
    expect((addTicketToEarnings as jest.Mock).mock.calls[0][3].paymentMethod).toBe('stripe_connect')
  })

  it('records the promoter sale once across re-runs', async () => {
    await fulfillStripeOrder(order({}, { promoterId: 'p1' }))
    await fulfillStripeOrder(order({}, { promoterId: 'p1' }))
    expect(mockFake.all('promoter_sales')).toHaveLength(1)
  })
})

describe('promoter step in reconcile', () => {
  it('defers earnings (needs_reconcile) instead of booking them with 0 commission', async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    mockFake.seed('stripe_orders', 'pi_1', {
      steps: { inventory: { started_at: old, done_at: old }, promoter: { started_at: old } },
    })
    const res = await fulfillStripeOrder(order({}, { promoterId: 'p1' }))
    expect(tickets()).toHaveLength(2)
    expect(addTicketToEarnings).not.toHaveBeenCalled()
    const ledger = mockFake.get('stripe_orders', 'pi_1')!
    expect(ledger.needs_reconcile).toBe(true)
    expect(ledger.reconcile_promoter).toBe(true)
    expect(ledger.reconcile_earnings).toBe(true)
    expect(res.outcome).toBe('fulfilled')

    // A later run sees the promoter step settled as unconfirmed: still deferred.
    mockFake.seed('stripe_orders', 'pi_1', { ...mockFake.get('stripe_orders', 'pi_1')!, status: 'issued' })
    await fulfillStripeOrder(order({}, { promoterId: 'p1' }))
    expect(addTicketToEarnings).not.toHaveBeenCalled()
  })
})

describe('metadata quantity is validated, never clamped', () => {
  it.each(['0.01', '1.5', '0', '-1', '51', 'abc', '1e1'])('refunds a paid intent for quantity %p and issues nothing', async (q) => {
    const res = await fulfillStripeOrder(order({}, { quantity: q }))
    expect(res.outcome).toBe('capacity_refunded')
    expect(tickets()).toHaveLength(0)
    expect(reserveInventoryAtomic).not.toHaveBeenCalled()
    expect(addTicketToEarnings).not.toHaveBeenCalled()
    expect(processStripeRefund).toHaveBeenCalledTimes(1)
    const ledger = mockFake.get('stripe_orders', 'pi_1')!
    expect(ledger.refund_reason).toBe('invalid_quantity')
    expect(ledger.status).toBe('refunded_capacity')
  })

  it('a failed refund of an invalid-quantity order stays flagged needs_refund and is retried as a refund', async () => {
    mockRefund.success = false
    mockRefund.error = 'stripe down'
    const res = await fulfillStripeOrder(order({}, { quantity: '0.01' }))
    expect(res.outcome).toBe('refund_failed')
    expect(mockFake.get('stripe_orders', 'pi_1')!.needs_refund).toBe(true)
    mockRefund.success = true
    expect((await fulfillStripeOrder(order({}, { quantity: '0.01' }))).outcome).toBe('capacity_refunded')
    expect(mockFake.get('stripe_orders', 'pi_1')!.refund_reason).toBe('invalid_quantity')
    expect(tickets()).toHaveLength(0)
  })

  it('metadata with no quantity at all (pre-field intents) is one ticket', async () => {
    const res = await fulfillStripeOrder(order({ amountTotalCents: 2200 }, { quantity: undefined }))
    expect(res.outcome).toBe('fulfilled')
    expect(tickets()).toHaveLength(1)
  })
})

describe('promo redemption', () => {
  it('passes the buyer key so a per-buyer cap counts the order', async () => {
    mockFake.seed('promo_codes', 'promo1', { event_id: 'evt1', code: 'X', max_uses: 10, uses_count: 0, max_uses_per_user: 1 })
    await fulfillStripeOrder(order({}, { promoCodeId: 'promo1', quantity: '1', originalPrice: '25', finalPrice: '20' }))
    expect(mockFake.get('promo_codes', 'promo1')!.uses_count).toBe(1)
    const [[, usage]] = mockFake.all('promo_code_usage')
    expect(usage.buyer_key).toBe('uid:u1')
  })
})

describe('sold out after payment', () => {
  it('refunds with reverse_transfer on a destination charge and an idempotency key', async () => {
    mockInventory.ok = false
    const res = await fulfillStripeOrder(order({ destinationCharge: true }))
    expect(res.outcome).toBe('capacity_refunded')
    expect(processStripeRefund).toHaveBeenCalledWith('pi_1', undefined, {
      reverseTransfer: true,
      refundApplicationFee: true,
      idempotencyKey: 'tikem-capacity-refund-pi_1',
    })
    expect(tickets()).toHaveLength(0)
  })

  it('a failed refund is flagged needs_refund, not marked done, and retried (never re-gated)', async () => {
    mockInventory.ok = false
    mockRefund.success = false
    mockRefund.error = 'stripe down'
    const res = await fulfillStripeOrder(order())
    expect(res).toEqual({ outcome: 'refund_failed', error: 'stripe down' })
    const ledger = mockFake.get('stripe_orders', 'pi_1')!
    expect(ledger.needs_refund).toBe(true)
    expect(ledger.refund_error).toBe('stripe down')
    expect(ledger.status).not.toBe('fulfilled')

    // Capacity frees up — the order still refunds, it does not issue.
    mockInventory.ok = true
    mockRefund.success = true
    const retry = await fulfillStripeOrder(order())
    expect(retry.outcome).toBe('capacity_refunded')
    expect(reserveInventoryAtomic).toHaveBeenCalledTimes(1)
    expect(tickets()).toHaveLength(0)
    expect(mockFake.get('stripe_orders', 'pi_1')!.needs_refund).toBe(false)
  })
})

describe('charge.refunded', () => {
  const seedTickets = () => {
    mockFake.seed('tickets', 't0', { payment_id: 'pi_9', status: 'valid', charged_amount: 20, charged_currency: 'USD' })
    mockFake.seed('tickets', 't1', { payment_id: 'pi_9', status: 'valid', charged_amount: 20, charged_currency: 'USD' })
  }

  it('a full refund voids every live ticket and is idempotent', async () => {
    seedTickets()
    const charge = { payment_intent: 'pi_9', amount: 4000, amount_refunded: 4000, refunded: true, refunds: { data: [{ id: 're_9' }] } }
    const res = await applyStripeChargeRefund(charge)
    expect(res.markedRefunded.sort()).toEqual(['t0', 't1'])
    expect(mockFake.get('tickets', 't0')).toEqual(
      expect.objectContaining({ status: 'refunded', refund_status: 'approved', refund_id: 're_9', refund_amount: 20 })
    )
    const again = await applyStripeChargeRefund(charge)
    expect(again.markedRefunded).toEqual([])
  })

  it('a partial refund of one ticket voids exactly one, leaving tickets Tikèm already refunded alone', async () => {
    seedTickets()
    const first = await applyStripeChargeRefund({ payment_intent: 'pi_9', amount: 4000, amount_refunded: 2000, refunded: false })
    expect(first.markedRefunded).toHaveLength(1)
    expect(first.unallocatedCents).toBe(0)
    const live = ['t0', 't1'].filter((id) => mockFake.get('tickets', id)!.status === 'valid')
    expect(live).toHaveLength(1)
  })

  it('an organizer refund in flight is not double-marked', async () => {
    mockFake.seed('tickets', 't0', { payment_id: 'pi_9', status: 'valid', refund_status: 'processing' })
    mockFake.seed('tickets', 't1', { payment_id: 'pi_9', status: 'valid' })
    const res = await applyStripeChargeRefund({ payment_intent: 'pi_9', amount: 4000, amount_refunded: 2000, refunded: false })
    expect(res.markedRefunded).toEqual([])
    expect(mockFake.get('tickets', 't1')!.status).toBe('valid')
  })

  it('records an amount that is not a whole ticket for reconciliation', async () => {
    seedTickets()
    const res = await applyStripeChargeRefund({ payment_intent: 'pi_9', amount: 4000, amount_refunded: 500, refunded: false })
    expect(res.markedRefunded).toEqual([])
    expect(res.unallocatedCents).toBe(500)
    expect(mockFake.get('stripe_orders', 'pi_9')!.needs_reconcile).toBe(true)
  })
})
