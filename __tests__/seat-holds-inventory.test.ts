/**
 * Seat holds + sharded inventory (lib/tickets/inventoryShards.ts, lib/tickets/seatHolds.ts)
 * against a Firestore fake with REAL optimistic-concurrency transactions, so races are real.
 *
 * @jest-environment node
 */
import { createConcurrentFirestore } from './helpers/concurrentFirestore'

const mockFs = createConcurrentFirestore({ maxAttempts: 5 })
jest.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return mockFs.db
  },
}))

process.env.INVENTORY_RETRY_BASE_MS = '1'

/* eslint-disable @typescript-eslint/no-var-requires */
const shards = require('@/lib/tickets/inventoryShards')
const holds = require('@/lib/tickets/seatHolds')
const inventory = require('@/lib/tickets/inventory')

const EVT = 'evt1'

function seedEvent(data: Record<string, any> = {}) {
  mockFs.seed(`events/${EVT}`, { title: 'Show', max_tickets: 100, tickets_sold: 0, ...data })
}
function seedTier(id: string, data: Record<string, any> = {}) {
  mockFs.seed(`ticket_tiers/${id}`, { event_id: EVT, total_quantity: 50, sold_quantity: 0, ...data })
}
const used = async (key = shards.EVENT_BUCKET) => (await shards.availabilityOf(EVT, key)).used

