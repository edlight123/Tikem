/**
 * @jest-environment node
 *
 * POST /api/refunds/request — a buyer asking for a refund (mobile
 * RefundRequestScreen). It used to fail for every ticket: `.eq('id')` matched
 * nothing (ticket docs carry no `id` field), the `events(*)` join was ignored,
 * and a ticket with no refund_status was read as "already requested".
 */

import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))

let sessionUser: { id: string; email: string } | null = { id: 'buyer_1', email: 'buyer@example.com' }
jest.mock('@/lib/firebase/server', () => ({
  getServerSession: async () => ({ user: sessionUser, error: sessionUser ? null : 'No session' }),
}))

const sendEmail = jest.fn(async (_args: any) => ({ success: true }))
jest.mock('@/lib/email', () => ({
  sendEmail: (args: any) => sendEmail(args),
  getRefundRequestEmail: (p: any) => `request ${p.ticketId}`,
  emailSubjects: { refundRequest: (_l: any, t: string) => `Refund request for ${t}` },
}))
jest.mock('@/lib/email-kit/recipient', () => ({
  resolveEmailLang: async () => 'en',
}))

import { POST } from '@/app/api/refunds/request/route'

const DAY = 24 * 3_600_000
const call = (body: Record<string, any>) =>
  POST(new Request('http://localhost/api/refunds/request', { method: 'POST', body: JSON.stringify(body) }))
const ticket = (id: string) => db.store.get(`tickets/${id}`) as Record<string, any>

beforeEach(() => {
  db.store.clear()
  sessionUser = { id: 'buyer_1', email: 'buyer@example.com' }
  sendEmail.mockClear()
  db.write('users/org_1', { email: 'org@example.com', full_name: 'Org' })
  db.write('events/ev_future', {
    title: 'Kanaval',
    organizer_id: 'org_1',
    start_datetime: new Date(Date.now() + 5 * DAY).toISOString(),
  })
  db.write('events/ev_soon', {
    title: 'Tonight',
    organizer_id: 'org_1',
    start_datetime: new Date(Date.now() + 3_600_000).toISOString(),
  })
  // No `id` field and no `refund_status`, exactly as purchases write them.
  db.write('tickets/t_mine', { event_id: 'ev_future', status: 'valid', attendee_id: 'buyer_1', price_paid: 1500 })
  db.write('tickets/t_userid', { event_id: 'ev_future', status: 'confirmed', user_id: 'buyer_1', price_paid: 1500 })
  db.write('tickets/t_other', { event_id: 'ev_future', status: 'valid', attendee_id: 'someone_else' })
  db.write('tickets/t_soon', { event_id: 'ev_soon', status: 'valid', attendee_id: 'buyer_1' })
  db.write('tickets/t_requested', { event_id: 'ev_future', status: 'valid', attendee_id: 'buyer_1', refund_status: 'requested' })
  db.write('tickets/t_refunded', { event_id: 'ev_future', status: 'refunded', attendee_id: 'buyer_1' })
})

