/**
 * @jest-environment node
 *
 * MonCash (and every rail on lib/tickets/fulfillment.ts fulfillPaidOrder) with
 * add-ons: booked on the first ticket, stock converted with the seats, counted in
 * earnings, the payout engine and refunds. Harness from mobile-money-free-claim-fulfillment.test.ts.
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

import { fulfillPaidOrder, storedAddOnLines } from '@/lib/tickets/fulfillment'
import { freeClaimLockId } from '@/lib/tickets/free-claim-policy'
import { addTicketToEarnings } from '@/lib/earnings'
import { convertSeatHold } from '@/lib/tickets/inventory'
import { sendTicketConfirmation } from '@/lib/tickets/confirmation'
import { ticketPriceMinor } from '@/lib/payouts/availability'
import { planTicketRefund, refundFaceAmount } from '@/lib/tickets/refundPlan'

const EVENT = 'evt1'
const lockPath = (id = { isGuest: false, id: 'u1' }) => `free_claim_locks/${freeClaimLockId(EVENT, id)}`

/**
 * 2 VIP at 3,000 HTG + a bottle package (5,000) + 2 T-shirts size M (1,500),
 * buyer passes on the 10% fee: face 14,000, fee 1,400 (800 of it the add-ons').
 */
function seedOrder(orderId: string, extra: Record<string, any> = {}) {
  mockFake.write(`pending_transactions/${orderId}`, {
    order_id: orderId,
    user_id: 'u1',
    event_id: EVENT,
    status: 'pending',
    quantity: 2,
    amount: 15400,
    face_amount: 14000,
    original_amount: 6000,
    currency: 'HTG',
    original_currency: 'HTG',
    fee_incidence: 'buyer',
    buyer_fee: 1400,
    buyer_fee_original: 1400,
    tier_selections: [{ tierId: 'vip', tierName: 'VIP', quantity: 2, unitPrice: 3000, listUnitPrice: 3000 }],
    add_on_lines: [
      { addOnId: 'ao_bottle', name: 'Bottle package', option: null, quantity: 1, unitPrice: 5000, chargeUnitPrice: 5000 },
      { addOnId: 'ao_shirt', name: 'T-shirt', option: 'M', quantity: 2, unitPrice: 1500, chargeUnitPrice: 1500 },
    ],
    add_ons_face_amount: 8000,
    add_ons_charge_amount: 8000,
    add_ons_buyer_fee: 800,
    add_ons_buyer_fee_original: 800,
    ...extra,
  })
}

const order = (id: string) => mockFake.store.get(`pending_transactions/${id}`) as any
const ticketsFor = (paymentId: string) =>
  mockFake
    .docsIn('tickets')
    .filter(([, d]) => (d as any).payment_id === paymentId)
    .map(([p, d]) => ({ id: p.split('/').pop(), ...(d as any) }))

