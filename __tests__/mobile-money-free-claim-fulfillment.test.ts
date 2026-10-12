/**
 * @jest-environment node
 *
 * Free lines in a paid MonCash / SogePay order (lib/tickets/fulfillment.ts
 * fulfillPaidOrder, which both rails' callbacks use): the buyer's one free claim
 * per event is taken at issue time under the same lock as the free-claim route
 * and the card rail, keyed by the pending order. Held by another order → the free
 * lines are dropped and only the paid ones are issued, with the amount, the fee
 * split and the earnings unchanged. A retry repeats the same decision.
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

import { fulfillPaidOrder, isFreeOrderLine } from '@/lib/tickets/fulfillment'
import { freeClaimLockId } from '@/lib/tickets/free-claim-policy'
import { addTicketToEarnings } from '@/lib/earnings'
import { convertSeatHold } from '@/lib/tickets/inventory'

const EVENT = 'evt1'
const lockPath = (id = { isGuest: false, id: 'u1' }) => `free_claim_locks/${freeClaimLockId(EVENT, id)}`

/** 2 free RSVP + 2 GA at 1000 HTG, buyer passes on a 200 HTG fee. */
function seedOrder(orderId: string, extra: Record<string, any> = {}) {
  mockFake.write(`pending_transactions/${orderId}`, {
    order_id: orderId,
    user_id: 'u1',
    event_id: EVENT,
    status: 'pending',
    quantity: 4,
    amount: 2200,
    face_amount: 2000,
    original_amount: 2000,
    currency: 'HTG',
    original_currency: 'HTG',
    fee_incidence: 'buyer',
    buyer_fee: 200,
    buyer_fee_original: 200,
    tier_selections: [
      { tierId: 'free', tierName: 'RSVP', quantity: 2, unitPrice: 0, listUnitPrice: 0 },
      { tierId: 'ga', tierName: 'GA', quantity: 2, unitPrice: 1000, listUnitPrice: 1000 },
    ],
    ...extra,
  })
}

const order = (id: string) => mockFake.store.get(`pending_transactions/${id}`) as any
const tickets = () => mockFake.docsIn('tickets').map(([, d]) => d)
const ticketsFor = (paymentId: string) => tickets().filter((t: any) => t.payment_id === paymentId)

