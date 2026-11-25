/**
 * Add-on stock in the sharded inventory (lib/tickets/inventoryShards.ts):
 * held with the seats when checkout starts, converted when the order is paid,
 * released with the hold, and never oversold under concurrency — against the
 * Firestore fake with REAL optimistic-concurrency transactions.
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
const MEAL = { id: 'ao_meal', name: 'Iftar meal', price: 15, quantity: 5 }

function seedEvent(data: Record<string, any> = {}) {
  mockFs.seed(`events/${EVT}`, { title: 'Iftar', max_tickets: 100, tickets_sold: 0, add_ons: [MEAL], ...data })
}

const hold = (addOnQty: number, seats = 1) =>
  holds.createSeatHold({
    eventId: EVT,
    quantity: seats,
    tierIncrements: [],
    addOnIncrements: [{ addOnId: 'ao_meal', quantity: addOnQty }],
    source: 'card',
  })

beforeEach(() => {
  mockFs.reset()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('add-on stock', () => {
  it('a hold counts against the add-on stock; the add-on never counts as a seat', async () => {
    seedEvent()
    const a = await hold(4, 2)
    expect(a.ok).toBe(true)
    expect(await shards.availabilityOf(EVT, shards.EVENT_BUCKET)).toEqual(expect.objectContaining({ used: 2 }))
    expect(await shards.availabilityOf(EVT, shards.addOnBucket('ao_meal'))).toEqual(expect.objectContaining({ used: 4, held: 4 }))

    const b = await hold(2)
    expect(b).toEqual(expect.objectContaining({ ok: false, reason: 'addon_capacity', addOnId: 'ao_meal', remaining: 1 }))
    expect(holds.seatHoldRefusal(b)).toEqual({
      status: 409,
      body: expect.objectContaining({ code: 'addon_only_n_left', remaining: 1, addOnId: 'ao_meal' }),
    })
    // Nothing of the refused hold stuck: the seat it asked for is still free.
    expect(await shards.availabilityOf(EVT, shards.EVENT_BUCKET)).toEqual(expect.objectContaining({ used: 2 }))
  })

  it('converts with the seats, rolls up add_ons_sold, and a release gives it back', async () => {
    seedEvent()
    const h = await hold(3)
    const params = {
      eventId: EVT,
      quantity: 1,
      tierIncrements: [],
      addOnIncrements: [{ addOnId: 'ao_meal', quantity: 3 }],
      reservationId: h.holdId,
    }
    expect(await inventory.convertSeatHold(params)).toEqual(expect.objectContaining({ ok: true }))
    expect(await inventory.convertSeatHold(params)).toEqual(expect.objectContaining({ ok: true, alreadyDone: true }))
    expect(await shards.availabilityOf(EVT, shards.addOnBucket('ao_meal'))).toEqual(expect.objectContaining({ sold: 3, held: 0 }))
    await shards.rollupInventoryCounters(EVT)
    expect(mockFs.get(`events/${EVT}`)?.add_ons_sold).toEqual({ ao_meal: 3 })

    // A refund of the order's add-ons gives them back (partial release).
    await shards.releaseSeats({ reservationId: h.holdId, addOnIncrements: [{ addOnId: 'ao_meal', quantity: 3 }] })
    expect(await shards.availabilityOf(EVT, shards.addOnBucket('ao_meal'))).toEqual(expect.objectContaining({ sold: 0 }))
    expect(await shards.availabilityOf(EVT, shards.EVENT_BUCKET)).toEqual(expect.objectContaining({ sold: 1 }))
  })

  it('a released hold frees the add-on for the next buyer', async () => {
    seedEvent()
    const a = await hold(5)
    expect((await hold(1)).ok).toBe(false)
    await holds.releaseSeatHold(a.holdId)
    expect((await hold(1)).ok).toBe(true)
  })

  it('never oversells under a rush', async () => {
    seedEvent({ add_ons: [{ ...MEAL, quantity: 7 }] })
    const results = await Promise.all(Array.from({ length: 12 }, () => hold(1)))
    expect(results.filter((r: any) => r.ok)).toHaveLength(7)
    expect(await shards.availabilityOf(EVT, shards.addOnBucket('ao_meal'))).toEqual(expect.objectContaining({ used: 7 }))
  })

  it('an add-on without a stock limit is unlimited', async () => {
    seedEvent({ add_ons: [{ ...MEAL, quantity: null }] })
    for (let i = 0; i < 3; i++) expect((await hold(20)).ok).toBe(true)
  })
})