describe('POST /api/refunds/request', () => {
  it('records a request for a ticket with no id field and no refund_status', async () => {
    const res = await call({ ticketId: 't_mine', reasonCategory: 'cant_attend', details: 'I have a family emergency that week' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      message: 'Refund request submitted. The organizer and Tikèm will review it and email you the decision.',
    })
    expect(ticket('t_mine')).toMatchObject({
      refund_status: 'requested',
      refund_reason: "Can't attend: I have a family emergency that week",
      refund_reason_category: 'cant_attend',
      refund_requested_by: 'buyer_1',
      refund_requested_via: 'account',
    })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'org@example.com' }))
  })

  it('accepts ownership through user_id as well as attendee_id', async () => {
    const res = await call({ ticketId: 't_userid', reason: 'I got sick and cannot travel there' })
    expect(res.status).toBe(200)
    expect(ticket('t_userid').refund_status).toBe('requested')
  })

  it('answers 404 for someone else’s ticket and writes nothing', async () => {
    const res = await call({ ticketId: 't_other', reasonCategory: 'other', details: 'I have a family emergency that week' })
    expect(res.status).toBe(404)
    expect(ticket('t_other').refund_status).toBeUndefined()
  })

  it('refuses a second request', async () => {
    const res = await call({ ticketId: 't_requested', reasonCategory: 'other', details: 'I have a family emergency that week' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already requested/)
  })

  it('refuses a ticket that is no longer live', async () => {
    const res = await call({ ticketId: 't_refunded', reasonCategory: 'other', details: 'I have a family emergency that week' })
    expect(res.status).toBe(400)
  })

  it('enforces the 24-hour deadline from the event doc', async () => {
    const res = await call({ ticketId: 't_soon', reasonCategory: 'other', details: 'I have a family emergency that week' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/deadline/)
  })

  it('requires a session', async () => {
    sessionUser = null
    const res = await call({ ticketId: 't_mine', reasonCategory: 'other', details: 'I have a family emergency that week' })
    expect(res.status).toBe(401)
  })

  it('requires a ticket id and reason', async () => {
    const res = await call({ ticketId: 't_mine' })
    expect(res.status).toBe(400)
  })

  it('rejects a request with no reason category', async () => {
    const res = await call({ ticketId: 't_mine', details: '' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('reason_required')
    expect(ticket('t_mine').refund_status).toBeUndefined()
  })

  it('rejects an unknown reason category', async () => {
    const res = await call({ ticketId: 't_mine', reasonCategory: 'bogus', details: 'I have a family emergency that week' })
    expect(res.status).toBe(400)
    expect(ticket('t_mine').refund_status).toBeUndefined()
  })

  it('rejects an explanation shorter than 20 characters', async () => {
    const res = await call({ ticketId: 't_mine', reasonCategory: 'cant_attend', details: 'too short' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('details_too_short')
    expect(ticket('t_mine').refund_status).toBeUndefined()
  })

  it('rejects whitespace padding as an explanation', async () => {
    const res = await call({ ticketId: 't_mine', reasonCategory: 'other', details: '     a      b     c         ' })
    expect(res.status).toBe(400)
  })

  it('rejects the old mobile shape that sends only a category key', async () => {
    const res = await call({ ticketId: 't_mine', reason: 'cannot_attend' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('details_too_short')
  })

  it('refuses a checked-in ticket', async () => {
    db.write('tickets/t_used', { event_id: 'ev_future', status: 'valid', attendee_id: 'buyer_1', checked_in_at: new Date().toISOString() })
    const res = await call({ ticketId: 't_used', reasonCategory: 'other', details: 'I have a family emergency that week' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('checked_in')
    expect(ticket('t_used').refund_status).toBeUndefined()
  })

  it('refuses a past event', async () => {
    db.write('events/ev_past', { title: 'Done', organizer_id: 'org_1', start_datetime: new Date(Date.now() - DAY).toISOString() })
    db.write('tickets/t_past', { event_id: 'ev_past', status: 'valid', attendee_id: 'buyer_1' })
    const res = await call({ ticketId: 't_past', reasonCategory: 'other', details: 'I have a family emergency that week' })
    expect(res.status).toBe(400)
  })

  it('allows only one open request: a second submission is refused and the first reason is kept', async () => {
    const first = await call({ ticketId: 't_mine', reasonCategory: 'cant_attend', details: 'I have a family emergency that week' })
    expect(first.status).toBe(200)
    const second = await call({ ticketId: 't_mine', reasonCategory: 'billing_issue', details: 'I was charged twice for the same ticket' })
    expect(second.status).toBe(400)
    expect((await second.json()).code).toBe('already_requested')
    expect(ticket('t_mine').refund_reason_category).toBe('cant_attend')
  })

  it('never refunds automatically: only a pending request is recorded', async () => {
    const res = await call({ ticketId: 't_mine', reasonCategory: 'event_changed', details: 'The headliner was replaced last minute' })
    expect(res.status).toBe(200)
    const t = ticket('t_mine')
    // The ticket stays live and nothing about money changes.
    expect(t.status).toBe('valid')
    expect(t.refund_status).toBe('requested')
    expect(t.refunded_at).toBeUndefined()
    expect(t.refund_amount).toBeUndefined()
    // No refund review, manual queue or provider refund was created.
    const keys = Array.from(db.store.keys())
    expect(keys.filter((k) => /^(refund_reviews|manual_refund_queue|refunds)\//.test(k))).toEqual([])
  })
})

