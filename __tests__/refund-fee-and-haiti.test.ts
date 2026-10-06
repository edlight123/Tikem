/**
 * @jest-environment node
 *
 * Two owner decisions (2026-10):
 *
 *  1. THE SERVICE FEE IS NON-REFUNDABLE unless the event is cancelled (or a
 *     Tikèm admin approves it as "event changed"). A buyer-requested or
 *     organizer-initiated refund returns the face value only; on a Stripe
 *     destination charge Tikèm's application fee is not refunded. The payout
 *     engine keeps Tikèm's fee earned on a refunded organizer-absorbs ticket.
 *  2. HAITI EVENTS: NO AUTOMATIC REFUNDS. Every refund for an event whose
 *     country needs approval (config/payouts.refundsRequireAdminApproval,
 *     default ['HT']) goes to refund_reviews ('haiti_manual_approval'); only
 *     the admin approval executes it.
 *
 * Organizer/buyer request bodies can never pick the fee policy or the
 * cancellation treatment.
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
jest.mock('@/lib/sms', () => ({
  sendSms: jest.fn(async () => ({ success: true })),
  getRefundApprovedSms: () => 'approved',
  getRefundDeniedSms: () => 'denied',
}))
jest.mock('@/lib/admin', () => ({ getAdminEmails: () => ['ops@example.com'] }))

const FEE = { platformFeePercentage: 0.1, legacyCapMinorPerTicket: null, capMinorPerTicket: null } as any
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
    return {
      event: { id: eventId, ...event },
      tickets,
      fee: FEE,
      promoterCommissionMinor: 0,
      ledger: ledgerRow ? { withdrawnMinor: withdrawn, primaryWithdrawnMinor: withdrawn } : null,
      liveRequestsMinor: 0,
      batchPayouts: [],
      release: null,
    }
  },
  loadEventAvailability: async () => null,
}))

// Organizer auth for /api/refund-ticket: org_1 owns ev1 / ev_us.
jest.mock('@/lib/organizer/ticketActions', () => ({
  parseTicketIds: (body: any) => (body?.ticketIds ? body.ticketIds : body?.ticketId ? [body.ticketId] : null),
  loadOwnedTickets: async (ids: string[]) => {
    const tickets = ids.map((id) => ({ id, ...(db.store.get(`tickets/${id}`) as any) }))
    const eventId = tickets[0]?.event_id
    const event = { id: eventId, ...(db.store.get(`events/${eventId}`) as any) }
    return { ok: true, access: { ok: true, event, user: { id: 'org_1' } }, tickets }
  },
}))

// The buyer-request route's Supabase-shaped shim over the same store.
jest.mock('@/lib/firebase-db/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'org_1' } }, error: null }) },
    from: (table: string) => {
      let id = ''
      let pending: any = null
      const b: any = {
        select: () => b,
        eq: (_f: string, v: unknown) => {
          id = String(v)
          return b
        },
        update: (data: any) => {
          pending = data
          return b
        },
        single: async () => {
          const data = db.store.get(`${table}/${id}`)
          return data ? { data: { id, ...data }, error: null } : { data: null, error: { message: 'not found' } }
        },
        then: (resolve: (v: any) => void) => {
          if (pending) db.write(`${table}/${id}`, pending, { merge: true })
          resolve({ error: null })
        },
      }
      return b
    },
  }),
}))

import {
  planTicketRefund,
  refundIncludesServiceFee,
  ticketBuyerFeeCharged,
} from '@/lib/tickets/refundPlan'
import { ADMIN_APPROVAL_MESSAGE, refundTicket } from '@/lib/tickets/refundExecution'
import { approveRefundReview } from '@/lib/tickets/refundReview'
import { cancelEventWithRefunds } from '@/lib/events/cancel'
import { computeEventAvailability } from '@/lib/payouts/availability'
import { computeRefundCoverage } from '@/lib/tickets/refundCoverage'
import { ticketBlockReason } from '@/lib/scan/checkInTicket'
import {
  countryRequiresAdminApproval,
  eventCountryCode,
  parseRefundApprovalCountries,
} from '@/lib/tickets/refundApprovalPolicy'
import { POST as refundTicketRoute } from '@/app/api/refund-ticket/route'
import { POST as processRoute } from '@/app/api/refunds/process/route'

const ticket = (id: string) => db.store.get(`tickets/${id}`) as Record<string, any>

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A USD event (not Haiti): every refund executes, subject to the balance gate. */
const US = { event_id: 'ev_us', currency: 'USD', original_currency: 'USD', attendee_id: 'buyer_1' }
/** A Haiti event. */
const HT = { event_id: 'ev1', currency: 'HTG', original_currency: 'HTG', attendee_id: 'buyer_1' }

