/**
 * POST /api/tickets/transfer/request: an unaccepted transfer past its 24h expiry
 * no longer locks the ticket.
 *
 * @jest-environment node
 */

type Doc = Record<string, any>
const db: Record<string, Record<string, Doc>> = {}
const updates: Array<{ col: string; id: string; patch: Doc }> = []

function query(col: string, filters: Array<[string, any]>) {
  return {
    where: (f: string, _op: string, v: any) => query(col, [...filters, [f, v]]),
    limit: () => query(col, filters),
    get: async () => {
      const docs = Object.entries(db[col] || {})
        .filter(([, d]) => filters.every(([f, v]) => d[f] === v))
        .map(([id, d]) => ({
          id,
          data: () => d,
          ref: { update: async (patch: Doc) => { updates.push({ col, id, patch }); Object.assign(d, patch) } },
        }))
      return { empty: docs.length === 0, docs }
    },
  }
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (col: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: Boolean(db[col]?.[id]), data: () => db[col]?.[id] }),
        set: async (data: Doc) => { db[col] = db[col] || {}; db[col][id] = data },
        update: async (patch: Doc) => { updates.push({ col, id, patch }); Object.assign(db[col][id], patch) },
      }),
      where: (f: string, _op: string, v: any) => query(col, [[f, v]]),
    }),
  },
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => ({ id: 'u1', email: 'owner@x.com' })) }))
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: jest.fn() }))
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: jest.fn() }))
jest.mock('@/lib/email', () => ({
  sendEmail: jest.fn(async () => ({ success: true })),
  getTicketTransferRequestEmail: () => '<p/>',
  emailSubjects: { transferRequest: () => 'subject' },
}))
jest.mock('@/lib/email-kit/recipient', () => ({ resolveEmailLang: async () => 'en' }))

import { POST } from '@/app/api/tickets/transfer/request/route'

function req() {
  return new Request('http://localhost/api/tickets/transfer/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketId: 't1', toEmail: 'friend@x.com' }),
  }) as any
}

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  updates.length = 0
  db.tickets = { t1: { attendee_id: 'u1', status: 'valid', event_id: 'e1' } }
  db.events = { e1: { title: 'Show', start_datetime: '2099-01-01T20:00:00.000Z' } }
  db.users = {}
})

describe('transfer request vs. a stale pending transfer', () => {
  it('treats a pending transfer past its expiry as not pending, marks it expired, and creates a new one', async () => {
    db.ticket_transfers = {
      old: { ticket_id: 't1', status: 'pending', from_user_id: 'u1', expires_at: new Date(Date.now() - 60_000).toISOString() },
    }
    const res = await POST(req())
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(db.ticket_transfers.old.status).toBe('expired')
    const fresh = Object.values(db.ticket_transfers).filter((t: any) => t.status === 'pending')
    expect(fresh).toHaveLength(1)
  })

  it('still refuses while an unexpired transfer is pending', async () => {
    db.ticket_transfers = {
      live: { ticket_id: 't1', status: 'pending', from_user_id: 'u1', expires_at: new Date(Date.now() + 3_600_000).toISOString() },
    }
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('transfer_pending')
    expect(db.ticket_transfers.live.status).toBe('pending')
  })
})
