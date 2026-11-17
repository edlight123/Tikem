/**
 * @jest-environment node
 *
 * Mobile-money issuance is idempotent (payment audit, 2026-11-17). A ticket write
 * that failed half-way through an order, then a retry, used to issue the whole
 * order again (5 bought, 7 issued); a stale-claim re-run booked earnings twice.
 * Ticket ids are now derived from the order, and earnings / promo redemption are
 * taken once per order.
 */
import { FakeFirestore } from './helpers/fakeFirestore'

const mockFake = new FakeFirestore()

jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return mockFake
  },
}))
jest.mock('@/lib/firebase-db/server', () => ({
  // A thin supabase-style adapter over the same in-memory Firestore, so the
  // fulfillment claim (adminDb) and the order reads (supabase) see one store.
  createClient: async () => ({
    from: (table: string) => {
      const filters: Array<[string, unknown]> = []
      let patch: Record<string, any> | null = null
      let inserted: any[] | null = null
      const matches = () =>
        mockFake
          .docsIn(table)
          .filter(([p, d]) => filters.every(([f, v]) => (f === 'id' ? p.split('/').pop() === v : d[f] === v)))
      const b: any = {
        select: () => b,
        eq: (f: string, v: unknown) => {
          filters.push([f, v])
          return b
        },
        update: (p: Record<string, any>) => {
          patch = p
          return b
        },
        insert: (rows: any[]) => {
          inserted = rows.map((row) => {
            const id = `t${mockFake.docsIn(table).length + 1}`
            mockFake.write(`${table}/${id}`, { ...row })
            return { id, ...row }
          })
          return b
        },
        single: async () => {
          const m = matches()[0]
          return { data: m ? { id: m[0].split('/').pop(), ...m[1] } : null, error: null }
        },
        then: (resolve: any) => {
          if (inserted) return resolve({ data: inserted, error: null })
          if (patch) for (const [p] of matches()) mockFake.write(p, patch, { merge: true })
          return resolve({ error: null })
        },
      }
      return b
    },
  }),
}))
jest.mock('@/lib/tickets/inventory', () => ({
  buildTierSoldIncrements: (sel: any[]) => sel.map((s) => ({ tierId: s.tierId, quantity: s.quantity })),
  convertSeatHold: jest.fn(async () => ({ ok: true })),
  releaseInventoryReservation: jest.fn(async () => undefined),
}))
jest.mock('@/lib/earnings', () => ({ addTicketToEarnings: jest.fn(async () => undefined) }))
jest.mock('@/lib/tickets/confirmation', () => ({ sendTicketConfirmation: jest.fn(async () => ({})) }))
jest.mock('@/lib/notifications/helpers', () => ({ notifyTicketPurchase: jest.fn(async () => undefined) }))
jest.mock('@/lib/notifications/campaigns', () => ({ onSaleCompleted: jest.fn(async () => undefined) }))
jest.mock('@/lib/promo-codes', () => ({
  promoBuyerKey: () => null,
  redeemPromoInTransaction: jest.fn(async () => ({ capReached: false })),
}))
jest.mock('@/lib/promoters', () => ({ recordPromoterSale: jest.fn(async () => ({ recorded: false })) }))
jest.mock('@/lib/tracking-links', () => ({ recordAttributedSale: jest.fn(async () => null) }))
jest.mock('@/lib/invites/server', () => ({ recordInvitePurchase: jest.fn(async () => undefined) }))
jest.mock('@/lib/attribution', () => ({
  sanitizeAttribution: () => null,
  ticketAttributionFields: () => ({}),
  withResolvedPromoter: (a: any) => a,
}))
jest.mock('@/lib/guest/identity', () => ({
  attachTicketsToGuestOrder: jest.fn(async () => undefined),
  isGuestId: (id: unknown) => String(id || '').startsWith('guest_'),
}))
jest.mock('@/lib/guest/checkout', () => ({
  guestRecipientFromOrder: (o: any) =>
    o?.is_guest ? { email: o.guest_email, name: 'G', phone: '', isGuest: true, guestToken: null } : null,
}))

