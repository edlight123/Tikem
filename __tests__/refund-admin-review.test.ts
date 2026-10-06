/**
 * @jest-environment node
 *
 * The refund coverage gate (lib/tickets/refundCoverage.ts + refundExecution)
 * and the admin review that follows it (lib/tickets/refundReview.ts).
 *
 * Owner decision: a refund of money Tikèm holds that the organizer's remaining
 * unwithdrawn balance can't cover goes to a Tikèm admin instead of being funded
 * silently out of Tikèm's pocket. The availability engine floors balances at 0,
 * which is how that used to happen.
 */

import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))

const processStripeRefund = jest.fn()
let destinationCharge = false
jest.mock('@/lib/refunds', () => ({
  isDestinationCharge: async () => destinationCharge,
  processStripeRefund: (...args: any[]) => processStripeRefund(...args),
}))

jest.mock('@/lib/promoters', () => ({
  reversePromoterSaleForTicket: async () => true,
  getFundedCommissionForEvent: async () => 0,
}))

const sendEmail = jest.fn(async (_args: any) => ({ success: true }))
jest.mock('@/lib/email', () => ({
  sendEmail: (args: any) => sendEmail(args),
  getRefundProcessedEmail: (p: any) => `refund ${p.status} ${p.refundAmount}`,
}))
jest.mock('@/lib/admin', () => ({ getAdminEmails: () => ['ops@example.com'] }))

// The availability facts, built from the fake store the way the real loader
// does (tickets, the ledger's withdrawn amount). `beforeTxHook` runs after the
// facts are loaded and before the claim transaction: a concurrent withdrawal.
const FEE = { platformFeePercentage: 0.1, legacyCapMinorPerTicket: null, capMinorPerTicket: null } as any
let beforeTxHook: (() => void) | null = null
jest.mock('@/lib/payouts/availability-server', () => ({
  loadEventAvailabilityInput: async ({ eventId }: { eventId: string }) => {
    const event = db.store.get(`events/${eventId}`)
    if (!event) return null
    const tickets = db
      .docsIn('tickets')
      .filter(([, d]) => d.event_id === eventId)
      .map(([p, d]) => ({ id: p.split('/')[1], ...d }))
    const ledgerRow = db.store.get(`event_earnings/${eventId}`)
    const withdrawn = Number(ledgerRow?.withdrawnAmount || 0)
    const input = {
      event: { id: eventId, ...event },
      tickets,
      fee: FEE,
      promoterCommissionMinor: 0,
      ledger: ledgerRow ? { withdrawnMinor: withdrawn, primaryWithdrawnMinor: withdrawn } : null,
      liveRequestsMinor: 0,
      batchPayouts: [],
      release: null,
    }
    if (beforeTxHook) {
      const hook = beforeTxHook
      beforeTxHook = null
      hook()
    }
    return input
  },
}))

import { refundTicket } from '@/lib/tickets/refundExecution'
import { approveRefundReview, denyRefundReview, listRefundReviews } from '@/lib/tickets/refundReview'
import { computeEventAvailability } from '@/lib/payouts/availability'
import { planTicketRefund } from '@/lib/tickets/refundPlan'
import { ticketBlockReason } from '@/lib/scan/checkInTicket'

const event = { id: 'ev1', title: 'Rara Fest', organizer_id: 'org_1' }
const ticket = (id: string) => db.store.get(`tickets/${id}`) as Record<string, any>
const opts = { reason: 'organizer_refund' as const, actorId: 'org_1', event, onFailure: 'release' as const }

/** The organizer's ceiling (what Tikèm owes for the event, minor units) from the store. */
function ceilingNow(): number {
  const tickets = db
    .docsIn('tickets')
    .filter(([, d]) => d.event_id === 'ev1')
    .map(([p, d]) => ({ id: p.split('/')[1], ...d }))
  return computeEventAvailability({
    event: { id: 'ev1', ...(db.store.get('events/ev1') as any) },
    tickets,
    fee: FEE,
    release: null,
  }).ceilingMinor
}

function withdraw(minor: number) {
  db.write('event_earnings/ev1', { eventId: 'ev1', currency: 'HTG', withdrawnAmount: minor }, { merge: true })
}

