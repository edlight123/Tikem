/**
 * Unit tests for reserveInventoryAtomic() / releaseInventoryReservation() — the authoritative
 * oversell gate used by every payment fulfillment path.
 *
 * We model a Firestore transaction (runTransaction + tx.get/tx.set) over an in-memory store so we
 * can assert the check-and-increment behaviour without a real database.
 */

// Recognizable sentinel for FieldValue.increment so we can assert exact deltas.
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __increment: n }) },
}))

// In-memory Firestore: `${collection}/${id}` -> data (absent key ⇒ doc does not exist).
const store = new Map<string, any>()
let txWrites: Array<{ key: string; data: any }> = []
let failTransaction = false
const setSpy = jest.fn(async () => {})

jest.mock('@/lib/firebase/admin', () => {
  const makeRef = (col: string, id: string) => ({ __key: `${col}/${id}`, col, id, set: setSpy })
  const collection = jest.fn((name: string) => ({ doc: (id: string) => makeRef(name, String(id)) }))
  const runTransaction = jest.fn(async (fn: any) => {
    if (failTransaction) throw new Error('firestore down')
    const tx = {
      get: async (ref: any) => ({ exists: store.has(ref.__key), data: () => store.get(ref.__key) }),
      set: (ref: any, data: any) => {
        txWrites.push({ key: ref.__key, data })
      },
    }
    return fn(tx)
  })
  return { adminDb: { collection, runTransaction } }
})

import { reserveInventoryAtomic, releaseInventoryReservation } from '@/lib/tickets/inventory'

beforeEach(() => {
  store.clear()
  txWrites = []
  failTransaction = false
  setSpy.mockClear()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('reserveInventoryAtomic()', () => {
  it('reserves and increments when under both event and tier capacity', async () => {
    store.set('events/evt1', { max_tickets: 100, tickets_sold: 10 })
    store.set('ticket_tiers/tierA', { total_quantity: 50, sold_quantity: 5 })

    const result = await reserveInventoryAtomic({
      eventId: 'evt1',
      quantity: 5,
      tierIncrements: [{ tierId: 'tierA', quantity: 5 }],
    })

    expect(result.ok).toBe(true)
    // Event + tier both incremented inside the transaction.
    expect(txWrites).toEqual([
      { key: 'events/evt1', data: expect.objectContaining({ tickets_sold: { __increment: 5 } }) },
      { key: 'ticket_tiers/tierA', data: expect.objectContaining({ sold_quantity: { __increment: 5 } }) },
    ])
  })

  it('blocks (no writes) when the event would exceed capacity', async () => {
    store.set('events/evt1', { max_tickets: 100, tickets_sold: 98 })

    const result = await reserveInventoryAtomic({ eventId: 'evt1', quantity: 5, tierIncrements: [] })

    expect(result).toMatchObject({ ok: false, reason: 'event_capacity', remaining: 2, requested: 5 })
    expect(txWrites).toEqual([]) // nothing reserved
  })

  it('blocks (no writes) when a tier would exceed capacity, identifying the tier', async () => {
    store.set('events/evt1', { max_tickets: 1000, tickets_sold: 0 })
    store.set('ticket_tiers/vip', { total_quantity: 10, sold_quantity: 9 })

    const result = await reserveInventoryAtomic({
      eventId: 'evt1',
      quantity: 2,
      tierIncrements: [{ tierId: 'vip', quantity: 2 }],
    })

    expect(result).toMatchObject({ ok: false, reason: 'tier_capacity', tierId: 'vip', remaining: 1, requested: 2 })
    expect(txWrites).toEqual([])
  })

  it('allows exactly filling capacity (boundary)', async () => {
    store.set('events/evt1', { max_tickets: 100, tickets_sold: 95 })

    const result = await reserveInventoryAtomic({ eventId: 'evt1', quantity: 5, tierIncrements: [] })

    expect(result.ok).toBe(true)
    expect(txWrites).toEqual([
      { key: 'events/evt1', data: expect.objectContaining({ tickets_sold: { __increment: 5 } }) },
    ])
  })

  it('treats a missing/zero capacity as unlimited', async () => {
    store.set('events/evt1', { tickets_sold: 999999 }) // no max_tickets/capacity

    const result = await reserveInventoryAtomic({ eventId: 'evt1', quantity: 3, tierIncrements: [] })

    expect(result.ok).toBe(true)
    expect(txWrites).toEqual([
      { key: 'events/evt1', data: expect.objectContaining({ tickets_sold: { __increment: 3 } }) },
    ])
  })

  it('falls back to event.capacity then total_tickets when max_tickets is absent', async () => {
    store.set('events/evt1', { capacity: 4, tickets_sold: 4 }) // full via `capacity`

    const result = await reserveInventoryAtomic({ eventId: 'evt1', quantity: 1, tierIncrements: [] })

    expect(result).toMatchObject({ ok: false, reason: 'event_capacity', remaining: 0 })
    expect(txWrites).toEqual([])
  })

  it('treats a non-existent event doc as unlimited (still increments)', async () => {
    const result = await reserveInventoryAtomic({ eventId: 'missing', quantity: 2, tierIncrements: [] })
    expect(result.ok).toBe(true)
    expect(txWrites).toEqual([
      { key: 'events/missing', data: expect.objectContaining({ tickets_sold: { __increment: 2 } }) },
    ])
  })

  it('can skip the event-capacity check while still enforcing tier capacity', async () => {
    store.set('events/evt1', { max_tickets: 1, tickets_sold: 100 }) // would fail if enforced
    store.set('ticket_tiers/tierA', { total_quantity: 50, sold_quantity: 0 })

    const result = await reserveInventoryAtomic({
      eventId: 'evt1',
      quantity: 2,
      tierIncrements: [{ tierId: 'tierA', quantity: 2 }],
      enforceEventCapacity: false,
    })

    expect(result.ok).toBe(true)
    expect(txWrites).toEqual([
      { key: 'events/evt1', data: expect.objectContaining({ tickets_sold: { __increment: 2 } }) },
      { key: 'ticket_tiers/tierA', data: expect.objectContaining({ sold_quantity: { __increment: 2 } }) },
    ])
  })

  it('returns ok without a transaction for invalid input', async () => {
    const result = await reserveInventoryAtomic({ eventId: 'evt1', quantity: 0, tierIncrements: [] })
    expect(result.ok).toBe(true)
    expect(txWrites).toEqual([])
  })

  it('fails OPEN on a transaction error (never strands a paid order)', async () => {
    failTransaction = true
    store.set('events/evt1', { max_tickets: 100, tickets_sold: 0 })

    const result = await reserveInventoryAtomic({
      eventId: 'evt1',
      quantity: 2,
      tierIncrements: [{ tierId: 'tierA', quantity: 2 }],
    })

    expect(result).toMatchObject({ ok: true, reason: 'error' })
    // Best-effort non-atomic increment still moved the counters (event + tier).
    expect(setSpy).toHaveBeenCalled()
  })
})

describe('releaseInventoryReservation()', () => {
  it('decrements the event and each tier (negative increments)', async () => {
    await releaseInventoryReservation({
      eventId: 'evt1',
      quantity: 3,
      tierIncrements: [{ tierId: 'tierA', quantity: 2 }],
    })

    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tickets_sold: { __increment: -3 } }),
      { merge: true }
    )
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sold_quantity: { __increment: -2 } }),
      { merge: true }
    )
  })
})

