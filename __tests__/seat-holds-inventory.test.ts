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
    expect(await shards.availabilityOf(EVT, shards.EVENT_BUCKET)).toEqual({ used: 3, sold: 3, held: 0 })
    expect(mockFs.get(`inventory_reservations/${hold.holdId}`)?.state).toBe('sold')
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

  it('a new checkout by the same buyer releases their previous hold', async () => {
    seedEvent({ max_tickets: 2 })
    const first = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card', ownerKey: 'user:u1' })
    const second = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card', ownerKey: 'user:u1' })
    expect(second.ok).toBe(true)
    expect(mockFs.get(`inventory_reservations/${first.holdId}`)?.state).toBe('released')
  })

  it('expired hold + successful payment: converts anyway when capacity allows', async () => {
    seedEvent({ max_tickets: 3 })
    const hold = await holds.createSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], source: 'card', holdMs: 1 })
    await new Promise((r) => setTimeout(r, 5))
    const r = await inventory.convertSeatHold({ eventId: EVT, quantity: 2, tierIncrements: [], reservationId: hold.holdId })
    expect(r.ok).toBe(true)
    expect(await shards.availabilityOf(EVT, shards.EVENT_BUCKET)).toEqual({ used: 2, sold: 2, held: 0 })
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
    expect(await shards.availabilityOf(EVT, shards.EVENT_BUCKET)).toEqual({ used: 2, sold: 2, held: 0 })
  }, 30_000)
})

describe('hold abuse limits and release authorization', () => {
  it('caps live holds per network per event, and a replaced hold frees its slot', async () => {
    seedEvent({ max_tickets: 1000 })
    const env = process.env.SEAT_HOLD_MAX_PER_IP
    process.env.SEAT_HOLD_MAX_PER_IP = '3'
    try {
      const make = (owner: string) =>
        holds.createSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [], source: 'card', ownerKey: owner, ipAddress: '1.2.3.4, 10.0.0.1' })
      for (const o of ['user:a', 'user:b', 'user:c']) expect((await make(o)).ok).toBe(true)
      const fourth = await make('user:d')
      expect(fourth).toEqual(expect.objectContaining({ ok: false, reason: 'too_many_holds' }))
      expect(holds.seatHoldRefusal(fourth)).toEqual({ status: 429, body: expect.objectContaining({ code: 'too_many_holds' }) })
      // The same buyer reopening checkout replaces their own hold: still within the cap.
      expect((await make('user:a')).ok).toBe(true)
      // Another network is unaffected.
      const other = await holds.createSeatHold({ eventId: EVT, quantity: 1, tierIncrements: [], source: 'card', ipAddress: '5.6.7.8' })
      expect(other.ok).toBe(true)
      expect(await used()).toBe(4)
    } finally {
      process.env.SEAT_HOLD_MAX_PER_IP = env
    }
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

describe('seat hold config', () => {
  it('defaults to 8 minutes and honours SEAT_HOLD_MINUTES', () => {
    expect(holds.seatHoldMs({})).toBe(8 * 60_000)
    expect(holds.seatHoldMs({ SEAT_HOLD_MINUTES: '12' })).toBe(12 * 60_000)
    expect(holds.seatHoldMs({ SEAT_HOLD_MINUTES: 'junk' })).toBe(8 * 60_000)
  })
})
