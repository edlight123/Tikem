import { planTicketRefund, sumRefundsByCurrency } from '@/lib/tickets/refundPlan'
import { computeEventAnalytics, groupOrders, toTicketRow } from '@/lib/organizer/eventOrders'

describe('planTicketRefund', () => {
  it('refunds a Stripe sale in the CHARGED currency, not the HTG face value', () => {
    const plan = planTicketRefund({
      status: 'valid',
      payment_method: 'stripe',
      payment_id: 'pi_123',
      price_paid: 1500,
      currency: 'HTG',
      charged_amount: 11.5,
      charged_currency: 'USD',
    })
    expect(plan).toEqual({ eligible: true, rail: 'stripe', amount: 11.5, currency: 'USD', paymentRef: 'pi_123', feePolicy: 'retained', buyerFee: 0 })
  })

  it('marks destination charges as stripe_connect', () => {
    const plan = planTicketRefund({
      status: 'confirmed',
      payment_method: 'stripe_connect',
      payment_id: 'pi_9',
      price_paid: 20,
      currency: 'USD',
    })
    expect(plan).toMatchObject({ eligible: true, rail: 'stripe_connect', amount: 20, currency: 'USD' })
  })

  it('refuses a Stripe ticket with no PaymentIntent, or an HTG one with no charged amount', () => {
    expect(planTicketRefund({ status: 'valid', payment_method: 'stripe', price_paid: 10, currency: 'USD' })).toEqual({
      eligible: false,
      reason: 'no_payment_reference',
    })
    expect(
      planTicketRefund({ status: 'valid', payment_method: 'stripe', payment_id: 'pi_1', price_paid: 1500, currency: 'HTG' })
    ).toEqual({ eligible: false, reason: 'amount_unknown' })
  })

  it('queues MonCash and SogePay for manual payout in HTG', () => {
    for (const method of ['moncash', 'natcash', 'sogepay']) {
      expect(
        planTicketRefund({ status: 'confirmed', payment_method: method, price_paid: 2000, currency: 'HTG', transaction_id: 't1' })
      ).toEqual({ eligible: true, rail: 'manual', amount: 2000, currency: 'HTG', paymentRef: 't1', feePolicy: 'retained', buyerFee: 0 })
    }
  })

  it('accepts every live status and refuses the rest', () => {
    for (const status of ['valid', 'confirmed', 'active', '']) {
      expect(planTicketRefund({ status, payment_method: 'moncash', price_paid: 100 }).eligible).toBe(true)
    }
    expect(planTicketRefund({ status: 'refunded', payment_method: 'moncash', price_paid: 100 })).toEqual({
      eligible: false,
      reason: 'already_refunded',
    })
    expect(planTicketRefund({ status: 'refund_pending', payment_method: 'moncash', price_paid: 100 })).toEqual({
      eligible: false,
      reason: 'refund_in_progress',
    })
    expect(planTicketRefund({ status: 'cancelled', payment_method: 'moncash', price_paid: 100 })).toEqual({
      eligible: false,
      reason: 'not_live',
    })
    expect(
      planTicketRefund({ status: 'valid', refund_status: 'processing', payment_method: 'moncash', price_paid: 100 })
    ).toEqual({ eligible: false, reason: 'refund_in_progress' })
  })

  it('refuses free and comp tickets', () => {
    expect(planTicketRefund({ status: 'valid', payment_method: 'free', price_paid: 0 })).toEqual({ eligible: false, reason: 'free' })
    expect(planTicketRefund({ status: 'valid', source: 'comp', price_paid: 0 })).toEqual({ eligible: false, reason: 'free' })
  })

  it('never sums across currencies', () => {
    const totals = sumRefundsByCurrency([
      { eligible: true, rail: 'manual', amount: 1000, currency: 'HTG', paymentRef: null },
      { eligible: true, rail: 'stripe', amount: 10, currency: 'USD', paymentRef: 'pi_1' },
      { eligible: true, rail: 'manual', amount: 500, currency: 'HTG', paymentRef: null },
    ])
    expect(totals).toEqual([
      { currency: 'HTG', amount: 1500 },
      { currency: 'USD', amount: 10 },
    ])
  })
})