beforeEach(() => {
  db.store.clear()
  processStripeRefund.mockReset()
  processStripeRefund.mockResolvedValue({ success: true, refundId: 're_1' })
  sendEmail.mockClear()
  destinationCharge = false
  db.write('events/ev_us', { title: 'Brooklyn Konpa', organizer_id: 'org_1', currency: 'USD', country: 'US', status: 'published' })
  db.write('events/ev1', { title: 'Rara Fest', organizer_id: 'org_1', currency: 'HTG', country: 'HT', status: 'published' })
  db.write('users/org_1', { email: 'org@example.com' })
  db.write('users/buyer_1', { email: 'buyer@example.com', full_name: 'Buyer One' })

  // US: destination charge, buyer paid the fee on top (25 + 2.50).
  db.write('tickets/u_connect', {
    ...US,
    status: 'valid',
    payment_method: 'stripe_connect',
    payment_id: 'pi_u_connect',
    fee_incidence: 'buyer',
    price_paid: 25,
    charged_amount: 27.5,
    charged_currency: 'USD',
  })
  // US: platform card charge, organizer absorbed the fee.
  db.write('tickets/u_card', {
    ...US,
    status: 'valid',
    payment_method: 'stripe',
    payment_id: 'pi_u_card',
    fee_incidence: 'organizer',
    price_paid: 40,
    charged_amount: 40,
    charged_currency: 'USD',
  })
  // Haiti: MonCash, buyer paid the fee on top (2000 + 200 HTG).
  db.write('tickets/h_mc', {
    ...HT,
    status: 'confirmed',
    payment_method: 'moncash',
    payment_id: 'mc_1',
    fee_incidence: 'buyer',
    buyer_fee_charged: 20_000,
    price_paid: 2000,
    charged_amount: 2200,
    charged_currency: 'HTG',
  })
  // Haiti: platform card, HTG event charged in USD with the fee on top.
  db.write('tickets/h_card', {
    ...HT,
    status: 'confirmed',
    payment_method: 'stripe',
    payment_id: 'pi_h_card',
    fee_incidence: 'buyer',
    exchange_rate_used: 0.0075,
    price_paid: 2000,
    charged_amount: 16.5,
    charged_currency: 'USD',
  })
  // Haiti: free RSVP.
  db.write('tickets/h_free', { ...HT, status: 'valid', payment_method: 'free', price_paid: 0 })
})

function orgRefund(body: Record<string, any>) {
  return refundTicketRoute(
    new Request('http://x/api/refund-ticket', { method: 'POST', body: JSON.stringify(body) })
  )
}

function buyerApprove(ticketId: string, extra: Record<string, any> = {}) {
  return processRoute(
    new Request('http://x/api/refunds/process', {
      method: 'POST',
      body: JSON.stringify({ ticketId, action: 'approve', ...extra }),
    })
  )
}

// ── 1. Amounts ──────────────────────────────────────────────────────────────

