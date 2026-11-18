/**
 * POST /api/tickets/transfer/request with { toUserId }: the app's friend picker.
 * Only accepted friends, the friend's email is resolved server-side and never
 * echoed back to the sender.
 *
 * @jest-environment node
 */

type Doc = Record<string, any>
const db: Record<string, Record<string, Doc>> = {}
const sent: string[] = []

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (col: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: Boolean(db[col]?.[id]), data: () => db[col]?.[id] }),
        set: async (data: Doc) => { db[col] = db[col] || {}; db[col][id] = data },
        update: async (patch: Doc) => { Object.assign(db[col][id], patch) },
      }),
      where: () => ({
        where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
        limit: () => ({ get: async () => ({ empty: true, docs: [] }) }),
        get: async () => ({ empty: true, docs: [] }),
      }),
    }),
  },
}))
jest.mock('@/lib/firestore/connections', () => ({
  getConnectionBetween: jest.fn(async (a: string, b: string) => db.connections?.[[a, b].sort().join('_')] || null),
}))
jest.mock('@/lib/tickets/transfers', () => ({
  findLivePendingTransfer: jest.fn(async () => null),
  TRANSFER_TTL_MS: 86_400_000,
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => ({ id: 'u1', email: 'owner@x.com' })) }))
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: jest.fn() }))
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: jest.fn() }))
jest.mock('@/lib/email', () => ({
  sendEmail: jest.fn(async ({ to }: { to: string }) => { sent.push(to); return { success: true } }),
  getTicketTransferRequestEmail: () => '<p/>',
  emailSubjects: { transferRequest: () => 'subject' },
}))
jest.mock('@/lib/email-kit/recipient', () => ({ resolveEmailLang: async () => 'en' }))

import { POST } from '@/app/api/tickets/transfer/request/route'

function req(body: Doc) {
  return new Request('http://localhost/api/tickets/transfer/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketId: 't1', ...body }),
  }) as any
}

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  sent.length = 0
  db.tickets = { t1: { attendee_id: 'u1', status: 'valid', event_id: 'e1' } }
  db.events = { e1: { title: 'Show', start_datetime: '2099-01-01T20:00:00.000Z' } }
  db.users = { u2: { email: 'Friend@X.com' }, u3: { email: 'stranger@x.com' }, u4: {} }
  db.connections = {
    u1_u2: { status: 'accepted' },
    u1_u4: { status: 'accepted' },
  }
})

describe('transfer to a friend by uid', () => {
  it('sends to an accepted friend, records their uid, and never returns their email', async () => {
    const res = await POST(req({ toUserId: 'u2' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.transfer.toEmail).toBeNull()
    expect(sent).toEqual(['Friend@X.com'])
    const t = Object.values(db.ticket_transfers)[0] as Doc
    expect(t.to_email).toBe('friend@x.com')
    expect(t.to_user_id).toBe('u2')
  })

  it('refuses a user who is not a friend', async () => {
    const res = await POST(req({ toUserId: 'u3' }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_friends')
    expect(db.ticket_transfers).toBeUndefined()
  })

  it('explains when the friend has no email', async () => {
    const res = await POST(req({ toUserId: 'u4' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('friend_no_email')
  })

  it('rejects both or neither recipient', async () => {
    expect((await POST(req({}))).status).toBe(400)
    expect((await POST(req({ toUserId: 'u2', toEmail: 'a@b.co' }))).status).toBe(400)
  })
})