beforeEach(() => {
  db.store.clear()
  processStripeRefund.mockReset()
  processStripeRefund.mockResolvedValue({ success: true, refundId: 're_1' })
  sendEmail.mockClear()
  destinationCharge = false
  beforeTxHook = null
  db.write('events/ev1', { title: 'Rara Fest', organizer_id: 'org_1', currency: 'HTG', country: 'HT' })
  db.write('users/org_1', { email: 'org@example.com', full_name: 'Org One' })
  db.write('users/buyer_1', { email: 'buyer@example.com', full_name: 'Buyer One' })
  const base = { event_id: 'ev1', currency: 'HTG', original_currency: 'HTG', fee_incidence: 'organizer' }
  db.write('tickets/t_mc', {
    ...base,
    status: 'confirmed',
    payment_method: 'moncash',
    payment_id: 'mc_1',
    attendee_id: 'buyer_1',
    price_paid: 1000,
    charged_amount: 1000,
    charged_currency: 'HTG',
  })
  db.write('tickets/t_mc2', {
    ...base,
    status: 'confirmed',
    payment_method: 'moncash',
    payment_id: 'mc_2',
    attendee_id: 'buyer_2',
    price_paid: 1000,
    charged_amount: 1000,
    charged_currency: 'HTG',
  })
  // Platform card charge for an HTG event: charged in USD.
  db.write('tickets/t_card', {
    ...base,
    status: 'confirmed',
    payment_method: 'stripe',
    payment_id: 'pi_card',
    attendee_id: 'buyer_1',
    price_paid: 1500,
    charged_amount: 11.5,
    charged_currency: 'USD',
  })
  db.write('tickets/t_connect', {
    ...base,
    status: 'confirmed',
    payment_method: 'stripe_connect',
    payment_id: 'pi_connect',
    attendee_id: 'buyer_1',
    price_paid: 1500,
    charged_amount: 11.5,
    charged_currency: 'USD',
  })
})