describe('refund amount per policy (planTicketRefund)', () => {
  it('buyer-requested: face value only; cancellation: the whole charge', () => {
    const t = ticket('u_connect')
    expect(planTicketRefund(t)).toMatchObject({ amount: 25, currency: 'USD', feePolicy: 'retained', buyerFee: 2.5 })
    expect(planTicketRefund(t, { includeServiceFee: true })).toMatchObject({ amount: 27.5, feePolicy: 'refunded' })
  })

  it('MonCash pass-on: the stamped event-currency fee is taken out of the charged total', () => {
    expect(planTicketRefund(ticket('h_mc'))).toMatchObject({ rail: 'manual', amount: 2000, currency: 'HTG', buyerFee: 200 })
  })

  it('HTG event charged in USD: face × exchange rate is the face share', () => {
    // 2000 HTG × 0.0075 = 15 USD face; 1.50 USD fee.
    expect(planTicketRefund(ticket('h_card'))).toMatchObject({ amount: 15, currency: 'USD', buyerFee: 1.5 })
  })

  it('a fulfillment-stamped buyer_fee_charged_amount wins', () => {
    const t = { ...ticket('h_card'), buyer_fee_charged_amount: 1.65 }
    expect(planTicketRefund(t)).toMatchObject({ amount: 14.85, buyerFee: 1.65 })
  })

  it('organizer-absorbs: there is no buyer fee, the face (= charge) goes back', () => {
    expect(planTicketRefund(ticket('u_card'))).toMatchObject({ amount: 40, buyerFee: 0, feePolicy: 'retained' })
  })

  it('a fee that cannot be worked out is 0 (the buyer gets the whole charge back)', () => {
    const t = { ...ticket('h_card'), exchange_rate_used: null }
    expect(ticketBuyerFeeCharged(t, 16.5, 'USD')).toBe(0)
  })

  it('only trusted flags return the fee', () => {
    expect(refundIncludesServiceFee({})).toBe(false)
    expect(refundIncludesServiceFee({ cancellation: true })).toBe(true)
    expect(refundIncludesServiceFee({ adminApprovedServiceFeeRefund: true })).toBe(true)
  })
})

describe('Stripe Connect application fee', () => {
  const event = { id: 'ev_us', title: 'Brooklyn Konpa', organizer_id: 'org_1', country: 'US' }

  it('buyer-requested: face only, reverse_transfer, NO refund_application_fee', async () => {
    const res = await refundTicket('u_connect', { reason: 'organizer_refund', actorId: 'org_1', event, onFailure: 'release' })
    expect(res.outcome).toBe('refunded')
    expect(processStripeRefund).toHaveBeenCalledWith('pi_u_connect', 25, expect.objectContaining({
      reverseTransfer: true,
      refundApplicationFee: false,
    }))
    expect(ticket('u_connect')).toMatchObject({
      status: 'refunded',
      refund_amount: 25,
      refund_face_amount: 25,
      refund_fee_policy: 'retained',
      fee_retained_minor: 250,
      refunded_fee_minor: 0,
    })
  })

  it('cancellation: the whole charge and the application fee go back', async () => {
    const res = await refundTicket('u_connect', {
      reason: 'event_cancelled',
      actorId: 'org_1',
      event,
      onFailure: 'hold',
      cancellation: true,
    })
    expect(res.outcome).toBe('refunded')
    expect(processStripeRefund).toHaveBeenCalledWith('pi_u_connect', 27.5, expect.objectContaining({
      reverseTransfer: true,
      refundApplicationFee: true,
    }))
    expect(ticket('u_connect')).toMatchObject({ refund_fee_policy: 'refunded', refunded_fee_minor: 250, fee_retained_minor: 0 })
  })

  it('a reason string alone (no trusted flag) never refunds the fee', async () => {
    await refundTicket('u_connect', { reason: 'event_changed', actorId: 'org_1', event, onFailure: 'release' })
    expect(processStripeRefund).toHaveBeenCalledWith('pi_u_connect', 25, expect.objectContaining({ refundApplicationFee: false }))
  })
})