import { fulfillPaidOrder, orderTicketId } from '@/lib/tickets/fulfillment'
import { addTicketToEarnings } from '@/lib/earnings'
import { redeemPromoInTransaction } from '@/lib/promo-codes'

function seedOrder(orderId: string, extra: Record<string, any> = {}) {
  mockFake.write(`pending_transactions/${orderId}`, {
    order_id: orderId,
    user_id: 'u1',
    event_id: 'evt1',
    status: 'pending',
    quantity: 3,
    amount: 3000,
    original_amount: 3000,
    currency: 'HTG',
    original_currency: 'HTG',
    promo_code_id: 'promo1',
    tier_selections: [{ tierId: 'ga', tierName: 'GA', quantity: 3, unitPrice: 1000, listUnitPrice: 1000 }],
    ...extra,
  })
}
const tickets = () => mockFake.docsIn('tickets').map(([, d]) => d as any)

beforeEach(() => {
  mockFake.store.clear()
  mockFake.write('events/evt1', { title: 'Show' })
  mockFake.write('users/u1', { email: 'u1@x.co', full_name: 'U One' })
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('a write that fails on ticket 2 of 3, then a retry, ends with exactly 3 tickets', async () => {
  seedOrder('o1')
  const real = mockFake.runTransaction.bind(mockFake)
  let calls = 0
  const spy = jest.spyOn(mockFake, 'runTransaction').mockImplementation(async (fn: any) => {
    // Ticket writes are the transactions that touch tickets/…; fail the second.
    let touchesTicket = false
    const out = await real(async (tx: any) => {
      const origSet = tx.set.bind(tx)
      tx.set = (ref: any, ...rest: any[]) => {
        if (String(ref?._path || '').startsWith('tickets/')) {
          touchesTicket = true
          if (++calls === 2) throw new Error('firestore unavailable')
        }
        return origSet(ref, ...rest)
      }
      return fn(tx)
    })
    void touchesTicket
    return out
  })

  const first = await fulfillPaidOrder({ orderId: 'o1', paymentMethod: 'moncash' })
  expect(first.outcome).toBe('ticket_creation_failed')
  expect(tickets()).toHaveLength(1)
  spy.mockRestore()

  const retry = await fulfillPaidOrder({ orderId: 'o1', paymentMethod: 'moncash' })
  expect(retry.outcome).toBe('fulfilled')
  expect(tickets()).toHaveLength(3)
  expect(tickets().map((t) => t.id).sort()).toEqual([0, 1, 2].map((i) => orderTicketId('o1', i)).sort())
  expect(tickets().every((t) => t.qr_code_data === t.id)).toBe(true)
  expect(addTicketToEarnings).toHaveBeenCalledTimes(1)
  expect(redeemPromoInTransaction).toHaveBeenCalledTimes(1)
})

it('a stale-claim re-run of a finished-but-unmarked order issues and books nothing twice', async () => {
  seedOrder('o2')
  expect((await fulfillPaidOrder({ orderId: 'o2', paymentMethod: 'moncash' })).outcome).toBe('fulfilled')
  // The runner died before marking the order completed; the claim went stale.
  mockFake.write('pending_transactions/o2', { status: 'processing', fulfillment_started_at: '2000-01-01T00:00:00Z', ticket_id: null }, { merge: true })
  expect((await fulfillPaidOrder({ orderId: 'o2', paymentMethod: 'moncash' })).outcome).toBe('fulfilled')
  expect(tickets()).toHaveLength(3)
  expect(addTicketToEarnings).toHaveBeenCalledTimes(1)
  expect(redeemPromoInTransaction).toHaveBeenCalledTimes(1)
})

it('ticket ids are not guessable from the order id alone', () => {
  expect(orderTicketId('o1', 0)).toMatch(/^mm_o1_0_[0-9a-f]{16}$/)
  expect(orderTicketId('o1', 0)).not.toBe(orderTicketId('o1', 1))
})
