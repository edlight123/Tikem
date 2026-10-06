/**
 * Unit tests for gateHaitiWithdrawal() — the release ladder applied to the Haiti
 * (MonCash / bank transfer) rail at withdrawal-REQUEST time.
 *
 * The decision itself lives in lib/payouts/release-rules.ts and is already pure;
 * what is worth pinning down here is the wiring: that an undated event cannot be
 * withdrawn, that nothing releases before the event ends, that the tier ladder and
 * the admin pre-event grant both reach this rail, and that a 'review' verdict
 * lands in the SAME payout_review_queue the Stripe cron writes.
 *
 * Firestore is modelled in memory (same approach as inventory-reserve.test.ts).
 */

type Doc = Record<string, any>

// `${collection}/${id}` -> data. An absent key means the doc does not exist.
const store = new Map<string, Doc>()
const writes: Array<{ key: string; data: Doc; merge: boolean }> = []

function collectionDocs(name: string): Array<{ id: string; data: Doc }> {
  const out: Array<{ id: string; data: Doc }> = []
  for (const [key, data] of Array.from(store.entries())) {
    const slash = key.indexOf('/')
    if (key.slice(0, slash) === name) out.push({ id: key.slice(slash + 1), data })
  }
  return out
}

jest.mock('@/lib/firebase/admin', () => {
  const makeQuery = (name: string, filters: Array<[string, string, any]>) => ({
    where: (field: string, op: string, value: any) => makeQuery(name, [...filters, [field, op, value]]),
    select: () => makeQuery(name, filters),
    limit: () => makeQuery(name, filters),
    get: async () => {
      const rows = collectionDocs(name).filter(({ data }) =>
        filters.every(([field, op, value]) => (op === '==' ? data[field] === value : true))
      )
      return {
        empty: rows.length === 0,
        docs: rows.map(({ id, data }) => ({ id, exists: true, data: () => data })),
      }
    },
  })

  const makeDocRef = (name: string, id: string) => {
    const key = `${name}/${id}`
    return {
      id,
      get: async () => ({
        id,
        exists: store.has(key),
        data: () => store.get(key),
      }),
      set: async (data: Doc, options?: { merge?: boolean }) => {
        writes.push({ key, data, merge: Boolean(options?.merge) })
        store.set(key, options?.merge ? { ...(store.get(key) || {}), ...data } : data)
      },
    }
  }

  return {
    adminDb: {
      collection: (name: string) => ({
        ...makeQuery(name, []),
        doc: (id: string) => makeDocRef(name, String(id)),
      }),
    },
  }
})

const getPlatformSettings = jest.fn()
jest.mock('@/lib/admin/platform-settings', () => ({
  getPlatformSettings: (...args: any[]) => getPlatformSettings(...args),
}))

import { gateHaitiWithdrawal } from '@/lib/payouts/withdrawal-gate'
import { DEFAULT_PAYOUT_RELEASE_CONFIG } from '@/types/platform-settings'

const ORGANIZER = 'org_1'
const EVENT = 'evt_1'
const NOW = new Date('2026-08-13T12:00:00.000Z')
const HOUR = 3_600_000

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR).toISOString()
}

/** A single sold, checked-in ticket so the attendance signals stay quiet. */
function seedTickets(eventId = EVENT, count = 10) {
  for (let i = 0; i < count; i += 1) {
    store.set(`tickets/${eventId}_t${i}`, {
      event_id: eventId,
      status: 'confirmed',
      checked_in: true,
      check_in_method: 'scan',
      price_paid: 20,
    })
  }
}

function seedEvent(fields: Doc = {}) {
  store.set(`events/${EVENT}`, {
    organizer_id: ORGANIZER,
    status: 'published',
    currency: 'USD',
    end_datetime: hoursAgo(100),
    ...fields,
  })
}

/**
 * Completed events other than the one under test → tier history. Only a
 * PUBLISHED event with a paid live ticket counts (lib/payouts/completed-events).
 */
function seedCompletedEvents(count: number) {
  for (let i = 0; i < count; i += 1) {
    store.set(`events/other_${i}`, {
      organizer_id: ORGANIZER,
      status: 'published',
      is_published: true,
      end_datetime: hoursAgo(1000 + i),
    })
    store.set(`tickets/other_${i}_t0`, {
      event_id: `other_${i}`,
      status: 'confirmed',
      price_paid: 20,
      purchased_at: hoursAgo(1100 + i),
    })
  }
}

/** Zero-sale drafts backdated to look finished: must NOT earn the established tier. */
function seedBackdatedDrafts(count: number) {
  for (let i = 0; i < count; i += 1) {
    store.set(`events/draft_${i}`, {
      organizer_id: ORGANIZER,
      status: 'draft',
      is_published: false,
      end_datetime: hoursAgo(1000 + i),
    })
  }
}

function seedLifetimeGross(grossMinor: number, currency = 'USD') {
  store.set('event_earnings/earn_history', { organizerId: ORGANIZER, grossSales: grossMinor, currency })
}