beforeEach(() => {
  mockFake.store.clear()
  mockFake.write(`events/${EVENT}`, { title: 'Show' })
  mockFake.write('users/u1', { email: 'u1@x.co', full_name: 'U One' })
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('free lines in a paid MonCash/SogePay order', () => {
  it('free claim available: takes the lock for this order, issues every line, records the free tickets', async () => {
    seedOrder('o1')
    const res = await fulfillPaidOrder({ orderId: 'o1', paymentMethod: 'moncash' })
    expect(res.outcome).toBe('fulfilled')
    expect(ticketsFor('o1')).toHaveLength(4)

    const lock = mockFake.store.get(lockPath()) as any
    expect(lock).toMatchObject({ payment_id: 'o1', source: 'moncash_order', kind: 'account' })
    const freeIds = ticketsFor('o1').filter((t: any) => t.price_paid === 0)
    expect(freeIds).toHaveLength(2)
    expect(lock.ticket_ids).toHaveLength(2)
    expect(order('o1').free_claim_decision).toBe('kept')
    expect(order('o1').free_lines_dropped).toBeUndefined()
  })

  it('claim held by another order: free lines dropped, paid lines issued, money unchanged', async () => {
    mockFake.write(lockPath(), { payment_id: 'pi_other', ticket_ids: ['old1'] })
    mockFake.write('tickets/old1', { event_id: EVENT, price_paid: 0, status: 'valid' })
    seedOrder('o2')

    const res = await fulfillPaidOrder({ orderId: 'o2', paymentMethod: 'sogepay' })
    expect(res.outcome).toBe('fulfilled')
    const issued = ticketsFor('o2')
    expect(issued).toHaveLength(2)
    expect(issued.every((t: any) => t.tier_id === 'ga')).toBe(true)

    // The lock still belongs to the other order.
    expect((mockFake.store.get(lockPath()) as any).payment_id).toBe('pi_other')
    expect(order('o2')).toMatchObject({ free_claim_decision: 'dropped', free_lines_dropped_reason: 'already_claimed' })
    expect(order('o2').free_lines_dropped).toEqual([expect.objectContaining({ tierId: 'free', quantity: 2 })])

    // The issued tickets still add up to what the buyer paid (face + passed-on fee).
    const charged = issued.reduce((sum: number, t: any) => sum + t.charged_amount, 0)
    expect(charged).toBeCloseTo(2200, 2)
    expect(issued.every((t: any) => t.buyer_fee_charged_amount === 100)).toBe(true)
    // Earnings: same gross and charged amount, counted on the tickets issued.
    expect(addTicketToEarnings).toHaveBeenCalledWith(
      EVENT,
      200000,
      2,
      expect.objectContaining({ chargedAmountCents: 220000, feeIncidence: 'buyer' })
    )
    // Inventory is reserved only for what is issued.
    expect(convertSeatHold).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 2, tierIncrements: [{ tierId: 'ga', quantity: 2 }] })
    )
  })

  it('a retry repeats the stored decision even if the lock has since been freed', async () => {
    mockFake.write(lockPath(), { payment_id: 'pi_other', ticket_ids: [] })
    seedOrder('o3')
    const { convertSeatHold: reserve } = jest.requireMock('@/lib/tickets/inventory')
    // The first attempt crashes after the decision was stored; the order is then
    // re-claimed (stale processing claim, simulated by resetting it to pending).
    reserve.mockImplementationOnce(async () => {
      throw new Error('crash')
    })
    await expect(fulfillPaidOrder({ orderId: 'o3', paymentMethod: 'moncash' })).rejects.toThrow('crash')
    expect(order('o3').free_claim_decision).toBe('dropped')

    // The other order's claim goes away; the retry must still drop the free lines.
    mockFake.store.delete(lockPath())
    mockFake.write('pending_transactions/o3', { status: 'pending', fulfillment_started_at: null }, { merge: true })
    const res = await fulfillPaidOrder({ orderId: 'o3', paymentMethod: 'moncash' })
    expect(res.outcome).toBe('fulfilled')
    expect(ticketsFor('o3')).toHaveLength(2)
    expect(mockFake.store.get(lockPath())).toBeUndefined()
  })

  it('a retry of an order that holds the claim keeps it (idempotent by order id)', async () => {
    seedOrder('o4')
    mockFake.write(lockPath(), { payment_id: 'o4' })
    const res = await fulfillPaidOrder({ orderId: 'o4', paymentMethod: 'moncash' })
    expect(res.outcome).toBe('fulfilled')
    expect(ticketsFor('o4')).toHaveLength(4)
    expect((mockFake.store.get(lockPath()) as any).payment_id).toBe('o4')
  })

  it('a guest is keyed on their email, exactly like the free-claim route', async () => {
    const guest = { isGuest: true, id: 'guest_x', email: 'g@x.co' }
    mockFake.write(lockPath(guest), { payment_id: 'pi_other' })
    seedOrder('o5', { user_id: 'guest_abc', is_guest: true, guest_email: 'g@x.co' })
    await fulfillPaidOrder({ orderId: 'o5', paymentMethod: 'moncash' })
    expect(ticketsFor('o5')).toHaveLength(2)
  })

  it('a sold-out refusal hands back the claim the order just took', async () => {
    seedOrder('o6')
    const { convertSeatHold: reserve } = jest.requireMock('@/lib/tickets/inventory')
    reserve.mockImplementationOnce(async () => ({ ok: false, reason: 'event_sold_out' }))
    const res = await fulfillPaidOrder({ orderId: 'o6', paymentMethod: 'moncash' })
    expect(res.outcome).toBe('capacity_exceeded')
    expect(mockFake.store.get(lockPath())).toBeUndefined()
  })

  it('an order with no free line never touches the claim lock', async () => {
    seedOrder('o7', {
      quantity: 2,
      tier_selections: [{ tierId: 'ga', tierName: 'GA', quantity: 2, unitPrice: 1000, listUnitPrice: 1000 }],
    })
    await fulfillPaidOrder({ orderId: 'o7', paymentMethod: 'moncash' })
    expect(mockFake.docsIn('free_claim_locks')).toHaveLength(0)
    expect(order('o7').free_claim_decision).toBeUndefined()
  })
})

describe('isFreeOrderLine', () => {
  it('decides on the list price; a promo-zeroed paid line is not free', () => {
    expect(isFreeOrderLine({ quantity: 1, unitPrice: 0, listUnitPrice: 0 }, {})).toBe(true)
    expect(isFreeOrderLine({ quantity: 1, unitPrice: 0, listUnitPrice: 500 }, { promo_code_id: 'p' })).toBe(false)
    // Legacy order (no list price): free only when it cost nothing without a promo.
    expect(isFreeOrderLine({ quantity: 1, unitPrice: 0 }, {})).toBe(true)
    expect(isFreeOrderLine({ quantity: 1, unitPrice: 0 }, { promo_code_id: 'p' })).toBe(false)
  })
})
