/**
 * Ownership and state guards added in the security pass:
 *  - create-from-payment: only the order's buyer gets ticket ids
 *  - MonCash / SogePay returns: ticket ids and guest links only to the order holder
 *  - publish: cancelled / rejected / hidden / frozen events and banned organizers
 *  - release ladder: frozen and ledger-cancelled events release nothing
 *  - established-organizer history: only published, paid, effectively-ended events
 *  - disputes: a new open dispute freezes the event and flags the organizer
 */

import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __increment: n }), arrayUnion: (...v: any[]) => v },
}))
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn(async () => ({ success: true })), escapeHtml: (s: string) => s }))
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: jest.fn(async () => undefined) }))

process.env.GUEST_TOKEN_SECRET = process.env.GUEST_TOKEN_SECRET || 'test-guest-secret-for-jest-0123456789'

import { callerOwnsPaymentIntent } from '@/lib/tickets/paymentIntentOwner'
import { callerHoldsOrder, orderIdsFromCookies, orderProofValue, ticketHolderId } from '@/lib/tickets/orderAccess'
import { guestTokenFor, mintGuestOrderKey } from '@/lib/guest/identity'
import { isOrganizerBanned, publishBlockReason } from '@/lib/events/publishGuard'
import { decideRelease } from '@/lib/payouts/release-rules'
import { isCompletedPaidEvent } from '@/lib/payouts/completed-events'
import { handleStripeDisputeEvent } from '@/lib/disputes'

describe('create-from-payment ownership', () => {
  const pi = { client_secret: 'pi_1_secret_abc', metadata: { userId: 'u1', guestOrderKey: '' } }

  it('an account order belongs only to its own uid', () => {
    expect(callerOwnsPaymentIntent({ paymentIntent: pi, user: { id: 'u1' }, isGuest: false })).toBe(true)
    expect(callerOwnsPaymentIntent({ paymentIntent: pi, user: { id: 'u2' }, isGuest: false })).toBe(false)
    expect(callerOwnsPaymentIntent({ paymentIntent: pi, user: null, isGuest: false })).toBe(false)
    // A leaked client secret does not stand in for the account.
    expect(
      callerOwnsPaymentIntent({ paymentIntent: pi, user: null, isGuest: false, clientSecret: 'pi_1_secret_abc' })
    ).toBe(false)
  })

  it('a guest order needs the client secret or the signed token for THIS order', () => {
    const key = mintGuestOrderKey()
    const guestPi = { client_secret: 'pi_2_secret_xyz', metadata: { userId: 'guest_x', guestOrderKey: key } }
    expect(callerOwnsPaymentIntent({ paymentIntent: guestPi, user: null, isGuest: true })).toBe(false)
    expect(
      callerOwnsPaymentIntent({ paymentIntent: guestPi, user: null, isGuest: true, clientSecret: 'pi_2_secret_xyz' })
    ).toBe(true)
    expect(
      callerOwnsPaymentIntent({ paymentIntent: guestPi, user: null, isGuest: true, clientSecret: 'pi_2_secret_nope' })
    ).toBe(false)
    expect(
      callerOwnsPaymentIntent({ paymentIntent: guestPi, user: null, isGuest: true, guestToken: guestTokenFor(key) })
    ).toBe(true)
    const otherKey = mintGuestOrderKey()
    expect(
      callerOwnsPaymentIntent({ paymentIntent: guestPi, user: null, isGuest: true, guestToken: guestTokenFor(otherKey) })
    ).toBe(false)
  })
})