beforeEach(() => {
  mockFs.reset()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('seat hold lifecycle', () => {
  it('a hold counts against availability for everyone else', async () => {
    seedEvent({ max_tickets: 5 })
    const a = await holds.createSeatHold({ eventId: EVT, quantity: 4, tierIncrements: [], source: 'card' })
    expect(a.ok).toBe(true)
    expect(a.expiresAt).toBeGreaterThan(Date.now())
    const b = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card' })
    expect(b).toEqual(expect.objectContaining({ ok: false, reason: 'event_capacity', remaining: 1 }))
    expect(holds.seatHoldRefusal(b)).toEqual({
      status: 409,
      body: expect.objectContaining({ code: 'only_n_left', remaining: 1 }),
    })
    const c = await holds.createSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [], source: 'card' })
    expect(c.ok).toBe(true)
    const d = await holds.createSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [], source: 'card' })
    expect(holds.seatHoldRefusal(d, 'fr')).toEqual({
      status: 409,
      body: expect.objectContaining({ code: 'sold_out', error: holds.SEAT_HOLD_MESSAGES.sold_out.fr }),
    })
  })

  it('converts a hold into a sale, idempotently, and rolls the counters up', async () => {
    seedEvent()
    seedTier('vip')
    const hold = await holds.createSeatHold({
      eventId: EVT,
      quantity: 3,
      tierIncrements: [{ tierId: 'vip', quantity: 3 }],
      source: 'card',
    })
    expect(hold.ok).toBe(true)
    const params = { eventId: EVT, quantity: 3, tierIncrements: [{ tierId: 'vip', quantity: 3 }], reservationId: hold.holdId }
    const first = await inventory.convertSeatHold(params)
    expect(first).toEqual(expect.objectContaining({ ok: true }))
    const again = await inventory.convertSeatHold(params)
    expect(again).toEqual(expect.objectContaining({ ok: true, alreadyDone: true }))
    expect(await shards.availabilityOf(EVT, shards.EVENT_BUCKET)).toEqual(expect.objectContaining({ used: 3, sold: 3, held: 0 }))
    expect(mockFs.get(`inventory_reservations/${hold.holdId}`)?.state).toBe('sold')
    await shards.rollupInventoryCounters(EVT)
    expect(mockFs.get(`events/${EVT}`)?.tickets_sold).toBe(3)
    expect(mockFs.get('ticket_tiers/vip')?.sold_quantity).toBe(3)
  })

  it('releasing a hold frees its seats; releasing never touches a sale', async () => {
    seedEvent({ max_tickets: 2 })
    const hold = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'moncash' })
    expect(await used()).toBe(2)
    expect(await holds.releaseSeatHold(hold.holdId)).toBe(true)
    expect(await holds.releaseSeatHold(hold.holdId)).toBe(false)
    expect(await used()).toBe(0)

    const sold = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'moncash' })
    await inventory.convertSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], reservationId: sold.holdId })
    expect(await holds.releaseSeatHold(sold.holdId)).toBe(false)
    expect(await used()).toBe(2)
  })

  it('an expired hold no longer counts, and the sweep marks it expired', async () => {
    seedEvent({ max_tickets: 2 })
    const stale = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card', holdMs: 1 })
    await new Promise((r) => setTimeout(r, 5))
    const fresh = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card' })
    expect(fresh.ok).toBe(true)
    const swept = await shards.sweepInventory()
    expect(swept.expired).toBe(1)
    expect(mockFs.get(`inventory_reservations/${stale.holdId}`)?.state).toBe('expired')
  })

  it('a second checkout by the same buyer never drops the first hold (its payment may be in flight)', async () => {
    seedEvent({ max_tickets: 3 })
    const first = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'moncash', ownerKey: 'user:u1' })
    const second = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card', ownerKey: 'user:u1' })
    // Refused for capacity: the first hold survives and its payment still converts.
    expect(second).toEqual(expect.objectContaining({ ok: false, reason: 'event_capacity' }))
    expect(mockFs.get(`inventory_reservations/${first.holdId}`)?.state).toBe('held')
    const paid = await inventory.convertSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], reservationId: first.holdId })
    expect(paid.ok).toBe(true)
  })

  it('a guest email cannot be used to drop someone else’s hold', async () => {
    seedEvent({ max_tickets: 4 })
    const victim = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card', ownerKey: 'guest:v@x.com' })
    const attacker = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card', ownerKey: 'guest:v@x.com' })
    expect(attacker.ok).toBe(true)
    expect(mockFs.get(`inventory_reservations/${victim.holdId}`)?.state).toBe('held')
  })

  it('expired hold + successful payment: converts anyway when capacity allows', async () => {
    seedEvent({ max_tickets: 3 })
    const hold = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card', holdMs: 1 })
    await new Promise((r) => setTimeout(r, 5))
    const r = await inventory.convertSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], reservationId: hold.holdId })
    expect(r.ok).toBe(true)
    expect(await shards.availabilityOf(EVT, shards.EVENT_BUCKET)).toEqual(expect.objectContaining({ used: 2, sold: 2, held: 0 }))
  })

  it('expired hold + successful payment on a now sold-out event: refuses (caller refunds)', async () => {
    seedEvent({ max_tickets: 2 })
    const hold = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card', holdMs: 1 })
    await new Promise((r) => setTimeout(r, 5))
    const other = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card' })
    expect(other.ok).toBe(true)
    const r = await inventory.convertSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], reservationId: hold.holdId })
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'event_capacity', remaining: 0 }))
  })

  it('legacy order with no hold: reserves atomically from the existing counters', async () => {
    seedEvent({ max_tickets: 10, tickets_sold: 8 })
    seedTier('ga', { total_quantity: 10, sold_quantity: 8 })
    const ok = await inventory.convertSeatHold({
      eventId: EVT,
      quantity: 2,
      tierIncrements: [{ tierId: 'ga', quantity: 2 }],
      reservationId: 'order_123',
    })
    expect(ok.ok).toBe(true)
    // Idempotent on the order key.
    const again = await inventory.convertSeatHold({
      eventId: EVT,
      quantity: 2,
      tierIncrements: [{ tierId: 'ga', quantity: 2 }],
      reservationId: 'order_123',
    })
    expect(again.alreadyDone).toBe(true)
    const full = await inventory.convertSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [], reservationId: 'order_456' })
    expect(full).toEqual(expect.objectContaining({ ok: false, reason: 'event_capacity', remaining: 0 }))
    await shards.rollupInventoryCounters(EVT)
    expect(mockFs.get(`events/${EVT}`)?.tickets_sold).toBe(10)
    expect(mockFs.get('ticket_tiers/ga')?.sold_quantity).toBe(10)
  })

  it('a tier cap binds independently of the event cap; a foreign tier is refused', async () => {
    seedEvent({ max_tickets: 100 })
    seedTier('vip', { total_quantity: 2 })
    mockFs.seed('ticket_tiers/other', { event_id: 'evt2', total_quantity: 10 })
    const r = await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 3, tierIncrements: [{ tierId: 'vip', quantity: 3 }] })
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'tier_capacity', tierId: 'vip', remaining: 2 }))
    const m = await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 1, tierIncrements: [{ tierId: 'other', quantity: 1 }] })
    expect(m).toEqual(expect.objectContaining({ ok: false, reason: 'tier_mismatch' }))
    const f = await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 1.5, tierIncrements: [] })
    expect(f).toEqual(expect.objectContaining({ ok: false, reason: 'invalid_quantity' }))
  })

  it('partial release returns only the unissued seats', async () => {
    seedEvent({ max_tickets: 10 })
    const r = await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 4, tierIncrements: [] })
    await inventory.releaseInventoryReservation({ reservationId: r.reservationId, quantity: 1 })
    expect(await used()).toBe(3)
    await inventory.releaseInventoryReservation({ reservationId: r.reservationId })
    expect(await used()).toBe(0)
  })

  it('a capacity edit takes effect: raised cap sells more, lowered cap sells nothing past it', async () => {
    seedEvent({ max_tickets: 5 })
    expect((await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 5, tierIncrements: [] })).ok).toBe(true)
    expect((await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 1, tierIncrements: [] })).ok).toBe(false)
    seedEvent({ max_tickets: 8, tickets_sold: 5 })
    expect((await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 3, tierIncrements: [] })).ok).toBe(true)
    seedEvent({ max_tickets: 6, tickets_sold: 8 })
    expect((await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 1, tierIncrements: [] })).ok).toBe(false)
  })
})