describe('coverage gate', () => {
  it('a covered refund proceeds as before (nothing withdrawn)', async () => {
    const res = await refundTicket('t_mc', opts)
    expect(res.outcome).toBe('queued')
    expect(db.store.get('manual_refund_queue/ticket_t_mc')).toMatchObject({ status: 'pending', amount: 1000 })
    expect(db.store.get('refund_reviews/t_mc')).toBeUndefined()
  })

  it('a covered card refund still goes to Stripe', async () => {
    withdraw(Math.max(0, ceilingNow() - 200_000))
    const res = await refundTicket('t_card', opts)
    expect(res.outcome).toBe('refunded')
    expect(processStripeRefund).toHaveBeenCalledTimes(1)
  })

  it('a shortfall goes to admin review without calling any provider', async () => {
    const ceiling = ceilingNow()
    withdraw(ceiling) // the organizer took everything
    const res = await refundTicket('t_mc', opts)

    expect(res.outcome).toBe('admin_review')
    expect(processStripeRefund).not.toHaveBeenCalled()
    expect(db.store.get('manual_refund_queue/ticket_t_mc')).toBeUndefined()
    expect(ticket('t_mc')).toMatchObject({ status: 'confirmed', refund_status: 'admin_review' })

    const review = db.store.get('refund_reviews/t_mc') as Record<string, any>
    expect(review).toMatchObject({
      ticket_id: 't_mc',
      event_id: 'ev1',
      organizer_id: 'org_1',
      user_id: 'buyer_1',
      amount: 1000,
      currency: 'HTG',
      event_currency: 'HTG',
      face_amount_minor: 100_000,
      coverage_minor: 0,
      rail: 'manual',
      payment_method: 'moncash',
      requested_by: 'org_1',
      reason: 'organizer_refund',
      status: 'pending',
    })
    // The organizer's cost is the face less the fee share Tikèm gives up.
    expect(review.shortfall_minor).toBeGreaterThan(0)
    expect(review.shortfall_minor).toBe(review.organizer_cost_minor)
    expect(review.shortfall_minor).toBeLessThanOrEqual(100_000)

    // Admins are emailed.
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: 'ops@example.com' })
    expect(sendEmail.mock.calls[0][0].subject).toContain('needs review')
  })

  it('a partial shortfall is only the part not covered', async () => {
    const ceiling = ceilingNow()
    withdraw(ceiling - 30_000) // 300 HTG left unwithdrawn
    await refundTicket('t_mc', opts)
    const review = db.store.get('refund_reviews/t_mc') as Record<string, any>
    expect(review.coverage_minor).toBe(30_000)
    expect(review.shortfall_minor).toBe(review.organizer_cost_minor - 30_000)
  })

  it('compares in EVENT currency: a USD card charge for an HTG event is judged on its HTG face', async () => {
    withdraw(ceilingNow())
    const res = await refundTicket('t_card', opts)
    expect(res.outcome).toBe('admin_review')
    expect(processStripeRefund).not.toHaveBeenCalled()
    const review = db.store.get('refund_reviews/t_card') as Record<string, any>
    expect(review).toMatchObject({ amount: 11.5, currency: 'USD', event_currency: 'HTG', face_amount_minor: 150_000 })
    expect(review.shortfall_minor).toBeGreaterThan(10_000) // HTG minor units, not 11.50 USD
  })

  it('a buyer request made after a withdrawal is not "covered" by its own hold', async () => {
    withdraw(ceilingNow())
    db.write('tickets/t_mc', { refund_status: 'requested', refund_reason: 'cannot attend' }, { merge: true })
    const res = await refundTicket('t_mc', { ...opts, keepRefundReason: true })
    expect(res.outcome).toBe('admin_review')
    expect(db.store.get('refund_reviews/t_mc')).toMatchObject({
      buyer_reason: 'cannot attend',
      previous_refund_status: 'requested',
    })
    expect(ticket('t_mc').refund_reason).toBe('cannot attend')
  })

  it('stripe_connect is never gated: reverse_transfer takes it from the organizer', async () => {
    withdraw(10_000_000)
    const res = await refundTicket('t_connect', opts)
    expect(res.outcome).toBe('refunded')
    expect(processStripeRefund).toHaveBeenCalledWith('pi_connect', 11.5, expect.objectContaining({ reverseTransfer: true }))
  })

  it('a "stripe" sale that Stripe says is a destination charge is not gated either', async () => {
    destinationCharge = true
    withdraw(10_000_000)
    const res = await refundTicket('t_card', opts)
    expect(res.outcome).toBe('refunded')
    expect(processStripeRefund).toHaveBeenCalledWith('pi_card', 11.5, expect.objectContaining({ reverseTransfer: true }))
  })

  it('event cancellation is never gated', async () => {
    withdraw(10_000_000)
    const res = await refundTicket('t_mc', { ...opts, reason: 'event_cancelled', onFailure: 'hold', cancellation: true, notifyAdmins: false })
    expect(res.outcome).toBe('queued')
    expect(db.store.get('refund_reviews/t_mc')).toBeUndefined()
  })

  it('cancellation refunds a ticket that was waiting for review, and closes the review', async () => {
    withdraw(ceilingNow())
    await refundTicket('t_mc', opts)
    const res = await refundTicket('t_mc', { ...opts, reason: 'event_cancelled', onFailure: 'hold', cancellation: true, notifyAdmins: false })
    expect(res.outcome).toBe('queued')
    expect(db.store.get('refund_reviews/t_mc')).toMatchObject({ status: 'superseded' })
  })

  it('compares inside the claim transaction: a withdrawal that lands after the facts were loaded is seen', async () => {
    // Facts load with nothing withdrawn; the organizer then withdraws it all
    // before the claim transaction runs.
    withdraw(0)
    const ceiling = ceilingNow()
    beforeTxHook = () => withdraw(ceiling)
    const res = await refundTicket('t_mc', opts)
    expect(res.outcome).toBe('admin_review')
    expect(db.store.get('manual_refund_queue/ticket_t_mc')).toBeUndefined()
  })

  it('fails closed to review when the balance cannot be computed', async () => {
    db.store.delete('events/ev1')
    const res = await refundTicket('t_mc', opts)
    expect(res.outcome).toBe('admin_review')
    expect(db.store.get('refund_reviews/t_mc')).toMatchObject({ shortfall_minor: null, coverage_error: 'event_not_found' })
  })
})

describe('admin_review is a refund in flight', () => {
  it('holds the ticket net from withdrawals', () => {
    const tickets = db
      .docsIn('tickets')
      .filter(([, d]) => d.event_id === 'ev1' && d.payment_method === 'moncash')
      .map(([p, d]) => ({ id: p.split('/')[1], ...d }))
    const live = computeEventAvailability({ event: { id: 'ev1', currency: 'HTG' }, tickets, fee: FEE, release: null })
    const held = computeEventAvailability({
      event: { id: 'ev1', currency: 'HTG' },
      tickets: tickets.map((t) => (t.id === 't_mc' ? { ...t, refund_status: 'admin_review' } : t)),
      fee: FEE,
      release: null,
    })
    expect(held.refundInFlightMinor).toBe(100_000)
    expect(held.ceilingMinor).toBeLessThan(live.ceilingMinor)
  })

  it('is refused at the door and cannot be refunded again by the organizer', () => {
    const t = { status: 'valid', refund_status: 'admin_review', price_paid: 1000, payment_method: 'moncash' }
    expect(ticketBlockReason(t)).toBe('REFUNDED')
    expect(planTicketRefund(t)).toEqual({ eligible: false, reason: 'refund_in_progress' })
  })
})