describe('organizer and buyer routes cannot choose the fee policy or cancellation treatment', () => {
  it.each(['event_cancelled', 'cancelled', 'event_changed'])(
    'organizer passing reason %s gets the buyer-requested treatment',
    async (reason) => {
      const res = await orgRefund({ ticketId: 'u_connect', reason })
      expect(res.status).toBe(200)
      expect(processStripeRefund).toHaveBeenCalledWith('pi_u_connect', 25, expect.objectContaining({ refundApplicationFee: false }))
      expect(ticket('u_connect')).toMatchObject({ refund_reason: 'organizer_refund', refund_fee_policy: 'retained' })
    }
  )

  it.each(['event_cancelled', 'event_changed'])(
    'organizer passing reason %s still hits the balance gate',
    async (reason) => {
      // The organizer withdrew everything: a Tikèm-held refund is a shortfall.
      db.write('event_earnings/ev_us', { eventId: 'ev_us', currency: 'USD', withdrawnAmount: 1_000_000 })
      const res = await orgRefund({ ticketId: 'u_card', reason })
      expect(res.status).toBe(202)
      expect(processStripeRefund).not.toHaveBeenCalled()
      expect(db.store.get('refund_reviews/u_card')).toMatchObject({
        reason: 'organizer_refund',
        review_reason: 'shortfall',
        fee_policy: 'retained',
      })
    }
  )

  it.each(['event_cancelled', 'event_changed'])(
    'organizer passing reason %s on a Haiti event still goes to Haiti review',
    async (reason) => {
      const res = await orgRefund({ ticketId: 'h_mc', reason })
      expect(res.status).toBe(202)
      expect(db.store.get('refund_reviews/h_mc')).toMatchObject({
        reason: 'organizer_refund',
        review_reason: 'haiti_manual_approval',
        fee_policy: 'retained',
        amount: 2000,
      })
    }
  )

  it('buyer request approval passing reason event_changed keeps the fee', async () => {
    db.write('tickets/u_connect', { refund_status: 'requested', refund_requested_by: 'buyer_1' }, { merge: true })
    const res = await buyerApprove('u_connect', { reason: 'event_changed' })
    expect(res.status).toBe(200)
    expect(processStripeRefund).toHaveBeenCalledWith('pi_u_connect', 25, expect.objectContaining({ refundApplicationFee: false }))
  })
})

// ── 2. Haiti: every refund goes to admin review ─────────────────────────────

