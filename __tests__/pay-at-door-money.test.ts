/**
 * Pay at the door: the cash is the organizer's own, taken in person. Tikem
 * takes NO fee on it, never holds it and owes none of it, so it must never
 * reach the payout balance, the earnings gross or the fee basis. Organizer
 * totals report it apart, as "collected at the door".
 */
import { computeEventAvailability, ticketFactsFromDocs, ticketPriceMinor } from '@/lib/payouts/availability'
import { summarizeEventTickets } from '@/lib/organizer/salesSummary'
import { DEFAULT_PAYOUT_RELEASE_CONFIG } from '@/types/platform-settings'
import { priceCart } from '@/lib/checkout/buyer-pricing'
import { DOOR_TIER_REFUSAL, doorTierInPaidOrderRefusal } from '@/lib/tickets/purchasable'
import { doorCollectedTotal } from '@/lib/tickets/pay-at-door'

const NOW = new Date('2026-11-20T12:00:00.000Z')
const ended = new Date(NOW.getTime() - 400 * 3_600_000).toISOString()

const door = (over: Record<string, any> = {}) => ({
  id: over.id ?? `d${Math.random()}`,
  event_id: 'evt1',
  status: 'valid',
  payment_method: 'pay_at_door',
  price_paid: 0,
  currency: 'HTG',
  door_price: 500,
  door_currency: 'HTG',
  door_paid: false,
  checked_in: true,
  check_in_method: 'manual',
  purchased_at: '2026-11-01T10:00:00.000Z',
  ...over,
})
const moncash = (price: number, over: Record<string, any> = {}) => ({
  id: over.id ?? `m${Math.random()}`,
  event_id: 'evt1',
  status: 'valid',
  payment_method: 'moncash',
  payment_id: over.payment_id ?? `pay${Math.random()}`,
  price_paid: price,
  currency: 'HTG',
  checked_in: true,
  check_in_method: 'scan',
  purchased_at: '2026-11-01T10:00:00.000Z',
  ...over,
})

function availability(tickets: any[]) {
  return computeEventAvailability({
    event: { id: 'evt1', organizer_id: 'org1', currency: 'HTG', country: 'HT', status: 'published', end_datetime: ended },
    tickets,
    fee: { platformFeePercentage: 0.1, legacyCapMinorPerTicket: 75_000 },
    release: {
      history: { completedEvents: 5, lifetimeGrossMinor: 0, currency: 'HTG' },
      config: DEFAULT_PAYOUT_RELEASE_CONFIG,
      reviewStatus: null,
    },
    now: NOW,
  } as any)
}

describe('payout availability ignores door cash', () => {
  it('a door ticket is never gross, even paid and even with a stray price_paid', () => {
    expect(ticketPriceMinor(door({ door_paid: true, door_amount: 500 }))).toBe(0)
    // Defence in depth: only the door-payment route writes door_*, and it never
    // touches price_paid, but a door ticket must read as 0 whatever it carries.
    expect(ticketPriceMinor(door({ price_paid: 500 }))).toBe(0)
  })

  it('door cash adds nothing to what Tikem owes the organizer', () => {
    const paidSales = [moncash(1000, { id: 'm1' }), moncash(1000, { id: 'm2' })]
    const withoutDoor = availability(paidSales)
    const withDoor = availability([
      ...paidSales,
      door({ id: 'd1', door_paid: true, door_amount: 500, door_paid_at: NOW.toISOString(), door_paid_by: 'staff' }),
      door({ id: 'd2', door_paid: true, door_amount: 500, price_paid: 500 }),
      door({ id: 'd3' }),
    ])
    expect(withDoor.grossMinor).toBe(withoutDoor.grossMinor)
    expect(withDoor.availableNowMinor).toBe(withoutDoor.availableNowMinor)
    expect(withDoor.pendingMinor).toBe(withoutDoor.pendingMinor)
  })

  it('an all-door event owes nothing', () => {
    const a = availability([door({ door_paid: true, door_amount: 500 }), door({ door_paid: true, door_amount: 500 })])
    expect(a.grossMinor).toBe(0)
    expect(a.availableNowMinor).toBe(0)
  })

  it('door tickets checked in by hand never count as manual check-ins or live paid tickets', () => {
    const facts = ticketFactsFromDocs([
      door(),
      door(),
      door(),
      { status: 'valid', payment_method: 'stripe_connect', price_paid: 20, checked_in: true, check_in_method: 'scan' },
    ])
    expect(facts).toMatchObject({ liveTickets: 1, checkedInTickets: 1, manualCheckIns: 0, methodKnownCheckIns: 1 })
  })
})

describe('organizer totals: door cash is counted apart', () => {
  it('keeps revenue unchanged and reports door cash collected and still owed', () => {
    const s = summarizeEventTickets(
      [
        door({ door_paid: true }),
        door({ door_paid: true, door_amount: 450 }),
        door({ door_paid: false }),
        door({ door_paid: true, status: 'cancelled' }),
        moncash(1000),
      ],
      'HTG'
    )
    expect(s.revenueByCurrencyCents).toEqual({ HTG: 100000 })
    expect(s.doorCollectedByCurrencyCents).toEqual({ HTG: 95000 })
    expect(s.doorOutstandingByCurrencyCents).toEqual({ HTG: 50000 })
    expect(s.ticketsSold).toBe(4)
  })

  it('the door total is cent-exact over live, paid door tickets', () => {
    expect(
      doorCollectedTotal([
        door({ door_paid: true, door_amount: 0.1 }),
        door({ door_paid: true, door_amount: 0.2 }),
        door({ door_paid: false }),
        door({ door_paid: true, status: 'refunded' }),
      ])
    ).toBe(0.3)
  })
})

describe('no fee on door cash', () => {
  it('a door tier is a 0 line: no service fee, no per-ticket fixed fee', () => {
    // US market: 6% + $0.99 per PAID ticket. A door line costs 0 online.
    const cart = priceCart([{ price: 0, quantity: 4 }], { country: 'US', currency: 'USD' } as any)
    expect(cart.buyerFee).toBe(0)
    expect(cart.total).toBe(0)
    expect(cart.paidQuantity).toBe(0)
  })
})

describe('door tiers never ride in a paid order', () => {
  it('refuses a door tier, lets free and paid tiers through', () => {
    expect(doorTierInPaidOrderRefusal({ price: 0, door_price: 500 })).toBe(DOOR_TIER_REFUSAL)
    expect(DOOR_TIER_REFUSAL).toMatchObject({ ok: false, status: 400, code: 'door_tier_not_in_paid_order' })
    expect(doorTierInPaidOrderRefusal({ price: 0 })).toBeNull()
    expect(doorTierInPaidOrderRefusal({ price: 1000 })).toBeNull()
    // A priced tier with a leftover door_price is a normal paid tier.
    expect(doorTierInPaidOrderRefusal({ price: 1000, door_price: 500 })).toBeNull()
  })
})
