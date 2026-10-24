/**
 * Approval lists: the guest's request routes and the organizer's decision routes,
 * run as REAL route handlers against an in-memory Firestore. Approval issues
 * through the real issueFreeClaim (lib/tickets/free-claim-issue), so the
 * one-claim lock, the per-person cap and the inventory reservation are the
 * shipped ones; only the inventory transaction, delivery and push are stubbed.
 *
 * Spec: docs/specs/approval-lists-and-plus-ones.md.
 *
 * @jest-environment node
 */

import { FakeFirestore } from './helpers/fakeFirestore'

/** FakeFirestore plus `create()` (claim locks use it) on every doc ref. */
class Db extends FakeFirestore {
  ref(path: string): any {
    const base = super.ref(path)
    base.create = async (data: any) => {
      if (this.store.has(path)) {
        const err: any = new Error('6 ALREADY_EXISTS: Document already exists')
        err.code = 6
        throw err
      }
      this.store.set(path, { ...data })
    }
    return base
  }
}

const state: any = {
  db: new Db(),
  user: null as any,
  grants: {} as Record<string, boolean>,
  reserveCalls: [] as any[],
  reserveResult: { ok: true, reservationId: 'r1' } as any,
  confirmations: [] as any[],
  notifications: [] as any[],
  pushes: [] as any[],
  organizerSales: 0,
  buyerPurchases: 0,
}

jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return state.db
  },
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => state.user) }))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }))
jest.mock('@/lib/events/access-guard', () => ({
  hasEventAccess: jest.fn(async (event: any, _eventId: string, subjectId: string) =>
    !event?.is_password_protected || Boolean(state.grants[subjectId])
  ),
}))
jest.mock('@/lib/tickets/inventory', () => {
  const actual = jest.requireActual('@/lib/tickets/inventory')
  return {
    buildTierSoldIncrements: actual.buildTierSoldIncrements,
    reserveInventoryAtomic: jest.fn(async (params: any) => {
      state.reserveCalls.push(params)
      return state.reserveResult
    }),
    releaseInventoryReservation: jest.fn(async () => {}),
  }
})
jest.mock('@/lib/tickets/confirmation', () => ({
  sendTicketConfirmation: jest.fn(async (p: any) => {
    state.confirmations.push(p)
    return { emailSent: true, smsSent: false, whatsappSent: false }
  }),
}))
jest.mock('@/lib/notifications/helpers', () => ({
  createNotification: jest.fn(async (userId: string, type: string, title: string, message: string, url: string) => {
    state.notifications.push({ userId, type, title, message, url })
    return 'n1'
  }),
  notifyTicketPurchase: jest.fn(async () => {
    state.buyerPurchases += 1
  }),
  notifyOrganizerTicketSale: jest.fn(async () => {
    state.organizerSales += 1
  }),
}))
jest.mock('@/lib/notification-triggers', () => ({
  sendPushNotification: jest.fn(async (userId: string, title: string) => {
    state.pushes.push({ userId, title })
  }),
}))
jest.mock('@/lib/promoters', () => ({ recordPromoterSale: jest.fn(), resolvePromoterCode: jest.fn(async () => null) }))
jest.mock('@/lib/tracking-links', () => ({
  recordAttributedSale: jest.fn(),
  resolveOrderAttribution: jest.fn(async () => null),
}))
jest.mock('@/lib/invites/server', () => ({ recordInvitePurchase: jest.fn(async () => {}) }))

import * as guestRoute from '@/app/api/events/[id]/attend-request/route'
import * as orgRoute from '@/app/api/organizer/events/[id]/requests/route'
import * as claimFree from '@/app/api/tickets/claim-free/route'

const EVENT = 'evt1'
const GUEST = { id: 'g1', email: 'guest@x.com', full_name: 'Fabienne Laurent', role: 'attendee' }
const GUEST2 = { id: 'g2', email: 'two@x.com', full_name: 'Jean-Luc', role: 'attendee' }
const ORGANIZER = { id: 'org1', email: 'org@x.com', full_name: 'Org', role: 'organizer' }
const STRANGER = { id: 'org2', email: 'other@x.com', full_name: 'Other', role: 'organizer' }