describe('Haiti events: no automatic refunds', () => {
  it('organizer refund-ticket → admin review with the Haiti reason, no provider call', async () => {
    const res = await orgRefund({ ticketIds: ['h_mc', 'h_card'] })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'admin_review', message: ADMIN_APPROVAL_MESSAGE })
    expect(body.review).toHaveLength(2)
    expect(processStripeRefund).not.toHaveBeenCalled()
    expect(db.store.get('manual_refund_queue/ticket_h_mc')).toBeUndefined()
    expect(ticket('h_mc')).toMatchObject({
      status: 'confirmed',
      refund_status: 'admin_review',
      refund_review_reason: 'haiti_manual_approval',
    })
    expect(db.store.get('refund_reviews/h_card')).toMatchObject({
      status: 'pending',
      review_reason: 'haiti_manual_approval',
      amount: 15,
      currency: 'USD',
    })
    // The door refuses a ticket waiting on the decision.
    expect(ticketBlockReason(ticket('h_mc'))).toBe('REFUNDED')
    // The admins were emailed.
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ops@example.com', subject: expect.stringContaining('Haiti: needs approval') })
    )
  })

  it('buyer request approved by the organizer → admin review', async () => {
    db.write('tickets/h_mc', { refund_status: 'requested', refund_requested_by: 'buyer_1', refund_reason: 'Sick' }, { merge: true })
    const res = await buyerApprove('h_mc')
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ code: 'admin_review', reviewReason: 'haiti_manual_approval', message: ADMIN_APPROVAL_MESSAGE })
    expect(db.store.get('refund_reviews/h_mc')).toMatchObject({ review_reason: 'haiti_manual_approval', buyer_reason: 'Sick' })
  })

  it.each([
    ['organizer', false],
    ['admin', true],
  ])('%s cancellation freezes payouts and sends every paid ticket to review', async (_who, isAdmin) => {
    const out = await cancelEventWithRefunds({
      eventId: 'ev1',
      actor: { id: isAdmin ? 'admin_1' : 'org_1', isAdmin },
      reason: 'Storm',
    })
    expect(db.store.get('events/ev1')).toMatchObject({ status: 'cancelled', payouts_frozen: true })
    expect(db.store.get('event_earnings/ev1')).toMatchObject({ availableToWithdraw: 0, settlementStatus: 'cancelled' })
    expect(out).toMatchObject({ refundsSentToReview: 2, refundsSucceeded: 0, refundsQueuedManual: 0, freeTicketsVoided: 1 })
    expect(processStripeRefund).not.toHaveBeenCalled()
    for (const id of ['h_mc', 'h_card']) {
      expect(ticket(id)).toMatchObject({ refund_status: 'admin_review', refund_fee_policy: 'refunded' })
      expect(ticketBlockReason(ticket(id))).toBe('REFUNDED')
      expect(db.store.get(`refund_reviews/${id}`)).toMatchObject({
        reason: 'event_cancelled',
        review_reason: 'haiti_manual_approval',
        fee_policy: 'refunded',
      })
    }
    expect(db.store.get('refund_reviews/h_mc')).toMatchObject({ amount: 2200 })
    expect(ticket('h_free')).toMatchObject({ status: 'cancelled' })

    // Resuming the sweep re-opens nothing and re-notifies nobody.
    sendEmail.mockClear()
    const again = await cancelEventWithRefunds({ eventId: 'ev1', actor: { id: 'org_1', isAdmin }, reason: null })
    expect(again.refundsSentToReview).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('the admin approval executes it, still applying the fee rule', async () => {
    await orgRefund({ ticketId: 'h_card' })
    const res = await approveRefundReview({ ticketId: 'h_card', actorId: 'admin_1' })
    expect(res).toMatchObject({ outcome: 'refunded', amount: 15, currency: 'USD' })
    expect(processStripeRefund).toHaveBeenCalledWith('pi_h_card', 15, expect.objectContaining({ refundApplicationFee: false }))
    expect(ticket('h_card')).toMatchObject({ status: 'refunded', refund_fee_policy: 'retained', fee_retained_minor: 150 })
    expect(db.store.get('refund_reviews/h_card')).toMatchObject({ status: 'approved' })
  })

  it('the admin may approve it as event_changed, which returns the fee', async () => {
    await orgRefund({ ticketId: 'h_card' })
    const res = await approveRefundReview({ ticketId: 'h_card', actorId: 'admin_1', reason: 'event_changed' })
    expect(res).toMatchObject({ outcome: 'refunded', amount: 16.5 })
    expect(ticket('h_card')).toMatchObject({ refund_reason: 'event_changed', refund_fee_policy: 'refunded', refunded_fee_minor: 150 })
  })

  it('approving a cancellation review refunds the whole charge', async () => {
    await cancelEventWithRefunds({ eventId: 'ev1', actor: { id: 'admin_1', isAdmin: true }, reason: 'Storm' })
    const res = await approveRefundReview({ ticketId: 'h_mc', actorId: 'admin_1' })
    expect(res).toMatchObject({ outcome: 'queued', amount: 2200, currency: 'HTG' })
    expect(db.store.get('manual_refund_queue/ticket_h_mc')).toMatchObject({ amount: 2200, feePolicy: 'refunded' })
  })

  it('the setting switches it: [] executes Haiti refunds, ["*"] sends every country to review', async () => {
    db.write('config/payouts', { refundsRequireAdminApproval: [] })
    const ht = await orgRefund({ ticketId: 'h_mc' })
    expect(ht.status).toBe(200)
    expect(db.store.get('manual_refund_queue/ticket_h_mc')).toMatchObject({ amount: 2000, feePolicy: 'retained' })

    db.write('config/payouts', { refundsRequireAdminApproval: ['*'] })
    const us = await orgRefund({ ticketId: 'u_connect' })
    expect(us.status).toBe(202)
    expect(processStripeRefund).not.toHaveBeenCalled()
  })

  it('policy parsing and the country resolver', () => {
    expect(parseRefundApprovalCountries(undefined)).toEqual(['HT'])
    expect(parseRefundApprovalCountries('HT')).toEqual(['HT'])
    expect(parseRefundApprovalCountries(['us', ' ht '])).toEqual(['US', 'HT'])
    expect(eventCountryCode('Haiti')).toBe('HT')
    expect(countryRequiresAdminApproval('haiti', ['HT'])).toBe(true)
    expect(countryRequiresAdminApproval('US', ['HT'])).toBe(false)
    expect(countryRequiresAdminApproval('', ['HT'])).toBe(false)
    expect(countryRequiresAdminApproval('CA', ['ALL'])).toBe(true)
  })
})