describe('payment return routes: who holds the order', () => {
  const order = { user_id: 'u1' }
  it('the browser that started checkout (cookie) or the signed-in buyer', () => {
    expect(callerHoldsOrder({ orderId: '123', order, cookieOrderIds: ['123'] })).toBe(true)
    expect(callerHoldsOrder({ orderId: '123', order, cookieOrderIds: [], sessionUid: 'u1' })).toBe(true)
    expect(callerHoldsOrder({ orderId: '123', order, cookieOrderIds: ['999'], sessionUid: 'u2' })).toBe(false)
    expect(callerHoldsOrder({ orderId: '123', order: { user_id: 'guest_abc' }, cookieOrderIds: [] })).toBe(false)
  })

  it('trusts only a server-signed proof cookie, never a bare order id', () => {
    const prev = process.env.ORDER_COOKIE_SECRET
    process.env.ORDER_COOKIE_SECRET = 'test-secret'
    try {
      const signed = orderProofValue('42')!
      const ok = new Map([['moncash_order_proof_domain', { value: signed }]])
      expect(orderIdsFromCookies({ get: (n: string) => ok.get(n) })).toEqual(['42'])
      // A bare order id in the lookup cookie proves nothing.
      const bare = new Map([['moncash_button_order_id_domain', { value: '42' }]])
      expect(orderIdsFromCookies({ get: (n: string) => bare.get(n) })).toEqual([])
      // A forged proof for another order is refused.
      const forged = new Map([['moncash_order_proof', { value: '43.' + signed.split('.')[1] }]])
      expect(orderIdsFromCookies({ get: (n: string) => forged.get(n) })).toEqual([])
    } finally {
      if (prev === undefined) delete process.env.ORDER_COOKIE_SECRET
      else process.env.ORDER_COOKIE_SECRET = prev
    }
  })

  it("a ticket's holder is attendee_id, else the legacy user_id", () => {
    expect(ticketHolderId({ attendee_id: 'a', user_id: 'b' })).toBe('a')
    expect(ticketHolderId({ user_id: 'b' })).toBe('b')
  })
})

describe('MonCash order id', () => {
  it('is 15 numeric digits from the CSPRNG (no clock prefix)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../app/api/moncash-button/initiate/route.ts'), 'utf8')
    expect(src).not.toMatch(/Date\.now\(\) % 1_000_000_000/)
    expect(src).toMatch(/crypto\.randomInt\(1_000_000, 10_000_000\)/)
  })
})

describe('publish guard', () => {
  const live = { status: 'draft', is_published: false }
  it('allows an ordinary draft by an organizer in good standing', () => {
    expect(publishBlockReason(live, { status: 'active' })).toBeNull()
  })
  it.each([
    [{ ...live, status: 'cancelled' }, 'event_cancelled'],
    [{ ...live, cancelled_at: '2026-10-01T00:00:00Z' }, 'event_cancelled'],
    [{ ...live, rejected: true }, 'event_rejected'],
    [{ ...live, hidden_pending_review: true }, 'event_hidden_pending_review'],
    [{ ...live, payouts_frozen: true }, 'payouts_frozen'],
  ])('refuses %o', (event, code) => {
    expect(publishBlockReason(event, null)).toBe(code)
  })
  it('refuses a banned organizer, or one barred from creating events', () => {
    expect(isOrganizerBanned({ status: 'banned' })).toBe(true)
    expect(isOrganizerBanned({ can_create_events: false })).toBe(true)
    expect(publishBlockReason(live, { status: 'banned' })).toBe('organizer_banned')
    expect(isOrganizerBanned({ status: 'active', can_create_events: true })).toBe(false)
  })
})

describe('release ladder honours freezes', () => {
  const base = {
    eventId: 'e',
    organizerId: 'o',
    endsAt: '2026-01-01T00:00:00Z',
    status: 'published',
    grossMinor: 10_000,
    rail: 'card' as const,
    checkedInRatio: 1,
    manualCheckInRatio: 0,
    refundedMinor: 0,
    hasOpenDispute: false,
  }
  const history = { completedEvents: 10, lifetimeGrossMinor: 1_000_000 }
  const now = new Date('2026-06-01T00:00:00Z')
  it('releases a clean ended event', () => {
    expect(decideRelease({ event: base, history, availableMinor: 10_000, now }).release).toBe('auto')
  })
  it('holds a frozen event and a ledger-cancelled one', () => {
    expect(decideRelease({ event: { ...base, payoutsFrozen: true }, history, availableMinor: 10_000, now })).toMatchObject({
      release: 'hold',
      reason: 'payouts_frozen',
    })
    expect(
      decideRelease({ event: { ...base, settlementStatus: 'cancelled' }, history, availableMinor: 10_000, now })
    ).toMatchObject({ release: 'hold', reason: 'event_cancelled' })
  })
})