function seedEvent(extra: Record<string, any> = {}, tiers: any[] = [{ id: 't1', name: 'RSVP', price: 0 }]) {
  state.db.store.set(`events/${EVENT}`, {
    title: 'Rooftop Konpa Night',
    organizer_id: 'org1',
    currency: 'HTG',
    is_published: true,
    status: 'published',
    start_datetime: '2099-09-01T18:00:00.000Z',
    requires_approval: true,
    plus_ones_max: 3,
    ...extra,
  })
  for (const t of tiers) state.db.store.set(`ticket_tiers/${t.id}`, { event_id: EVENT, is_active: true, ...t })
}

const ctx = (id = EVENT) => ({ params: Promise.resolve({ id }) })
const req = (body?: any) =>
  new Request('http://x/api', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

async function ask(user: any, body: any = {}) {
  state.user = user
  const res = await guestRoute.POST(req(body), ctx())
  return { status: res.status, body: await res.json() }
}
async function decide(user: any, body: any) {
  state.user = user
  const res = await orgRoute.POST(req(body), ctx())
  return { status: res.status, body: await res.json() }
}
async function list(user: any) {
  state.user = user
  const res = await orgRoute.GET(new Request('http://x/api'), ctx())
  return { status: res.status, body: await res.json() }
}
const requestDoc = (uid: string) => state.db.store.get(`attend_requests/${EVENT}__${uid}`)
const tickets = () => state.db.docsIn('tickets').map(([, d]: any) => d)

beforeEach(() => {
  state.db = new Db()
  state.user = null
  state.grants = {}
  state.reserveCalls = []
  state.reserveResult = { ok: true, reservationId: 'r1' }
  state.confirmations = []
  state.notifications = []
  state.pushes = []
  state.organizerSales = 0
  state.buyerPurchases = 0
  seedEvent()
})

describe('guest: request to join', () => {
  it('needs a session', async () => {
    const r = await ask(null, {})
    expect(r.status).toBe(401)
    expect(r.body.code).toBe('auth_required')
  })

  it('creates a pending request with a named plus-one and a note, and tells the organizer', async () => {
    const r = await ask(GUEST, { plusOnes: [{ firstName: 'Nadia', phone: '3412 3456' }], note: 'Friend of the DJ' })
    expect(r.status).toBe(201)
    expect(r.body.request).toMatchObject({ status: 'pending', quantity: 2, note: 'Friend of the DJ' })
    const doc = requestDoc('g1')
    expect(doc).toMatchObject({
      event_id: EVENT,
      organizer_id: 'org1',
      requester_id: 'g1',
      requester_email: 'guest@x.com',
      status: 'pending',
      plus_ones: [{ first_name: 'Nadia', phone: '+50934123456' }],
    })
    expect(state.notifications).toEqual([
      expect.objectContaining({ userId: 'org1', type: 'attend_request', url: `/organizer/events/${EVENT}/requests` }),
    ])
    expect(state.pushes.map((p: any) => p.userId)).toEqual(['org1'])
    // Nothing is issued until the organizer approves.
    expect(tickets()).toHaveLength(0)
    expect(state.reserveCalls).toHaveLength(0)
  })

  it('is idempotent: a second tap returns the same request and does not re-notify', async () => {
    await ask(GUEST, {})
    const again = await ask(GUEST, { note: 'changed my mind' })
    expect(again.status).toBe(200)
    expect(again.body.created).toBe(false)
    expect(state.notifications).toHaveLength(1)
  })

  it('refuses a PAID event (approval is free-only in v1)', async () => {
    seedEvent({}, [{ id: 't1', name: 'RSVP', price: 0 }, { id: 't2', name: 'VIP', price: 1500 }])
    const r = await ask(GUEST, {})
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('approval_paid_event')
    expect(requestDoc('g1')).toBeUndefined()
  })

  it('refuses an event flagged has_paid_tiers even before its tiers load', async () => {
    seedEvent({ has_paid_tiers: true })
    expect((await ask(GUEST, {})).body.code).toBe('approval_paid_event')
  })

  it('refuses an event that does not take requests', async () => {
    seedEvent({ requires_approval: false })
    const r = await ask(GUEST, {})
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('approval_not_enabled')
  })

  it('holds the access-code gate for password-protected events', async () => {
    seedEvent({ is_password_protected: true })
    expect((await ask(GUEST, {})).body.code).toBe('access_code_required')
    state.grants.g1 = true
    expect((await ask(GUEST, {})).status).toBe(201)
  })

  it('validates plus-ones and the note', async () => {
    expect((await ask(GUEST, { plusOnes: [{ firstName: '' }] })).body.code).toBe('plus_one_name_required')
    expect((await ask(GUEST, { note: 'x'.repeat(281) })).body.code).toBe('note_too_long')
  })

  it('refuses someone who already holds a free ticket for the event', async () => {
    state.db.store.set('tickets/old', { event_id: EVENT, attendee_id: 'g1', price_paid: 0, status: 'valid' })
    const r = await ask(GUEST, {})
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('already_claimed')
  })
})

describe('the cap interaction: plus-ones = min(setting, MAX_FREE_TICKETS_PER_PERSON - 1)', () => {
  it('an organizer setting of 3 allows ONE plus-one while the free cap is 2', async () => {
    state.user = GUEST
    const res = await guestRoute.GET(new Request('http://x/api'), ctx())
    const body = await res.json()
    expect(body).toMatchObject({ requiresApproval: true, allowedPlusOnes: 1, request: null })

    const two = await ask(GUEST, { plusOnes: [{ firstName: 'A' }, { firstName: 'B' }] })
    expect(two.status).toBe(400)
    expect(two.body.code).toBe('too_many_plus_ones')

    const one = await ask(GUEST, { plusOnes: [{ firstName: 'A' }] })
    expect(one.status).toBe(201)
    expect(one.body.request.quantity).toBe(2)
  })

  it('plus-ones off means none at all', async () => {
    seedEvent({ plus_ones_max: 0 })
    expect((await ask(GUEST, { plusOnes: [{ firstName: 'A' }] })).body.code).toBe('too_many_plus_ones')
  })

  it('approval issues requester + plus-one = 2 tickets, the whole per-person cap', async () => {
    await ask(GUEST, { plusOnes: [{ firstName: 'Nadia' }] })
    const r = await decide(ORGANIZER, { action: 'approve', requestId: `${EVENT}__g1` })
    expect(r.status).toBe(200)
    expect(r.body.ticketCount).toBe(2)
    expect(state.reserveCalls[0]).toMatchObject({ eventId: EVENT, quantity: 2 })
  })
})

describe('guest: cancel', () => {
  it('cancels their own pending request, and only that', async () => {
    await ask(GUEST, {})
    state.user = GUEST2
    const other = await guestRoute.DELETE(new Request('http://x/api', { method: 'DELETE' }), ctx())
    expect(other.status).toBe(404)
    expect(requestDoc('g1').status).toBe('pending')

    state.user = GUEST
    const mine = await guestRoute.DELETE(new Request('http://x/api', { method: 'DELETE' }), ctx())
    expect(mine.status).toBe(200)
    expect(requestDoc('g1').status).toBe('cancelled')

    // Cancelled requests drop off the organizer's list...
    expect((await list(ORGANIZER)).body.requests).toHaveLength(0)
    // ...and the guest can ask again.
    expect((await ask(GUEST, {})).status).toBe(201)
  })

  it('cannot cancel an answered request', async () => {
    await ask(GUEST, {})
    await decide(ORGANIZER, { action: 'decline', requestId: `${EVENT}__g1` })
    state.user = GUEST
    const res = await guestRoute.DELETE(new Request('http://x/api', { method: 'DELETE' }), ctx())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('request_not_pending')
  })
})

describe('organizer: list and ownership', () => {
  it('lists pending first, with counts', async () => {
    await ask(GUEST, { note: 'hi' })
    await ask(GUEST2, {})
    await decide(ORGANIZER, { action: 'decline', requestId: `${EVENT}__g1` })
    const r = await list(ORGANIZER)
    expect(r.status).toBe(200)
    expect(r.body.counts).toEqual({ pending: 1, approved: 0, declined: 1 })
    expect(r.body.requests.map((x: any) => x.id)).toEqual([`${EVENT}__g2`, `${EVENT}__g1`])
    expect(r.body.requests[1]).toMatchObject({ name: 'Fabienne Laurent', email: 'guest@x.com', note: 'hi', status: 'declined' })
  })

  it('refuses another organizer: no list, no approve, no decline', async () => {
    await ask(GUEST, {})
    expect((await list(STRANGER)).status).toBe(403)
    const approve = await decide(STRANGER, { action: 'approve', requestId: `${EVENT}__g1` })
    expect(approve.status).toBe(403)
    expect(approve.body.code).toBe('not_event_owner')
    expect((await decide(STRANGER, { action: 'decline', requestId: `${EVENT}__g1` })).status).toBe(403)
    expect((await decide(GUEST, { action: 'approve_all' })).status).toBe(403)
    expect(requestDoc('g1').status).toBe('pending')
    expect(tickets()).toHaveLength(0)
  })

  it('lets an admin manage any event', async () => {
    await ask(GUEST, {})
    expect((await list({ id: 'adm', role: 'admin' })).status).toBe(200)
  })

  it('will not touch a request id from another event', async () => {
    const r = await decide(ORGANIZER, { action: 'approve', requestId: 'evt9__g1' })
    expect(r.status).toBe(404)
  })
})

describe('organizer: approve', () => {
  it('issues through the free-claim path: lock, reservation, plus-one names, approval email, guest notified', async () => {
    await ask(GUEST, { plusOnes: [{ firstName: 'Nadia', phone: '+50934123456' }] })
    state.notifications = []
    state.pushes = []
    const r = await decide(ORGANIZER, { action: 'approve', requestId: `${EVENT}__g1` })
    expect(r.status).toBe(200)

    const issued = tickets()
    expect(issued).toHaveLength(2)
    for (const t of issued) {
      expect(t).toMatchObject({
        event_id: EVENT,
        attendee_id: 'g1',
        price_paid: 0,
        status: 'valid',
        payment_method: 'free',
        tier_id: 't1',
        approval_request_id: `${EVENT}__g1`,
      })
    }
    // Ticket 0 is the requester's; ticket 1 names the plus-one.
    expect(issued[0].plus_one_name).toBeUndefined()
    expect(issued[1]).toMatchObject({ plus_one_name: 'Nadia', plus_one_phone: '+50934123456' })

    // The one-claim-per-person lock is taken and records the tickets.
    const lock = state.db.store.get(`free_claim_locks/${EVENT}__g1`)
    expect(lock.ticket_ids).toHaveLength(2)
    // Inventory went through the shared reservation, never tickets_sold.
    expect(state.reserveCalls).toHaveLength(1)
    expect(state.db.store.get(`events/${EVENT}`).tickets_sold).toBeUndefined()

    const doc = requestDoc('g1')
    expect(doc).toMatchObject({ status: 'approved', decided_by: 'org1', last_error: null })
    expect(doc.ticket_ids).toHaveLength(2)

    expect(state.confirmations).toHaveLength(1)
    expect(state.confirmations[0]).toMatchObject({ approved: true, quantity: 2, recipient: expect.objectContaining({ email: 'guest@x.com' }) })
    expect(state.notifications).toEqual([
      expect.objectContaining({ userId: 'g1', type: 'attend_request_approved', url: `/tickets/event/${EVENT}` }),
    ])
    // The approval notice replaces the generic purchase/sale ones.
    expect(state.buyerPurchases).toBe(0)
    expect(state.organizerSales).toBe(0)

    // The guest now sees approved.
    state.user = GUEST
    const mine = await (await guestRoute.GET(new Request('http://x/api'), ctx())).json()
    expect(mine.request.status).toBe('approved')
  })

  it('cannot issue twice: a second approve is refused', async () => {
    await ask(GUEST, {})
    await decide(ORGANIZER, { action: 'approve', requestId: `${EVENT}__g1` })
    const again = await decide(ORGANIZER, { action: 'approve', requestId: `${EVENT}__g1` })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('request_not_pending')
    expect(tickets()).toHaveLength(1)
  })

  it('a sold-out event puts the request back to pending with the reason', async () => {
    await ask(GUEST, {})
    state.reserveResult = { ok: false, reason: 'capacity', remaining: 0 }
    const r = await decide(ORGANIZER, { action: 'approve', requestId: `${EVENT}__g1` })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('no_tickets_available')
    expect(requestDoc('g1')).toMatchObject({ status: 'pending', last_error: 'no_tickets_available' })
    expect(tickets()).toHaveLength(0)
    // The claim lock was handed back, so a later approval can succeed.
    expect(state.db.store.get(`free_claim_locks/${EVENT}__g1`)).toBeUndefined()
    state.reserveResult = { ok: true, reservationId: 'r2' }
    expect((await decide(ORGANIZER, { action: 'approve', requestId: `${EVENT}__g1` })).status).toBe(200)
  })

  it('refuses to approve once the event has a paid tier', async () => {
    await ask(GUEST, {})
    state.db.store.set('ticket_tiers/t2', { event_id: EVENT, name: 'VIP', price: 1000 })
    const r = await decide(ORGANIZER, { action: 'approve', requestId: `${EVENT}__g1` })
    expect(r.body.code).toBe('approval_paid_event')
    expect(requestDoc('g1').status).toBe('pending')
  })
})

describe('organizer: decline and approve all', () => {
  it('declines, tells the guest, and a declined guest cannot simply ask again', async () => {
    await ask(GUEST, {})
    state.notifications = []
    const r = await decide(ORGANIZER, { action: 'decline', requestId: `${EVENT}__g1` })
    expect(r.status).toBe(200)
    expect(requestDoc('g1')).toMatchObject({ status: 'declined', decided_by: 'org1' })
    expect(state.notifications).toEqual([
      expect.objectContaining({ userId: 'g1', type: 'attend_request_declined' }),
    ])
    expect(tickets()).toHaveLength(0)
    const again = await ask(GUEST, {})
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('request_declined')
  })

  it('approves every pending request', async () => {
    await ask(GUEST, {})
    await ask(GUEST2, { plusOnes: [{ firstName: 'Marc' }] })
    const r = await decide(ORGANIZER, { action: 'approve_all' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ approved: 2, failed: 0, stoppedBecause: null })
    expect(tickets()).toHaveLength(3)
    expect(requestDoc('g1').status).toBe('approved')
    expect(requestDoc('g2').status).toBe('approved')
  })

  it('stops issuing once the event sells out', async () => {
    await ask(GUEST, {})
    await ask(GUEST2, {})
    state.reserveResult = { ok: false, reason: 'capacity', remaining: 0 }
    const r = await decide(ORGANIZER, { action: 'approve_all' })
    expect(r.body).toMatchObject({ approved: 0, failed: 2, stoppedBecause: 'no_tickets_available' })
    expect(state.reserveCalls).toHaveLength(1)
    expect(requestDoc('g2').status).toBe('pending')
  })
})

describe('direct claims are closed on approval events', () => {
  it('claim-free refuses with approval_required', async () => {
    state.user = GUEST
    const res = await claimFree.POST(req({ eventId: EVENT }) as any)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('approval_required')
    expect(tickets()).toHaveLength(0)
  })

  it('claim-free accepts named plus-ones on a free non-approval event, within the cap', async () => {
    seedEvent({ requires_approval: false, plus_ones_max: 1 })
    state.user = GUEST
    const tooMany = await claimFree.POST(req({ eventId: EVENT, quantity: 3, plusOnes: [{ firstName: 'A' }, { firstName: 'B' }] }) as any)
    expect((await tooMany.json()).code).toBe('too_many_plus_ones')
    const mismatch = await claimFree.POST(req({ eventId: EVENT, quantity: 1, plusOnes: [{ firstName: 'A' }] }) as any)
    expect((await mismatch.json()).code).toBe('plus_ones_quantity_mismatch')
    const ok = await claimFree.POST(req({ eventId: EVENT, quantity: 2, plusOnes: [{ firstName: 'A' }] }) as any)
    expect(ok.status).toBe(200)
    expect(tickets().map((t: any) => t.plus_one_name)).toEqual([undefined, 'A'])
  })
})