describe('admin decision', () => {
  beforeEach(async () => {
    withdraw(ceilingNow())
    await refundTicket('t_mc', opts)
    await refundTicket('t_card', opts)
    sendEmail.mockClear()
  })

  it('lists pending reviews with the shortfall and buyer contact', async () => {
    const items = await listRefundReviews()
    expect(items.map((i) => i.ticketId).sort()).toEqual(['t_card', 't_mc'])
    const mc = items.find((i) => i.ticketId === 't_mc')!
    expect(mc).toMatchObject({ eventCurrency: 'HTG', buyerEmail: 'buyer@example.com', buyerName: 'Buyer One', organizerName: 'Org One' })
    expect(mc.shortfallMinor).toBeGreaterThan(0)
  })

  it('approve runs the refund through the normal path and writes the negative carry', async () => {
    const shortfall = (db.store.get('refund_reviews/t_mc') as any).shortfall_minor
    const res = await approveRefundReview({ ticketId: 't_mc', actorId: 'admin_1', note: 'goodwill' })
    expect(res).toMatchObject({ outcome: 'queued', amount: 1000, currency: 'HTG', shortfallMinor: shortfall, eventCurrency: 'HTG' })
    expect(db.store.get('manual_refund_queue/ticket_t_mc')).toMatchObject({ status: 'pending', amount: 1000 })
    expect(ticket('t_mc')).toMatchObject({
      status: 'refund_pending',
      refund_status: 'manual_required',
      refund_shortfall_approved_by: 'admin_1',
    })
    expect(db.store.get('organizer_balance_adjustments/refund_t_mc')).toMatchObject({
      organizer_id: 'org_1',
      event_id: 'ev1',
      amount_minor: -shortfall,
      currency: 'HTG',
      reason: 'refund_after_withdrawal',
      ticket_id: 't_mc',
      approved_by: 'admin_1',
    })
    expect(db.store.get('refund_reviews/t_mc')).toMatchObject({ status: 'approved', approved_by: 'admin_1', adjustment_id: 'refund_t_mc' })
    // A second approval is refused.
    await expect(approveRefundReview({ ticketId: 't_mc', actorId: 'admin_1' })).rejects.toMatchObject({ status: 409 })
  })

  it('approve on a card sale refunds in Stripe in the charged currency', async () => {
    const res = await approveRefundReview({ ticketId: 't_card', actorId: 'admin_1' })
    expect(res.outcome).toBe('refunded')
    expect(processStripeRefund).toHaveBeenCalledWith('pi_card', 11.5, expect.objectContaining({ reverseTransfer: false }))
    expect(ticket('t_card')).toMatchObject({ status: 'refunded', refund_status: 'approved' })
  })

  it('a provider failure on approve keeps the review open and the ticket held', async () => {
    processStripeRefund.mockResolvedValue({ success: false, error: 'card_declined' })
    await expect(approveRefundReview({ ticketId: 't_card', actorId: 'admin_1' })).rejects.toMatchObject({ status: 502 })
    expect(ticket('t_card').refund_status).toBe('admin_review')
    expect(db.store.get('refund_reviews/t_card')).toMatchObject({ status: 'pending', last_error: 'card_declined' })
    expect(db.store.get('organizer_balance_adjustments/refund_t_card')).toBeUndefined()
  })

  it('deny puts the ticket back to live as denied and tells buyer and organizer', async () => {
    await denyRefundReview({ ticketId: 't_mc', actorId: 'admin_1', note: 'outside policy' })
    expect(ticket('t_mc')).toMatchObject({ status: 'confirmed', refund_status: 'denied', refund_denied_by: 'admin_1' })
    expect(db.store.get('refund_reviews/t_mc')).toMatchObject({ status: 'denied', resolution_note: 'outside policy' })
    expect(db.store.get('manual_refund_queue/ticket_t_mc')).toBeUndefined()
    const to = sendEmail.mock.calls.map((c) => c[0].to).sort()
    expect(to).toEqual(['buyer@example.com', 'org@example.com'])
    // Live again: scannable and counted in the balance.
    expect(ticketBlockReason(ticket('t_mc'))).toBeNull()
    await expect(denyRefundReview({ ticketId: 't_mc', actorId: 'admin_1' })).rejects.toMatchObject({ status: 409 })
  })
})