beforeEach(() => {
  mockFake.store.clear()
  mockFake.write(`events/${EVENT}`, { title: 'Konpa night', currency: 'HTG', country: 'HT' })
  mockFake.write('users/u1', { email: 'u1@x.co', full_name: 'U One' })
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('MonCash fulfilment with add-ons', () => {
  it('books the add-ons on the first ticket; every gourde of the charge lands on a ticket', async () => {
    seedOrder('o1')
    const res = await fulfillPaidOrder({ orderId: 'o1', paymentMethod: 'moncash' })
    expect(res.outcome).toBe('fulfilled')
    const issued = ticketsFor('o1')
    expect(issued).toHaveLength(2)
    const lead = issued.find((t: any) => Array.isArray(t.add_ons))!
    const other = issued.find((t: any) => t !== lead)!
    expect(lead.add_ons).toEqual([
      expect.objectContaining({ id: 'ao_bottle', name: 'Bottle package', option: null, quantity: 1, unit_price: 5000, face_total: 5000 }),
      expect.objectContaining({ id: 'ao_shirt', name: 'T-shirt', option: 'M', quantity: 2, unit_price: 1500, face_total: 3000 }),
    ])
    expect(lead.add_ons_face_total).toBe(8000)
    expect(lead.add_ons_charged_amount).toBe(8800)
    expect(other.add_ons_ticket_id).toBe(lead.id)
    // Tickets keep their own face value; only the lead ticket's charge grows.
    expect(issued.map((t: any) => t.price_paid)).toEqual([3000, 3000])
    const charged = issued.reduce((sum: number, t: any) => sum + t.charged_amount, 0)
    const fees = issued.reduce((sum: number, t: any) => sum + t.buyer_fee_charged_amount, 0)
    expect(charged).toBeCloseTo(15400, 2)
    expect(fees).toBeCloseTo(1400, 2)
    // Both tickets carry the money on the MonCash rail (Money map collects charged_amount).
    expect(issued.every((t: any) => t.funds_rail === 'moncash')).toBe(true)
    // Buyer incidence is proven on the lead ticket for its add-on fee too.
    expect(lead.fee_incidence).toBe('buyer')
    expect(lead.buyer_fee_charged).toBe(30000 + 80000)
  })

  it('converts the add-on stock with the seats and counts the add-ons in earnings', async () => {
    seedOrder('o2')
    await fulfillPaidOrder({ orderId: 'o2', paymentMethod: 'moncash' })
    expect(convertSeatHold).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: 2,
        addOnIncrements: [
          { addOnId: 'ao_bottle', quantity: 1 },
          { addOnId: 'ao_shirt', quantity: 2 },
        ],
      })
    )
    // Tickets 6,000 + add-ons 8,000 HTG.
    expect(addTicketToEarnings).toHaveBeenCalledWith(
      EVENT,
      1_400_000,
      2,
      expect.objectContaining({ chargedAmountCents: 1_540_000, feeIncidence: 'buyer' })
    )
    expect(sendTicketConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ addOns: ['Bottle package × 1', 'T-shirt (M) × 2'] })
    )
  })

  it('the payout engine and the refund face count the add-ons on the lead ticket', async () => {
    seedOrder('o3')
    await fulfillPaidOrder({ orderId: 'o3', paymentMethod: 'moncash' })
    const issued = ticketsFor('o3')
    const lead = issued.find((t: any) => Array.isArray(t.add_ons))!
    const other = issued.find((t: any) => t !== lead)!
    expect(ticketPriceMinor(lead)).toBe(1_100_000)
    expect(ticketPriceMinor(other)).toBe(300_000)
    expect(refundFaceAmount(lead)).toBe(11000)
    // A manual (MonCash) refund of the lead ticket returns its face AND its add-ons;
    // the service fee stays unless the event is cancelled.
    const plan = planTicketRefund(lead)
    expect(plan).toMatchObject({ eligible: true, rail: 'manual', currency: 'HTG', amount: 11000 })
  })

  it('a free ticket + add-ons order whose free claim went elsewhere is flagged for refund, never issued', async () => {
    mockFake.write(lockPath(), { payment_id: 'pi_other', ticket_ids: ['old1'] })
    mockFake.write('tickets/old1', { event_id: EVENT, price_paid: 0, status: 'valid' })
    seedOrder('o4', {
      quantity: 1,
      original_amount: 0,
      tier_selections: [{ tierId: 'free', tierName: 'RSVP', quantity: 1, unitPrice: 0, listUnitPrice: 0 }],
    })
    const res = await fulfillPaidOrder({ orderId: 'o4', paymentMethod: 'moncash' })
    expect(res.outcome).toBe('invalid_order')
    expect(order('o4')).toMatchObject({ status: 'failed', needs_refund: true, failure_reason: 'already_claimed' })
    expect(ticketsFor('o4')).toHaveLength(0)
  })

  it('an order without add-ons is untouched', async () => {
    seedOrder('o5', {
      amount: 6600,
      face_amount: 6000,
      buyer_fee: 600,
      buyer_fee_original: 600,
      add_on_lines: undefined,
      add_ons_face_amount: undefined,
      add_ons_charge_amount: undefined,
      add_ons_buyer_fee: undefined,
      add_ons_buyer_fee_original: undefined,
    })
    await fulfillPaidOrder({ orderId: 'o5', paymentMethod: 'moncash' })
    const issued = ticketsFor('o5')
    expect(issued.every((t: any) => t.add_ons === undefined && t.add_ons_ticket_id === undefined)).toBe(true)
    expect(issued.reduce((s: number, t: any) => s + t.charged_amount, 0)).toBeCloseTo(6600, 2)
    expect(addTicketToEarnings).toHaveBeenCalledWith(EVENT, 600_000, 2, expect.anything())
  })
})

describe('storedAddOnLines', () => {
  it('drops junk lines', () => {
    expect(
      storedAddOnLines({
        add_on_lines: [
          { addOnId: 'a', quantity: 1, unitPrice: 10 },
          { addOnId: '', quantity: 1, unitPrice: 10 },
          { addOnId: 'b', quantity: 0.5, unitPrice: 10 },
          { addOnId: 'c', quantity: 1, unitPrice: 0 },
        ],
      })
    ).toEqual([{ addOnId: 'a', name: 'Add-on', option: null, quantity: 1, unitPrice: 10, chargeUnitPrice: 10 }])
    expect(storedAddOnLines({})).toEqual([])
  })
})