describe('never fails open', () => {
  it('sustained contention returns busy (503) and reserves nothing', async () => {
    seedEvent({ max_tickets: 10 })
    mockFs.failCommits(10_000)
    const r = await holds.createSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [], source: 'card' })
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'busy' }))
    expect(holds.seatHoldRefusal(r)?.status).toBe(503)
    expect(holds.seatHoldRefusal(r)?.body.code).toBe('busy_try_again')
    mockFs.failCommits(0)
    expect(await used()).toBe(0)
  })
})

describe('shard allocation never oversells under concurrency', () => {
  /** Run every request; retry the ones refused as busy (a client retrying) until each resolves. */
  async function drive(requests: Array<() => Promise<any>>) {
    let pending = requests.map((fn) => ({ fn }))
    const results: any[] = []
    for (let round = 0; round < 50 && pending.length > 0; round++) {
      const out = await Promise.all(pending.map((p) => p.fn()))
      const next: typeof pending = []
      out.forEach((r, i) => (r.reason === 'busy' ? next.push(pending[i]) : results.push(r)))
      pending = next
    }
    expect(pending).toHaveLength(0)
    return results
  }

  it('500 concurrent holds against capacity 100: exactly 100 succeed', async () => {
    seedEvent({ max_tickets: 100 })
    const results = await drive(
      Array.from({ length: 500 }, () => () =>
        holds.createSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [], source: 'card' })
      )
    )
    expect(results.filter((r) => r.ok)).toHaveLength(100)
    expect(results.filter((r) => !r.ok).every((r) => r.reason === 'event_capacity')).toBe(true)
    expect(await used()).toBe(100)
  }, 60_000)

  it('mixed tiers and quantities never exceed either the tier or the event cap', async () => {
    seedEvent({ max_tickets: 60 })
    seedTier('vip', { total_quantity: 20 })
    seedTier('ga', { total_quantity: 50 })
    const results = await drive(
      Array.from({ length: 300 }, (_, i) => () => {
        const tierId = i % 3 === 0 ? 'vip' : 'ga'
        const q = (i % 2) + 1
        return inventory.reserveInventoryAtomic({ eventId: EVT, quantity: q, tierIncrements: [{ tierId, quantity: q }] })
      })
    )
    expect(results.length).toBe(300)
    const { sold: event } = await shards.availabilityOf(EVT, shards.EVENT_BUCKET)
    const { sold: vip } = await shards.availabilityOf(EVT, shards.tierBucket('vip'))
    const { sold: ga } = await shards.availabilityOf(EVT, shards.tierBucket('ga'))
    expect(event).toBeLessThanOrEqual(60)
    expect(vip).toBeLessThanOrEqual(20)
    expect(ga).toBeLessThanOrEqual(50)
    expect(event).toBe(vip + ga)
    // Sold out for real: the event cap is (nearly) full; a 1-seat request can only fail on capacity.
    expect(event).toBeGreaterThanOrEqual(59)
  }, 60_000)

  it('concurrent conversion retries of the same order count it once', async () => {
    seedEvent({ max_tickets: 10 })
    const hold = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card' })
    const runs = await drive(
      Array.from({ length: 20 }, () => () =>
        inventory.convertSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], reservationId: hold.holdId })
      )
    )
    expect(runs.every((r) => r.ok)).toBe(true)
    expect(await shards.availabilityOf(EVT, shards.EVENT_BUCKET)).toEqual(expect.objectContaining({ used: 2, sold: 2, held: 0 }))
  }, 30_000)
})