// ── 3. Payout math with a retained fee ──────────────────────────────────────

describe('payout math: Tikèm keeps its fee on a buyer-requested refund', () => {
  const event = { id: 'ev_p', currency: 'HTG' }
  const base = {
    event_id: 'ev_p',
    currency: 'HTG',
    original_currency: 'HTG',
    payment_method: 'moncash',
    status: 'confirmed',
    price_paid: 1000,
    purchased_at: '2026-10-01T00:00:00Z',
  }
  const absorb = (id: string, extra: Record<string, any> = {}) => ({
    id,
    ...base,
    payment_id: `mc_${id}`,
    fee_incidence: 'organizer',
    charged_amount: 1000,
    charged_currency: 'HTG',
    ...extra,
  })
  const passOn = (id: string, extra: Record<string, any> = {}) => ({
    id,
    ...base,
    payment_id: `mc_${id}`,
    fee_incidence: 'buyer',
    buyer_fee_charged: 10_000,
    charged_amount: 1100,
    charged_currency: 'HTG',
    ...extra,
  })
  const avail = (tickets: any[]) => computeEventAvailability({ event, tickets, fee: FEE, release: null })
  const refunded = { status: 'refunded', refund_status: 'approved', refund_face_amount: 1000 }

  it('organizer-absorbs, fee retained: the organizer loses the whole face; Tikèm fee stays earned', () => {
    const before = avail([absorb('a'), absorb('b')])
    const after = avail([absorb('a', { ...refunded, refund_fee_policy: 'retained' }), absorb('b')])
    expect(after.netMinor).toBe(before.netMinor - 100_000)
    expect(after.platformFeeMinor).toBe(before.platformFeeMinor)
    expect(after.refundedMinor).toBe(100_000)
  })

  it('organizer-absorbs, fee refunded (cancellation / legacy): the organizer loses face less fee', () => {
    const before = avail([absorb('a'), absorb('b')])
    const feeA = before.platformFeeMinor / 2
    for (const policy of ['refunded', undefined]) {
      const after = avail([absorb('a', { ...refunded, refund_fee_policy: policy }), absorb('b')])
      expect(after.netMinor).toBe(before.netMinor - (100_000 - feeA))
      expect(after.platformFeeMinor).toBe(before.platformFeeMinor - feeA)
    }
  })

  it('pass-on, fee retained: the organizer loses the face; the buyer fee was never theirs', () => {
    const before = avail([passOn('a'), passOn('b')])
    const after = avail([passOn('a', { ...refunded, refund_fee_policy: 'retained' }), passOn('b')])
    expect(before.platformFeeMinor).toBe(0)
    expect(after.netMinor).toBe(before.netMinor - 100_000)
  })

  it('a refund in flight (incl. Haiti admin review) is held at the same cost', () => {
    const before = avail([absorb('a'), absorb('b')])
    const held = avail([absorb('a', { refund_status: 'admin_review', refund_fee_policy: 'retained' }), absorb('b')])
    expect(held.netMinor).toBe(before.netMinor - 100_000)
    expect(held.refundInFlightMinor).toBe(100_000)
  })

  it('the balance gate counts the whole face as the organizer cost when the fee is retained', () => {
    const tickets = [absorb('a'), absorb('b')]
    const input = { event, tickets, fee: FEE, release: null } as any
    expect(computeRefundCoverage(input, 'a', 0, 'retained').organizerCostMinor).toBe(100_000)
    expect(computeRefundCoverage(input, 'a', 0, 'refunded').organizerCostMinor).toBeLessThan(100_000)
  })
})
