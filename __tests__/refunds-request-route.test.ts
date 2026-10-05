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
    const res = await call({ ticketId: 't_mine', reason: 'Cannot attend' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      message: 'Refund request submitted. The organizer will review your request.',
    })
    expect(ticket('t_mine')).toMatchObject({
      refund_status: 'requested',
      refund_reason: 'Cannot attend',
      refund_requested_by: 'buyer_1',
    })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'org@example.com' }))
  })

  it('accepts ownership through user_id as well as attendee_id', async () => {
    const res = await call({ ticketId: 't_userid', reason: 'Sick' })
    expect(res.status).toBe(200)
    expect(ticket('t_userid').refund_status).toBe('requested')
  })

  it('answers 404 for someone else’s ticket and writes nothing', async () => {
    const res = await call({ ticketId: 't_other', reason: 'x' })
    expect(res.status).toBe(404)
    expect(ticket('t_other').refund_status).toBeUndefined()
  })

  it('refuses a second request', async () => {
    const res = await call({ ticketId: 't_requested', reason: 'again' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already requested/)
  })

  it('refuses a ticket that is no longer live', async () => {
    const res = await call({ ticketId: 't_refunded', reason: 'x' })
    expect(res.status).toBe(400)
  })

  it('enforces the 24-hour deadline from the event doc', async () => {
    const res = await call({ ticketId: 't_soon', reason: 'x' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/deadline/)
  })

  it('requires a session', async () => {
    sessionUser = null
    const res = await call({ ticketId: 't_mine', reason: 'x' })
    expect(res.status).toBe(401)
  })

  it('requires a ticket id and reason', async () => {
    const res = await call({ ticketId: 't_mine' })
    expect(res.status).toBe(400)
  })
})