async function gate(overrides: Partial<Parameters<typeof gateHaitiWithdrawal>[0]> = {}) {
  return gateHaitiWithdrawal({
    eventId: EVENT,
    organizerId: ORGANIZER,
    eventData: store.get(`events/${EVENT}`),
    grossMinor: 20_000, // $200 gross
    refundedMinor: null,
    currency: 'USD',
    availableMinor: 18_000,
    requestedAmountMinor: 18_000,
    method: 'moncash',
    now: NOW,
    ...overrides,
  })
}

beforeEach(() => {
  store.clear()
  writes.length = 0
  getPlatformSettings.mockReset()
  getPlatformSettings.mockResolvedValue({
    haiti: { platformFeePercentage: 0.05, settlementHoldDays: 0 },
    usCanada: { platformFeePercentage: 0.1, settlementHoldDays: 7 },
    minimumPayoutAmount: 5000,
    payoutRelease: DEFAULT_PAYOUT_RELEASE_CONFIG,
  })
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('gateHaitiWithdrawal — time', () => {
  it('refuses an event with no parseable end date (the old instant-withdrawal hole)', async () => {
    seedEvent({ end_datetime: null, created_at: hoursAgo(500), start_datetime: hoursAgo(400) })
    seedTickets()

    const result = await gate()

    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.body.code).toBe('missing_event_end_date')
    expect(result.body.reason).toBe('no_end_date')
  })

  it('refuses before the event has ended', async () => {
    seedEvent({ end_datetime: new Date(NOW.getTime() + 48 * HOUR).toISOString() })
    seedTickets()

    const result = await gate()

    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.body.code).toBe('event_not_over')
  })

  it('holds a new organizer for the full 72h after the event ends', async () => {
    seedEvent({ end_datetime: hoursAgo(2) })
    seedTickets()

    const result = await gate()

    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.body.code).toBe('release_hold')
    expect(result.body.reason).toBe('hold_72h')
    expect(result.body.params.holdHours).toBe(72)
    expect(result.body.message).toContain('72 hours')
    expect(result.body.params.availableAt).toBe(new Date(NOW.getTime() + 70 * HOUR).toISOString())
  })

  it('releases a new organizer once 72h have passed', async () => {
    seedEvent({ end_datetime: hoursAgo(73) })
    seedTickets()

    const result = await gate()

    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    expect(result.decision.release).toBe('auto')
    expect(result.decision.tier).toBe('new')
  })
})

describe('gateHaitiWithdrawal — tier ladder', () => {
  it('lets an established organizer through at 24h', async () => {
    seedEvent({ end_datetime: hoursAgo(25) })
    seedTickets()
    seedCompletedEvents(3)

    const result = await gate()

    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    expect(result.decision.tier).toBe('established')
  })

  it('does not count zero-sale backdated drafts, or published events whose tickets say they are not over', async () => {
    seedEvent({ end_datetime: hoursAgo(25) })
    seedTickets()
    seedBackdatedDrafts(3)
    // Published and paid, but the doc end was moved back: the ticket stamps the real end.
    for (let i = 0; i < 3; i += 1) {
      store.set(`events/moved_${i}`, {
        organizer_id: ORGANIZER,
        status: 'published',
        is_published: true,
        end_datetime: hoursAgo(1000),
      })
      store.set(`tickets/moved_${i}_t0`, {
        event_id: `moved_${i}`,
        status: 'confirmed',
        price_paid: 20,
        end_datetime: new Date(NOW.getTime() + 48 * HOUR).toISOString(),
      })
    }

    const result = await gate()

    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.body.reason).toBe('hold_72h')
  })

  it('still holds an established organizer inside the 24h window', async () => {
    seedEvent({ end_datetime: hoursAgo(5) })
    seedTickets()
    seedCompletedEvents(3)

    const result = await gate()

    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.body.reason).toBe('hold_24h')
    expect(result.body.params.holdHours).toBe(24)
  })

  it("honours an admin's preEventReleaseApproved grant before the event ends", async () => {
    seedEvent({ end_datetime: new Date(NOW.getTime() + 72 * HOUR).toISOString() })
    seedTickets()
    seedLifetimeGross(500_000) // past the pre-event eligibility bar
    store.set(`organizers/${ORGANIZER}`, { payoutRelease: { preEventReleaseApproved: true } })

    const result = await gate()

    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    expect(result.decision.tier).toBe('pre_event')
  })

  it('ignores a pre-event grant when lifetime volume is below the bar', async () => {
    seedEvent({ end_datetime: new Date(NOW.getTime() + 72 * HOUR).toISOString() })
    seedTickets()
    seedLifetimeGross(1_000)
    store.set(`organizers/${ORGANIZER}`, { payoutRelease: { preEventReleaseApproved: true } })

    const result = await gate()

    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.body.code).toBe('event_not_over')
  })
})

