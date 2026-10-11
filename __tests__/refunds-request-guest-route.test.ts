/**
 * @jest-environment node
 *
 * POST /api/refunds/request/guest — a guest (no account) asking for a refund
 * from their ticket link. The signed token is the only credential; the body's
 * ticketId only selects among that order's own tickets. Same reason rules and
 * the same pending-only outcome as the account route.
 */

import fs from 'node:fs'
import path from 'node:path'
import { FakeFirestore } from './helpers/fakeFirestore'

const db = new FakeFirestore()
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db
  },
}))

const sendEmail = jest.fn(async (_args: any) => ({ success: true }))
jest.mock('@/lib/email', () => ({
  sendEmail: (args: any) => sendEmail(args),
  getRefundRequestEmail: (p: any) => `request ${p.ticketId} ${p.attendeeEmail}`,
  emailSubjects: { refundRequest: (_l: any, t: string) => `Refund request for ${t}` },
}))
jest.mock('@/lib/email-kit/recipient', () => ({
  resolveEmailLang: async () => 'en',
}))

import { POST } from '@/app/api/refunds/request/guest/route'
import { guestTokenFor } from '@/lib/guest/identity'

const DAY = 24 * 3_600_000
const ORDER_KEY = 'a'.repeat(48)
const OTHER_ORDER_KEY = 'b'.repeat(48)
const TOKEN = guestTokenFor(ORDER_KEY)
const DETAILS = 'I can no longer travel to Jacmel that weekend'

const call = (body: Record<string, any>) =>
  POST(new Request('http://localhost/api/refunds/request/guest', { method: 'POST', body: JSON.stringify(body) }))
const ticket = (id: string) => db.store.get(`tickets/${id}`) as Record<string, any>

beforeEach(() => {
  db.store.clear()
  sendEmail.mockClear()
  db.write('users/org_1', { email: 'org@example.com', full_name: 'Org' })
  db.write('events/ev_future', {
    title: 'Kanaval',
    organizer_id: 'org_1',
    start_datetime: new Date(Date.now() + 5 * DAY).toISOString(),
  })
  db.write(`guest_orders/${ORDER_KEY}`, {
    guest_id: 'guest_abc',
    email: 'guest@example.com',
    event_id: 'ev_future',
    status: 'issued',
    ticket_ids: ['g_1', 'g_claimed'],
  })
  db.write(`guest_orders/${OTHER_ORDER_KEY}`, {
    guest_id: 'guest_xyz',
    email: 'other@example.com',
    event_id: 'ev_future',
    status: 'issued',
    ticket_ids: ['g_other'],
  })
  db.write('tickets/g_1', { event_id: 'ev_future', status: 'valid', attendee_id: 'guest_abc', price_paid: 1000 })
  // Claimed onto an account: no longer the guest's to act on via the link.
  db.write('tickets/g_claimed', { event_id: 'ev_future', status: 'valid', attendee_id: 'user_9' })
  db.write('tickets/g_other', { event_id: 'ev_future', status: 'valid', attendee_id: 'guest_xyz' })
})

describe('POST /api/refunds/request/guest', () => {
  it('records a pending request for a ticket on the token’s order and tells the organizer', async () => {
    const res = await call({ token: TOKEN, ticketId: 'g_1', reasonCategory: 'cant_attend', details: DETAILS })
    expect(res.status).toBe(200)
    expect(ticket('g_1')).toMatchObject({
      status: 'valid',
      refund_status: 'requested',
      refund_reason_category: 'cant_attend',
      refund_reason_details: DETAILS,
      refund_requested_by: 'guest_abc',
      refund_requested_via: 'guest_link',
    })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'org@example.com' }))
    expect(String(sendEmail.mock.calls[0][0].html)).toContain('guest@example.com')
  })

  it('rejects a missing or forged token and writes nothing', async () => {
    for (const token of ['', `${ORDER_KEY}.forgedsignature000000`, 'garbage']) {
      const res = await call({ token, ticketId: 'g_1', reasonCategory: 'other', details: DETAILS })
      expect(res.status).toBe(404)
    }
    expect(ticket('g_1').refund_status).toBeUndefined()
  })

  it('refuses a ticket that belongs to a different guest order', async () => {
    const res = await call({ token: TOKEN, ticketId: 'g_other', reasonCategory: 'other', details: DETAILS })
    expect(res.status).toBe(404)
    expect(ticket('g_other').refund_status).toBeUndefined()
  })

  it('refuses a ticket on the order that has since moved to an account', async () => {
    const res = await call({ token: TOKEN, ticketId: 'g_claimed', reasonCategory: 'other', details: DETAILS })
    expect(res.status).toBe(404)
    expect(ticket('g_claimed').refund_status).toBeUndefined()
  })

  it('requires a reason and a 20-character explanation', async () => {
    const noReason = await call({ token: TOKEN, ticketId: 'g_1', details: '' })
    expect(noReason.status).toBe(400)
    const short = await call({ token: TOKEN, ticketId: 'g_1', reasonCategory: 'other', details: 'refund pls' })
    expect(short.status).toBe(400)
    expect((await short.json()).code).toBe('details_too_short')
    expect(ticket('g_1').refund_status).toBeUndefined()
  })

  it('allows only one open request per ticket', async () => {
    expect((await call({ token: TOKEN, ticketId: 'g_1', reasonCategory: 'other', details: DETAILS })).status).toBe(200)
    const again = await call({ token: TOKEN, ticketId: 'g_1', reasonCategory: 'billing_issue', details: DETAILS })
    expect(again.status).toBe(400)
    expect((await again.json()).code).toBe('already_requested')
  })

  it('never refunds automatically: no review, queue or refund record is created', async () => {
    await call({ token: TOKEN, ticketId: 'g_1', reasonCategory: 'event_changed', details: DETAILS })
    const keys = Array.from(db.store.keys())
    expect(keys.filter((k) => /^(refund_reviews|manual_refund_queue|refunds)\//.test(k))).toEqual([])
    expect(ticket('g_1').status).toBe('valid')
  })
})

describe('refund request module', () => {
  it('does not reach the refund executor or the admin review path', () => {
    // Structural guard for the owner rule "never automatic": the request
    // module and both routes must not import anything that moves money.
    const files = [
      'lib/tickets/refundRequest.ts',
      'app/api/refunds/request/route.ts',
      'app/api/refunds/request/guest/route.ts',
    ]
    for (const f of files) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
      const imports = src.match(/(?:from\s+|import\()\s*['"][^'"]+['"]/g) || []
      expect(imports.length).toBeGreaterThan(0)
      for (const spec of imports) {
        expect(spec).not.toMatch(/refundExecution|refundReview|stripe|moncash|manualRefundQueue|refundCoverage/i)
      }
      expect(src).not.toMatch(/\brefundTicket\(/)
    }
  })
})