describe('hold abuse limits and release authorization', () => {
  it('caps guest holds per network per event; a released hold frees its slot; accounts are not IP-capped', async () => {
    seedEvent({ max_tickets: 1000 })
    const env = process.env.SEAT_HOLD_MAX_PER_IP
    process.env.SEAT_HOLD_MAX_PER_IP = '3'
    try {
      const guest = (email: string) =>
        holds.createSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [], source: 'card', ownerKey: `guest:${email}`, ipAddress: '1.2.3.4, 10.0.0.1' })
      const made = []
      for (const e of ['a@x', 'b@x', 'c@x']) {
        const h = await guest(e)
        expect(h.ok).toBe(true)
        made.push(h)
      }
      const fourth = await guest('d@x')
      expect(fourth).toEqual(expect.objectContaining({ ok: false, reason: 'too_many_holds' }))
      expect(holds.seatHoldRefusal(fourth)).toEqual({ status: 429, body: expect.objectContaining({ code: 'too_many_holds' }) })
      // A signed-in buyer on the same NAT is capped by their account, not the IP.
      const account = await holds.createSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [], source: 'card', ownerKey: 'user:z', ipAddress: '1.2.3.4' })
      expect(account.ok).toBe(true)
      // Releasing a hold frees its slot at once (not at expiry).
      expect(await holds.releaseSeatHold(made[0].holdId)).toBe(true)
      expect((await guest('d@x')).ok).toBe(true)
      // Converting does too.
      await inventory.convertSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [], reservationId: made[1].holdId })
      expect((await guest('e@x')).ok).toBe(true)
    } finally {
      process.env.SEAT_HOLD_MAX_PER_IP = env
    }
  })

  it('caps one buyer at 3 live holds and one order of held seats', async () => {
    seedEvent({ max_tickets: 1000 })
    const mk = (q: number) => holds.createSeatHold({ eventId: EVT, quantity: q, tierIncrements: [], source: 'card', ownerKey: 'user:u9' })
    expect((await mk(20)).ok).toBe(true)
    expect((await mk(20)).ok).toBe(true)
    expect(await mk(20)).toEqual(expect.objectContaining({ ok: false, reason: 'too_many_holds' }))
    expect((await mk(10)).ok).toBe(true)
    expect(await mk(1)).toEqual(expect.objectContaining({ ok: false, reason: 'too_many_holds' }))
  })

  it('never holds more than one order may buy', async () => {
    seedEvent({ max_tickets: 1000 })
    const r = await holds.createSeatHold({ eventId: EVT, quantity: 51, tierIncrements: [], source: 'card' })
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'invalid_quantity' }))
    expect(await used()).toBe(0)
  })

  const releaseCall = (body: any) => {
    const { POST } = require('@/app/api/checkout/release-hold/route')
    return POST(new Request('http://localhost/api/checkout/release-hold', { method: 'POST', body: JSON.stringify(body) }))
  }

  it('the release endpoint needs the release token, not just the hold id', async () => {
    seedEvent({ max_tickets: 5 })
    const hold = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card' })
    const client = holds.seatHoldForClient(hold)

    expect((await releaseCall({ holdId: client.id })).status).toBe(403)
    expect((await releaseCall({ holdId: client.id, releaseToken: 'x'.repeat(40) })).status).toBe(403)
    expect((await releaseCall({ holdId: holds.newSeatHoldId(), releaseToken: client.releaseToken })).status).toBe(403)
    expect(await used()).toBe(2)

    const ok = await releaseCall({ holdId: client.id, releaseToken: client.releaseToken })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ released: true })
    expect(await used()).toBe(0)
  })

  it('the release endpoint never releases a sold seat', async () => {
    seedEvent({ max_tickets: 5 })
    const hold = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card' })
    const client = holds.seatHoldForClient(hold)
    await inventory.convertSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], reservationId: hold.holdId })
    const res = await releaseCall({ holdId: client.id, releaseToken: client.releaseToken })
    expect(await res.json()).toEqual({ released: false })
    expect(await used()).toBe(2)
  })
})