describe('gateHaitiWithdrawal — review queue', () => {
  it('queues a high-risk organizer into payout_review_queue and refuses', async () => {
    seedEvent({ end_datetime: hoursAgo(100) })
    seedTickets()
    store.set(`organizers/${ORGANIZER}`, { payoutRelease: { highRisk: true } })

    const result = await gate()

    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.body.code).toBe('payout_under_review')
    expect(result.status).toBe(409)

    const row = store.get(`payout_review_queue/${EVENT}`)
    expect(row).toBeDefined()
    expect(row).toMatchObject({
      eventId: EVENT,
      organizerId: ORGANIZER,
      status: 'pending',
      reason: 'organizer_flagged_high_risk',
      rail: 'moncash',
      amountMinor: 18_000,
    })
  })

  it('routes a large event from a new organizer to review rather than paying it', async () => {
    seedEvent({ end_datetime: hoursAgo(100) })
    seedTickets()

    const result = await gate({ grossMinor: 250_000, availableMinor: 200_000, requestedAmountMinor: 200_000 })

    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.body.reason).toBe('large_event_from_new_organizer')
    expect(store.get(`payout_review_queue/${EVENT}`)?.status).toBe('pending')
  })

  it('refuses while an existing queue row is still pending, even on an auto verdict', async () => {
    seedEvent({ end_datetime: hoursAgo(100) })
    seedTickets()
    store.set(`payout_review_queue/${EVENT}`, { eventId: EVENT, status: 'pending', reason: 'earlier_flag' })

    const result = await gate()

    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.body.code).toBe('payout_under_review')
    // The admin's row is updated, never replaced.
    expect(writes.at(-1)?.merge).toBe(true)
    expect(store.get(`payout_review_queue/${EVENT}`)?.reason).toBe('eligible+awaiting_admin_review')
  })

  it('lets the withdrawal through once an admin has released the review row', async () => {
    seedEvent({ end_datetime: hoursAgo(100) })
    seedTickets()
    store.set(`organizers/${ORGANIZER}`, { payoutRelease: { highRisk: true } })
    store.set(`payout_review_queue/${EVENT}`, { eventId: EVENT, status: 'released' })

    const result = await gate()

    expect(result.allowed).toBe(true)
    // An admin's resolved row is never rewritten.
    expect(writes).toHaveLength(0)
  })

  it('refuses when a review was closed without approval', async () => {
    seedEvent({ end_datetime: hoursAgo(100) })
    seedTickets()
    store.set(`organizers/${ORGANIZER}`, { payoutRelease: { highRisk: true } })
    store.set(`payout_review_queue/${EVENT}`, { eventId: EVENT, status: 'dismissed' })

    const result = await gate()

    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.body.code).toBe('payout_review_not_approved')
    expect(writes).toHaveLength(0)
  })
})

describe('gateHaitiWithdrawal — money', () => {
  it('refuses a cancelled or payout-frozen event', async () => {
    seedEvent({ end_datetime: hoursAgo(100), status: 'cancelled' })
    seedTickets()
    expect((await gate()).allowed).toBe(false)

    seedEvent({ end_datetime: hoursAgo(100), payouts_frozen: true })
    const frozen = await gate()
    expect(frozen.allowed).toBe(false)
    if (frozen.allowed) return
    expect(frozen.body.code).toBe('payouts_frozen')
  })

  it('caps the request at gross minus refunds', async () => {
    seedEvent({ end_datetime: hoursAgo(100) })
    seedTickets()
    // Half the room refunded: that money is not the organizer's to take, even
    // though the stored earnings row is never decremented on refund.
    for (let i = 0; i < 5; i += 1) {
      store.set(`tickets/${EVENT}_r${i}`, {
        event_id: EVENT,
        status: 'refunded',
        refund_amount: 20,
        price_paid: 20,
      })
    }

    const result = await gate()

    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.body.code).toBe('amount_exceeds_releasable')
    expect(result.body.params.releasableMinor).toBe(10_000)
    // …and the same request for what IS released goes through.
    expect((await gate({ requestedAmountMinor: 10_000 })).allowed).toBe(true)
  })

  it('refuses outright when every ticket was refunded', async () => {
    seedEvent({ end_datetime: hoursAgo(100) })
    seedTickets()
    for (let i = 0; i < 10; i += 1) {
      store.set(`tickets/${EVENT}_r${i}`, {
        event_id: EVENT,
        status: 'refunded',
        refund_amount: 20,
        price_paid: 20,
      })
    }

    const result = await gate()

    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.body.code).toBe('nothing_releasable_yet')
    expect(result.body.reason).toBe('nothing_available_yet')
  })

  it('does not double-count refunds when the gross is derived from tickets', async () => {
    seedEvent({ end_datetime: hoursAgo(100) })
    seedTickets()
    store.set(`tickets/${EVENT}_r0`, { event_id: EVENT, status: 'refunded', refund_amount: 20 })

    // refundedMinor: 0 is what the routes pass for a tickets_derived view.
    const result = await gate({ refundedMinor: 0 })

    expect(result.allowed).toBe(true)
  })

  it('flags a door that was almost entirely checked in by hand', async () => {
    seedEvent({ end_datetime: hoursAgo(100) })
    for (let i = 0; i < 10; i += 1) {
      store.set(`tickets/${EVENT}_m${i}`, {
        event_id: EVENT,
        status: 'confirmed',
        checked_in: true,
        check_in_method: 'manual',
        price_paid: 20,
      })
    }

    const result = await gate()

    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.body.reason).toBe('mostly_manual_checkins')
  })
})