describe('completed paid events (established tier)', () => {
  const now = new Date('2026-10-01T00:00:00Z')
  const event = { is_published: true, status: 'published', end_datetime: '2026-09-01T00:00:00Z' }
  const paid = { status: 'confirmed', price_paid: 20, purchased_at: '2026-08-01T00:00:00Z' }
  it('counts a published, paid, ended event', () => {
    expect(isCompletedPaidEvent(event, [paid], now)).toBe(true)
  })
  it('does not count drafts, zero-sale, free-only, refunded-only, cancelled or frozen events', () => {
    expect(isCompletedPaidEvent({ ...event, is_published: false }, [paid], now)).toBe(false)
    expect(isCompletedPaidEvent(event, [], now)).toBe(false)
    expect(isCompletedPaidEvent(event, [{ ...paid, price_paid: 0 }], now)).toBe(false)
    expect(isCompletedPaidEvent(event, [{ ...paid, status: 'refunded', refund_status: 'approved' }], now)).toBe(false)
    expect(isCompletedPaidEvent({ ...event, status: 'cancelled' }, [paid], now)).toBe(false)
    expect(isCompletedPaidEvent({ ...event, payouts_frozen: true }, [paid], now)).toBe(false)
  })
  it('a backdated doc end does not beat the ticket-stamped end or a recent purchase', () => {
    expect(isCompletedPaidEvent(event, [{ ...paid, end_datetime: '2026-10-15T00:00:00Z' }], now)).toBe(false)
    expect(isCompletedPaidEvent(event, [{ ...paid, purchased_at: '2026-10-02T00:00:00Z' }], now)).toBe(false)
  })
})

describe('Stripe dispute opened', () => {
  beforeEach(() => {
    db.store.clear()
    db.write('events/ev1', { title: 'Show', organizer_id: 'org1', currency: 'USD' })
    db.write('users/org1', { email: 'org@x.co', full_name: 'Org' })
    db.write('tickets/t1', { event_id: 'ev1', payment_id: 'pi_1', purchased_at: '2026-09-01T00:00:00Z' })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  const dispute = (status: string) => ({
    id: 'dp_1',
    status,
    amount: 2000,
    currency: 'usd',
    payment_intent: 'pi_1',
    charge: 'ch_1',
    created: 1,
    evidence_details: {},
  })

  it('freezes the event payouts and flags the organizer, once', async () => {
    await handleStripeDisputeEvent({
      dispute: dispute('needs_response'),
      eventType: 'charge.dispute.created',
      stripeEventId: 'evt_a',
      stripeEventCreated: 100,
    })
    expect(db.store.get('events/ev1')).toMatchObject({
      payouts_frozen: true,
      payouts_frozen_reason: 'stripe_dispute',
      payouts_frozen_dispute_id: 'dp_1',
    })
    expect(db.store.get('organizers/org1')).toMatchObject({ payoutRelease: { highRisk: true, highRiskReason: 'stripe_dispute' } })

    // An admin lifts the freeze; a later update on the same dispute does not re-freeze.
    db.write('events/ev1', { payouts_frozen: false }, { merge: true })
    await handleStripeDisputeEvent({
      dispute: dispute('under_review'),
      eventType: 'charge.dispute.updated',
      stripeEventId: 'evt_b',
      stripeEventCreated: 200,
    })
    expect(db.store.get('events/ev1')).toMatchObject({ payouts_frozen: false })
  })

  it('never creates an event doc for an attribution whose event is gone', async () => {
    db.store.delete('events/ev1')
    await handleStripeDisputeEvent({
      dispute: dispute('needs_response'),
      eventType: 'charge.dispute.created',
      stripeEventId: 'evt_c',
      stripeEventCreated: 100,
    })
    expect(db.store.has('events/ev1')).toBe(false)
  })
})