describe('reserveInventoryAtomic() money-path guards', () => {
  it.each([0.01, 1.01, 2.5])('refuses a fractional order quantity %p (no writes)', async (q) => {
    store.set('events/evt1', { max_tickets: 100, tickets_sold: 0 })
    const result = await reserveInventoryAtomic({ eventId: 'evt1', quantity: q, tierIncrements: [] })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_quantity' })
    expect(txWrites).toEqual([])
  })

  it('refuses a fractional tier line (no writes)', async () => {
    const result = await reserveInventoryAtomic({
      eventId: 'evt1',
      quantity: 2,
      tierIncrements: [{ tierId: 'tierA', quantity: 1.5 }],
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_quantity' })
    expect(txWrites).toEqual([])
  })

  it("refuses a tier that belongs to ANOTHER event (no writes)", async () => {
    store.set('events/evt1', { max_tickets: 100, tickets_sold: 0 })
    store.set('ticket_tiers/foreign', { event_id: 'evt2', total_quantity: 0, sold_quantity: 0 })
    const result = await reserveInventoryAtomic({
      eventId: 'evt1',
      quantity: 1,
      tierIncrements: [{ tierId: 'foreign', quantity: 1 }],
    })
    expect(result).toMatchObject({ ok: false, reason: 'tier_mismatch', tierId: 'foreign' })
    expect(txWrites).toEqual([])
  })

  it('does not conjure a tier doc that does not exist', async () => {
    store.set('events/evt1', { max_tickets: 100, tickets_sold: 0 })
    const result = await reserveInventoryAtomic({
      eventId: 'evt1',
      quantity: 1,
      tierIncrements: [{ tierId: 'ghost', quantity: 1 }],
    })
    expect(result.ok).toBe(true)
    expect(txWrites.map((w) => w.key)).toEqual(['events/evt1'])
  })
})