describe('abuse caps under concurrency, keyed on what the caller controls', () => {
  it('50 parallel checkouts from one account: exactly the cap (3) succeed', async () => {
    seedEvent({ max_tickets: 1000 })
    let pending = Array.from({ length: 50 }, (_, i) => i)
    const ok: string[] = []
    let capped = 0
    for (let round = 0; round < 30 && pending.length; round++) {
      const out = await Promise.all(
        pending.map(() => holds.createSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [], source: 'card', ownerKey: 'user:bot' }))
      )
      const next: number[] = []
      out.forEach((o: any, i: number) => {
        if (o.ok) ok.push(o.holdId)
        else if (o.reason === 'busy') next.push(pending[i])
        else if (o.reason === 'too_many_holds') capped += 1
      })
      pending = next
    }
    expect(ok).toHaveLength(3)
    expect(capped).toBe(47)
    expect(await used()).toBe(3)
  }, 30_000)

  it('a guest email is never a cap key: typing a victim’s email blocks nobody', async () => {
    seedEvent({ max_tickets: 1000 })
    for (let i = 0; i < 6; i++) {
      const r = await holds.createSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [], source: 'card', ownerKey: 'guest:victim@x.com', ipAddress: `9.9.9.${i}` })
      expect(r.ok).toBe(true)
    }
    // The real owner, signed in or as a guest from their own network, still checks out.
    expect((await holds.createSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [], source: 'card', ownerKey: 'user:victim' })).ok).toBe(true)
    expect((await holds.createSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [], source: 'card', ownerKey: 'guest:victim@x.com', ipAddress: '7.7.7.7' })).ok).toBe(true)
  })
})

describe('per-network seat cap and shard-count tampering', () => {
  it('parallel big guest holds from one IP stop at the seat cap', async () => {
    seedEvent({ max_tickets: 5000 })
    const env = process.env.SEAT_HOLD_MAX_SEATS_PER_IP
    process.env.SEAT_HOLD_MAX_SEATS_PER_IP = '120'
    try {
      let pending = Array.from({ length: 10 }, (_, i) => i)
      let ok = 0
      for (let round = 0; round < 30 && pending.length; round++) {
        const out = await Promise.all(
          pending.map((i) =>
            holds.createSeatHold({ eventId: EVT, quantity: 50, tierIncrements: [], source: 'card', ownerKey: `guest:g${i}@x`, ipAddress: '3.3.3.3' })
          )
        )
        const next: number[] = []
        out.forEach((o: any, j: number) => {
          if (o.ok) ok += 1
          else if (o.reason === 'busy') next.push(pending[j])
          else expect(o.reason).toBe('too_many_holds')
        })
        pending = next
      }
      expect(ok).toBe(2) // 2 x 50 = 100 <= 120; a third would be 150
      expect(await used()).toBe(100)
      // Another network is unaffected.
      expect((await holds.createSeatHold({ eventId: EVT, quantity: 50, tierIncrements: [], source: 'card', ipAddress: '4.4.4.4' })).ok).toBe(true)
    } finally {
      process.env.SEAT_HOLD_MAX_SEATS_PER_IP = env
    }
  }, 30_000)

  it('a lowered stored shard count cannot hide shards from the capacity check', async () => {
    seedEvent({ max_tickets: 40 })
    expect((await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 30, tierIncrements: [] })).ok).toBe(true)
    // Tamper: claim only 1 shard exists, and edit the capacity to force the global path.
    mockFs.seed(`events/${EVT}`, { ...mockFs.get(`events/${EVT}`), inventory_shards_n: 1, max_tickets: 41 })
    const r = await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 12, tierIncrements: [] })
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'event_capacity', remaining: 11 }))
    expect((await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 11, tierIncrements: [] })).ok).toBe(true)
    // The next global pass restores the real count.
    expect(mockFs.get(`events/${EVT}`)?.inventory_shards_n).toBe(20)
    expect((await shards.availabilityOf(EVT, shards.EVENT_BUCKET)).used).toBe(41)
  })
})