describe('groupOrders / computeEventAnalytics', () => {
  const ticket = (id: string, extra: Record<string, any>) =>
    toTicketRow(
      id,
      {
        event_id: 'e1',
        status: 'valid',
        price_paid: 1000,
        currency: 'HTG',
        payment_method: 'moncash',
        purchased_at: '2026-09-01T10:00:00.000Z',
        tier_name: 'GA',
        tier_id: 'ga',
        ...extra,
      },
      extra.attendee_id === 'u1' ? { full_name: 'Ana', email: 'ana@x.co', default_city: 'Port-au-Prince' } : null,
      'HTG'
    )

  const rows = [
    ticket('t1', { attendee_id: 'u1', payment_id: 'mc_1' }),
    ticket('t2', { attendee_id: 'u1', payment_id: 'mc_1', tier_name: 'VIP', tier_id: 'vip', price_paid: 3000 }),
    ticket('t3', {
      attendee_id: 'guest_9',
      is_guest: true,
      attendee_name: 'Guest',
      guest_email: 'g@x.co',
      payment_id: 'mc_2',
      status: 'confirmed',
      checked_in_at: '2026-09-02T20:00:00.000Z',
      purchased_at: '2026-09-02T10:00:00.000Z',
    }),
    ticket('t4', { attendee_id: 'u2', payment_id: 'mc_3', status: 'refunded' }),
  ]

  it('groups tickets bought together and keeps quantity, tiers and per-currency amounts', () => {
    const orders = groupOrders(rows)
    const ana = orders.find((o) => o.id === 'mc_1')!
    expect(ana.quantity).toBe(2)
    expect(ana.buyer).toEqual({ name: 'Ana', email: 'ana@x.co', city: 'Port-au-Prince' })
    expect(ana.amounts).toEqual([{ currency: 'HTG', amount: 4000 }])
    expect(ana.tiers).toEqual(
      expect.arrayContaining([
        { name: 'GA', count: 1 },
        { name: 'VIP', count: 1 },
      ])
    )
    expect(ana.refund.eligibleTicketIds).toEqual(['t1', 't2'])
    expect(ana.refund.totals).toEqual([{ currency: 'HTG', amount: 4000 }])
    expect(orders.find((o) => o.id === 'mc_3')!.status).toBe('refunded')
    // Newest first.
    expect(orders[0].id).toBe('mc_2')
  })

  it('counts live tickets only (valid, confirmed, active), with check-in rate and cities', () => {
    const a = computeEventAnalytics(rows, 100)
    expect(a.ticketsSold).toBe(3)
    expect(a.checkedIn).toBe(1)
    expect(a.checkInRate).toBeCloseTo(1 / 3)
    expect(a.revenue).toEqual([{ currency: 'HTG', amount: 5000 }])
    expect(a.tiers[0]).toMatchObject({ name: 'GA', sold: 2 })
    expect(a.cities).toEqual([{ city: 'Port-au-Prince', buyers: 1 }])
    expect(a.buyersWithoutCity).toBe(1)
    expect(a.salesByDay).toEqual([
      { date: '2026-09-01', count: 2 },
      { date: '2026-09-02', count: 1 },
    ])
  })
})

describe('printed tickets in orders and analytics', () => {
  const printed = (id: string, extra: Record<string, any>) =>
    toTicketRow(
      id,
      {
        kind: 'physical',
        source: 'physical',
        physical_batch_id: 'b1',
        physical_serial: `FETE-VIP-B1-${id}`,
        tier_id: 'vip',
        tier_name: 'VIP',
        price_paid: 0,
        payment_method: 'physical',
        currency: 'HTG',
        status: 'printed_unsold',
        ...extra,
      },
      null,
      'HTG'
    )
  const online = toTicketRow(
    'o1',
    { attendee_id: 'u1', payment_id: 'mc_1', tier_id: 'vip', tier_name: 'VIP', price_paid: 2000, currency: 'HTG', status: 'valid' },
    { full_name: 'Ana', email: 'ana@x.co', default_city: 'Jacmel' },
    'HTG'
  )
  const rows = [
    online,
    printed('0001', { status: 'valid', attendee_name: 'Jean', purchased_at: '2026-11-20T10:00:00.000Z', checked_in: true, checked_in_at: '2026-11-21T22:00:00.000Z' }),
    printed('0002', { status: 'valid', attendee_name: 'Marie', purchased_at: '2026-11-20T11:00:00.000Z' }),
    printed('0003', {}),
    printed('0004', {}),
    printed('0005', { status: 'voided' }),
    printed('0006', { status: 'released' }),
  ]

  it('carries the serial on printed rows only', () => {
    expect(online.printedSerial).toBe('')
    expect(rows[1].printedSerial).toBe('FETE-VIP-B1-0001')
  })

  it('never lists an unsold, voided or released printed ticket as an order', () => {
    const orders = groupOrders(rows)
    expect(orders).toHaveLength(3)
    expect(orders.filter((o) => o.printed).map((o) => o.buyer.name).sort()).toEqual(['Jean', 'Marie'])
    expect(orders.find((o) => o.id === 'mc_1')!.printed).toBe(false)
  })

  it('counts sold printed tickets in the totals, never as revenue, and reports unsold seats apart', () => {
    const a = computeEventAnalytics(rows, 300)
    expect(a.ticketsSold).toBe(3)
    expect(a.checkedIn).toBe(1)
    expect(a.revenue).toEqual([{ currency: 'HTG', amount: 2000 }])
    expect(a.tiers).toEqual([{ name: 'VIP', sold: 3, printed: 2, revenue: [{ currency: 'HTG', amount: 2000 }] }])
    expect(a.printed).toEqual({ sold: 2, checkedIn: 1, unsold: 2 })
    // Typed names at a point of sale are not buyer accounts with a city.
    expect(a.totalBuyers).toBe(1)
    expect(a.buyersWithoutCity).toBe(0)
  })
})
