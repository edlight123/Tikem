/**
 * @jest-environment node
 *
 * /api/tickets/transfer/respond must only move a ticket that still belongs to
 * the transfer's sender, must accept the same live statuses the request route
 * does (valid | confirmed | active), and must persist 'expired'.
 */

type Doc = Record<string, any>
const store: Record<string, Map<string, Doc>> = {
  tickets: new Map(),
  ticket_transfers: new Map(),
  users: new Map(),
}

function ref(col: string, id: string) {
  return { col, id }
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (col: string) => ({
      doc: (id: string) => ({
        ...ref(col, id),
        get: async () => ({ exists: store[col]?.has(id) ?? false, data: () => store[col]?.get(id) }),
      }),
      where: (_f: string, _op: string, token: string) => ({
        limit: () => ({
          get: async () => {
            const hits = Array.from(store.ticket_transfers.entries()).filter(([, d]) => d.transfer_token === token)
            return { empty: hits.length === 0, docs: hits.map(([id]) => ({ id, ref: ref('ticket_transfers', id) })) }
          },
        }),
      }),
    }),
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      const writes: Array<() => void> = []
      const tx = {
        get: async (r: { col: string; id: string }) => ({
          exists: store[r.col].has(r.id),
          data: () => store[r.col].get(r.id),
        }),
        update: (r: { col: string; id: string }, patch: Doc) => {
          writes.push(() => store[r.col].set(r.id, { ...store[r.col].get(r.id), ...patch }))
        },
      }
      const result = await fn(tx) // a throw discards `writes`, like Firestore
      writes.forEach((w) => w())
      return result
    },
  },
}))

jest.mock('@/lib/auth', () => ({
  getCurrentUser: async () => ({ id: 'buyer2', email: 'buyer2@example.com' }),
}))
jest.mock('@/lib/notifications/helpers', () => ({ createNotification: jest.fn() }))
jest.mock('@/lib/notification-triggers', () => ({ sendPushNotification: jest.fn() }))
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn(), getTicketTransferResponseEmail: () => '' }))

import { POST } from '@/app/api/tickets/transfer/respond/route'

const future = new Date(Date.now() + 3600_000).toISOString()

function seed(ticket: Doc, transfer: Doc = {}) {
  store.tickets.clear()
  store.ticket_transfers.clear()
  store.users.clear()
  store.users.set('buyer2', { full_name: 'Buyer Two', email: 'stale-profile@example.com' })
  store.tickets.set('t1', { event_id: 'e1', status: 'valid', attendee_id: 'seller', user_id: 'seller', ...ticket })
  store.ticket_transfers.set('tr1', {
    ticket_id: 't1',
    from_user_id: 'seller',
    to_email: 'buyer2@example.com',
    status: 'pending',
    transfer_token: 'tok',
    expires_at: future,
    ...transfer,
  })
}

const accept = () => POST({ json: async () => ({ transferToken: 'tok', action: 'accept' }) } as any)

describe('POST /api/tickets/transfer/respond', () => {
  it('moves a ticket the sender still holds', async () => {
    seed({})
    const res = await accept()
    expect(res.status).toBe(200)
    expect(store.tickets.get('t1')).toMatchObject({ attendee_id: 'buyer2', user_id: 'buyer2', transfer_count: 1 })
    expect(store.ticket_transfers.get('tr1')?.status).toBe('accepted')
  })

  it("puts the new holder's name and Auth email on the ticket", async () => {
    seed({ attendee_name: 'Seller Name', attendee_email: 'seller@example.com' })
    const res = await accept()
    expect(res.status).toBe(200)
    // The Auth email, never the profile copy.
    expect(store.tickets.get('t1')).toMatchObject({ attendee_name: 'Buyer Two', attendee_email: 'buyer2@example.com' })
  })

  it("refuses a ticket that is not the sender's (forged / stale transfer)", async () => {
    seed({ attendee_id: 'victim', user_id: 'victim' })
    const res = await accept()
    expect(res.status).toBe(400)
    expect(store.tickets.get('t1')).toMatchObject({ attendee_id: 'victim', user_id: 'victim' })
    expect(store.ticket_transfers.get('tr1')?.status).toBe('pending')
  })

  it('accepts a confirmed (MonCash/SogePay) ticket, like the request route', async () => {
    seed({ status: 'confirmed' })
    const res = await accept()
    expect(res.status).toBe(200)
    expect(store.tickets.get('t1')?.attendee_id).toBe('buyer2')
  })

  it('refuses a refunded or checked-in ticket', async () => {
    seed({ status: 'refunded' })
    expect((await accept()).status).toBe(400)
    seed({ checked_in: true })
    expect((await accept()).status).toBe(400)
  })

  it('refuses while a refund is requested or moving, and still accepts after a denial', async () => {
    for (const refund_status of ['requested', 'processing', 'admin_review', 'approved']) {
      seed({ refund_status, refund_requested_by: 'seller' })
      expect((await accept()).status).toBe(400)
      expect(store.tickets.get('t1')?.attendee_id).toBe('seller')
    }
    seed({ refund_status: 'denied', refund_requested_by: 'seller' })
    expect((await accept()).status).toBe(200)
    // The old holder's request does not follow the seat.
    expect(store.tickets.get('t1')).toMatchObject({ attendee_id: 'buyer2', refund_requested_by: null })
  })

  it('persists an expired transfer instead of rolling it back', async () => {
    seed({}, { expires_at: new Date(Date.now() - 1000).toISOString() })
    const res = await accept()
    expect(res.status).toBe(400)
    expect(store.ticket_transfers.get('tr1')?.status).toBe('expired')
    expect(store.tickets.get('t1')?.attendee_id).toBe('seller')
  })
})