describe('order status token', () => {
  it('verifies for its own order only, and expires', () => {
    const now = Date.now()
    const tok = holds.orderStatusToken('123', now + 1000)
    expect(holds.isValidOrderStatusToken('123', tok, now)).toBe(true)
    expect(holds.isValidOrderStatusToken('124', tok, now)).toBe(false)
    expect(holds.isValidOrderStatusToken('123', tok, now + 2000)).toBe(false)
    expect(holds.isValidOrderStatusToken('123', `${now + 1000}.${'0'.repeat(40)}`, now)).toBe(false)
    expect(holds.isValidOrderStatusToken('123', 'junk', now)).toBe(false)
  })
})

describe('invariant under interleaved steals, rebalances and capacity edits', () => {
  it('total never exceeds the capacity in force, and the shares always add up to it', async () => {
    seedEvent({ max_tickets: 60 })
    seedTier('a', { total_quantity: 40 })
    seedTier('b', { total_quantity: 40 })
    const results: any[] = []
    const ops: Array<() => Promise<any>> = []
    for (let i = 0; i < 240; i++) {
      const tierId = i % 2 ? 'a' : 'b'
      const q = (i % 3) + 1
      // Holds, sales, conversions and releases all at once.
      ops.push(async () => {
        if (i % 4 === 0) return inventory.reserveInventoryAtomic({ eventId: EVT, quantity: q, tierIncrements: [{ tierId, quantity: q }] })
        const h = await holds.createSeatHold({ eventId: EVT, quantity: q, tierIncrements: [{ tierId, quantity: q }], source: 'card' })
        if (h.ok && i % 5 === 0) await holds.releaseSeatHold(h.holdId)
        if (h.ok && i % 5 === 1) await inventory.convertSeatHold({ eventId: EVT, quantity: q, tierIncrements: [{ tierId, quantity: q }], reservationId: h.holdId })
        return h
      })
      // Capacity edits mid-rush force global resyncs (the cap snapshot no longer matches).
      if (i === 60) ops.push(async () => mockFs.seed(`events/${EVT}`, { ...mockFs.get(`events/${EVT}`), max_tickets: 80 }))
      if (i === 150) ops.push(async () => mockFs.seed('ticket_tiers/a', { ...mockFs.get('ticket_tiers/a'), total_quantity: 30 }))
    }
    // Interleave: everything in flight together.
    const out = await Promise.all(ops.map((op) => op().catch((e: any) => ({ ok: false, reason: 'threw', e }))))
    results.push(...out)
    expect(results.some((r: any) => r?.reason === 'threw')).toBe(false)

    const ev = await shards.availabilityOf(EVT, shards.EVENT_BUCKET)
    const a = await shards.availabilityOf(EVT, shards.tierBucket('a'))
    const b = await shards.availabilityOf(EVT, shards.tierBucket('b'))
    expect(ev.used).toBeLessThanOrEqual(80)
    expect(b.used).toBeLessThanOrEqual(40)
    // Tier a: whatever was placed under the old 40 stays honoured; nothing past it.
    expect(a.used).toBeLessThanOrEqual(40)
    expect(ev.used).toBe(a.used + b.used)

    // Settle: one more request per bucket resyncs every snapshot; then the shares
    // must add up to exactly the capacity in force (or the bucket is still stale
    // because it is over a lowered cap, where nothing sells).
    await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 1, tierIncrements: [{ tierId: 'b', quantity: 1 }] })
    const evAfter = await shards.availabilityOf(EVT, shards.EVENT_BUCKET)
    expect(evAfter.used).toBeLessThanOrEqual(80)
    if (evAfter.used < 80) expect(evAfter.alloc).toBe(80)
    const bAfter = await shards.availabilityOf(EVT, shards.tierBucket('b'))
    expect(bAfter.used).toBeLessThanOrEqual(40)
  }, 60_000)
})

describe('shard sizing and repair', () => {
  it('sizes shards from capacity (20..100) and fixes the count on the event', async () => {
    expect(shards.shardCountForCapacity(null)).toBe(20)
    expect(shards.shardCountForCapacity(500)).toBe(20)
    expect(shards.shardCountForCapacity(2000)).toBe(80)
    expect(shards.shardCountForCapacity(100_000)).toBe(100)
    seedEvent({ max_tickets: 2000 })
    expect(await shards.eventHasInventoryShards(EVT)).toBe(false)
    expect((await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 1, tierIncrements: [] })).ok).toBe(true)
    expect(mockFs.get(`events/${EVT}`)?.inventory_shards_n).toBe(80)
    expect((await shards.availabilityOf(EVT, shards.EVENT_BUCKET)).shards).toBe(80)
    expect((await shards.availabilityOf(EVT, shards.EVENT_BUCKET)).alloc).toBe(2000)
    expect(await shards.eventHasInventoryShards(EVT)).toBe(true)
  })

  it('reseed: dry run writes nothing; apply sets sold from live tickets and keeps holds', async () => {
    seedEvent({ max_tickets: 10 })
    seedTier('ga', { total_quantity: 10 })
    await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 2, tierIncrements: [{ tierId: 'ga', quantity: 2 }] })
    const hold = await holds.createSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [{ tierId: 'ga', quantity: 1 }], source: 'card' })
    const dry = await shards.reseedInventoryShards(EVT, { event: 5, tiers: { ga: 5 } })
    expect(dry.written).toBe(false)
    expect((await shards.availabilityOf(EVT, shards.EVENT_BUCKET)).sold).toBe(2)
    await shards.reseedInventoryShards(EVT, { event: 5, tiers: { ga: 5 } }, { dryRun: false })
    expect(await shards.availabilityOf(EVT, shards.EVENT_BUCKET)).toEqual(expect.objectContaining({ sold: 5, held: 1, alloc: 10 }))
    expect(mockFs.get(`inventory_reservations/${hold.holdId}`)?.state).toBe('held')
    // 4 left: 5 sold + 1 held of 10.
    const r = await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 5, tierIncrements: [{ tierId: 'ga', quantity: 5 }] })
    expect(r).toEqual(expect.objectContaining({ ok: false, remaining: 4 }))
  })

  it('reseed above capacity: nothing more sells until the total is back under', async () => {
    seedEvent({ max_tickets: 4 })
    await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 1, tierIncrements: [] })
    await shards.reseedInventoryShards(EVT, { event: 6, tiers: {} }, { dryRun: false })
    expect((await inventory.reserveInventoryAtomic({ eventId: EVT, quantity: 1, tierIncrements: [] })).ok).toBe(false)
  })
})

describe('seat hold config', () => {
  it('defaults to 8 minutes and honours SEAT_HOLD_MINUTES', () => {
    expect(holds.seatHoldMs({})).toBe(8 * 60_000)
    expect(holds.seatHoldMs({ SEAT_HOLD_MINUTES: '12' })).toBe(12 * 60_000)
    expect(holds.seatHoldMs({ SEAT_HOLD_MINUTES: 'junk' })).toBe(8 * 60_000)
  })
})
