/**
 * The finance page's batch "Request payout" and the per-event withdraw routes
 * now share ONE availability figure and ONE paid ledger.
 *
 * Runs the REAL request-payout and admin decline routes over the REAL
 * lib/payouts/availability(-server) and lib/earnings, with an in-memory
 * serializing Firestore. Faked: session, payout profile, the release gate
 * (its own tests cover it) and its organizer context, platform settings
 * (shipped defaults), promoter commission (0).
 *
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Fake Firestore (flat collections; subcollections named by path)
// ---------------------------------------------------------------------------
const db: Record<string, Record<string, any>> = {}
let autoId = 0
const coll = (name: string) => (db[name] = db[name] || {})
const clone = (v: any) => (v === undefined ? undefined : structuredClone(v))
function snapOf(name: string, id: string) {
  const data = coll(name)[id]
  return { id, exists: data !== undefined, ref: docRef(name, id), data: () => clone(data) }
}
function docRef(name: string, id?: string): any {
  const docId = id ?? `auto_${++autoId}`
  return {
    __kind: 'doc',
    id: docId,
    _c: name,
    get: async () => snapOf(name, docId),
    set: async (data: any) => void (coll(name)[docId] = clone(data)),
    update: async (patch: any) => {
      if (coll(name)[docId] === undefined) throw new Error(`NOT_FOUND ${name}/${docId}`)
      coll(name)[docId] = { ...coll(name)[docId], ...clone(patch) }
    },
    create: async (data: any) => {
      if (coll(name)[docId] !== undefined) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      coll(name)[docId] = clone(data)
    },
    collection: (sub: string) => collectionApi(`${name}/${docId}/${sub}`),
  }
}
function query(name: string, filters: Array<[string, any]> = [], lim = Infinity): any {
  return {
    where: (f: string, _op: string, v: any) => query(name, [...filters, [f, v]], lim),
    limit: (n: number) => query(name, filters, n),
    get: async () => {
      const docs = Object.keys(coll(name))
        .filter((id) => filters.every(([f, v]) => coll(name)[id]?.[f] === v))
        .slice(0, lim)
        .map((id) => snapOf(name, id))
      return { empty: docs.length === 0, size: docs.length, docs }
    },
  }
}
function collectionApi(name: string) {
  return {
    doc: (id?: string) => docRef(name, id),
    where: (f: string, op: string, v: any) => query(name).where(f, op, v),
    limit: (n: number) => query(name).limit(n),
    get: () => query(name).get(),
  }
}
let txChain: Promise<any> = Promise.resolve()
async function runTransaction(fn: (tx: any) => Promise<any>) {
  const run = async () => {
    const writes: Array<() => Promise<void>> = []
    const tx = {
      get: async (target: any) => target.get(),
      set: (ref: any, data: any) => void writes.push(() => ref.set(data)),
      update: (ref: any, patch: any) => void writes.push(() => ref.update(patch)),
    }
    const result = await fn(tx)
    for (const w of writes) await w()
    return result
  }
  const p = txChain.then(run, run)
  txChain = p.catch(() => undefined)
  return p
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: (name: string) => collectionApi(name), runTransaction: (fn: any) => runTransaction(fn) },
  adminAuth: { verifySessionCookie: jest.fn(async () => ({ uid: 'org1' })) },
}))
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'session-cookie' }) }) }))
jest.mock('@/lib/auth', () => ({ requireAdmin: jest.fn(async () => ({ user: { id: 'admin1', email: 'a@tikem.co' }, error: null })) }))
jest.mock('@/lib/admin/audit-log', () => ({ logAdminAction: jest.fn(async () => {}) }))
jest.mock('@/lib/firestore/payout-profiles', () => ({
  getPayoutProfile: jest.fn(async () => ({ status: 'active', method: 'mobile_money' })),
  getRequiredPayoutProfileIdForEventCountry: (c: any) => (['US', 'CA', 'FR'].includes(String(c || '').toUpperCase()) ? 'stripe_connect' : 'haiti'),
}))
const gateMock = jest.fn(async (_i: any): Promise<any> => ({ allowed: true, reviewStatus: null }))
jest.mock('@/lib/payouts/withdrawal-gate', () => ({
  gateHaitiWithdrawal: (i: any) => gateMock(i),
  loadOrganizerReleaseContext: jest.fn(async (organizerId: string) => ({
    organizerId,
    platformConfig: {},
    override: { forceEstablished: true },
    endedEventIds: new Set<string>(),
    lifetimeGrossMinorByCurrency: {},
    fxWarnings: [],
  })),
}))
jest.mock('@/lib/admin/platform-settings', () => ({
  getPlatformSettings: jest.fn(async () => jest.requireActual('@/types/platform-settings').DEFAULT_PLATFORM_SETTINGS),
}))
jest.mock('@/lib/promoters', () => ({ getFundedCommissionForEvent: jest.fn(async () => 0) }))

import { POST as requestPayout } from '@/app/api/organizer/request-payout/route'
import { POST as declinePayout } from '@/app/api/admin/payouts/decline/route'
import { loadEventAvailability, loadOrganizerAvailability } from '@/lib/payouts/availability-server'
import { summaryFromAvailability } from '@/lib/payouts/availability'

const ENDED = { _seconds: Date.parse('2026-09-01T23:00:00.000Z') / 1000, _nanoseconds: 0 } // a stored Timestamp

let tid = 0
function sell(eventId: string, priceMajor: number, over: Record<string, any> = {}) {
  // Once a ledger row exists, a real sale also books it (addTicketToEarnings).
  const row = Object.values(coll('event_earnings')).find((r: any) => r.eventId === eventId) as any
  if (row) row.grossSales = (Number(row.grossSales) || 0) + Math.round(priceMajor * 100)
  tid += 1
  coll('tickets')[`t${tid}`] = {
    event_id: eventId,
    status: 'confirmed',
    price_paid: priceMajor,
    currency: String(coll('events')[eventId]?.currency || 'HTG'),
    payment_method: 'moncash',
    payment_id: `pay${tid}`,
    checked_in: true,
    check_in_method: 'scan',
    purchased_at: '2026-08-20T10:00:00.000Z',
    ...over,
  }
  return `t${tid}`
}

function seed() {
  for (const k of Object.keys(db)) delete db[k]
  tid = 0
  coll('events').htg1 = { organizer_id: 'org1', title: 'Konpa', currency: 'HTG', country: 'HT', end_datetime: ENDED, status: 'published' }
  coll('events').htg2 = { organizer_id: 'org1', title: 'Rara', currency: 'HTG', country: 'HT', end_datetime: ENDED, status: 'published' }
  coll('events').usd1 = { organizer_id: 'org1', title: 'Diaspora', currency: 'USD', country: 'HT', end_datetime: ENDED, status: 'published' }
  sell('htg1', 10_000) // fee capped at 750 → 9,250 HTG
  sell('htg2', 1_000) //  fee 100 → 900 HTG
  sell('usd1', 100, { payment_method: 'stripe' }) // fee capped at $5 → $95
  gateMock.mockClear()
}

const req = (body: any = {}) => ({ json: async () => body }) as any
const payouts = () => Object.entries(coll('organizers/org1/payouts')).map(([id, d]) => ({ id, ...(d as any) }))
const ledger = (eventId: string) => Object.values(coll('event_earnings')).find((r: any) => r.eventId === eventId) as any

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('finance page figures == what the batch request pays', () => {
  it('per-currency totals; a mixed-currency request must name its currency', async () => {
    seed()
    const { totals, events } = await loadOrganizerAvailability('org1')
    expect(totals).toEqual([
      expect.objectContaining({ currency: 'HTG', availableNowMinor: 925_000 + 90_000 }),
      expect.objectContaining({ currency: 'USD', availableNowMinor: 9_500 }),
    ])
    // The table rows come from the same figures.
    const summary = summaryFromAvailability(events)
    expect(summary.currency).toBe('mixed')
    expect(summary.totalsByCurrency?.HTG?.totalAvailableToWithdraw).toBe(1_015_000)

    const res = await requestPayout(req())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('currency_required')
    expect(payouts()).toEqual([])
  })

  it('pays exactly the shown HTG figure, debits each event’s ledger, records ticketIds + per-event amounts', async () => {
    seed()
    const res = await requestPayout(req({ currency: 'HTG' }))
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out.payout).toMatchObject({
      amount: 1_015_000,
      currency: 'HTG',
      status: 'pending',
      debitedEventEarnings: true,
      eventAmounts: { htg1: 925_000, htg2: 90_000 },
    })
    expect(out.payout.ticketIds.sort()).toEqual(['t1', 't2'])
    expect(ledger('htg1').withdrawnAmount).toBe(925_000)
    expect(ledger('htg2').withdrawnAmount).toBe(90_000)
    // USD untouched — never summed into an HTG payout.
    expect(ledger('usd1')).toBeUndefined()

    // The gate saw each event with the same inputs the screen used.
    expect(gateMock).toHaveBeenCalledTimes(2)
    expect(gateMock).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'htg1', requestedAmountMinor: 925_000, availableMinor: 925_000, method: 'batch' }))

    // No double pay through the per-event MonCash/bank routes afterwards.
    const after = await loadEventAvailability({ eventId: 'htg1' })
    expect(after?.balanceMinor).toBe(0)
    expect(after?.availableNowMinor).toBe(0)
  })

  it('an approved (not yet completed) payout blocks a second request — the old check missed `approved`', async () => {
    seed()
    await requestPayout(req({ currency: 'HTG' }))
    const [p] = payouts()
    coll('organizers/org1/payouts')[p.id].status = 'approved'
    sell('htg2', 5_000) // a new sale since
    const res = await requestPayout(req({ currency: 'HTG' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Payout already in progress')
    expect(payouts()).toHaveLength(1)
  })

  it('a later sale is payable once the earlier batch completes — only the new money', async () => {
    seed()
    await requestPayout(req({ currency: 'HTG' }))
    const [p] = payouts()
    coll('organizers/org1/payouts')[p.id].status = 'completed'
    sell('htg2', 1_000)
    const res = await requestPayout(req({ currency: 'HTG' }))
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out.payout.amount).toBe(90_000)
    expect(out.payout.eventAmounts).toEqual({ htg2: 90_000 })
  })

  it('admin decline credits the ledger back, once', async () => {
    seed()
    await requestPayout(req({ currency: 'HTG' }))
    const [p] = payouts()
    const decline = () => declinePayout(req({ organizerId: 'org1', payoutId: p.id, reason: 'wrong number' }))

    expect((await decline()).status).toBe(200)
    expect(ledger('htg1').withdrawnAmount).toBe(0)
    expect(ledger('htg2').withdrawnAmount).toBe(0)
    const back = await loadEventAvailability({ eventId: 'htg1' })
    expect(back?.availableNowMinor).toBe(925_000)

    // Idempotent: a second decline is a no-op, not a second credit.
    expect((await decline()).status).toBe(200)
    expect(ledger('htg1').withdrawnAmount).toBe(0)
  })

  it('a legacy payout (no ledger debit) in any open status still reduces what is available', async () => {
    seed()
    coll('organizers/org1/payouts').legacy = { status: 'completed', ticketIds: ['t1'], amount: 900_000, currency: 'HTG' }
    const a = await loadEventAvailability({ eventId: 'htg1' })
    expect(a?.batchReservedMinor).toBe(925_000)
    expect(a?.availableNowMinor).toBe(0)
    const res = await requestPayout(req({ currency: 'HTG' }))
    expect((await res.json()).payout.amount).toBe(90_000)
  })

  it('below the minimum is refused with the currency named', async () => {
    for (const k of Object.keys(db)) delete db[k]
    coll('events').small = { organizer_id: 'org1', title: 'S', currency: 'HTG', country: 'HT', end_datetime: ENDED }
    sell('small', 10) // 9.00 HTG net
    const res = await requestPayout(req())
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/50\.00 HTG.*9\.00 HTG/)
  })
})

describe('admin cancel of a batch payout (F3, F4)', () => {
  it('credits back a LEGACY ledger row keyed by event_id (the old eventId-only lookup skipped it)', async () => {
    seed()
    await requestPayout(req({ currency: 'HTG' }))
    // Re-key htg1's row the legacy way.
    const [rowId, row] = Object.entries(coll('event_earnings')).find(([, r]: any) => r.eventId === 'htg1') as any
    delete coll('event_earnings')[rowId]
    const legacy = { ...row }
    delete legacy.eventId
    legacy.event_id = 'htg1'
    coll('event_earnings').legacy_row = legacy
    const [p] = payouts()
    expect((await declinePayout(req({ organizerId: 'org1', payoutId: p.id, reason: 'x' }))).status).toBe(200)
    expect(coll('event_earnings').legacy_row.withdrawnAmount).toBe(0)
  })

  it('an APPROVED batch can be cancelled only with confirmNotPaid, and is then credited back once', async () => {
    seed()
    await requestPayout(req({ currency: 'HTG' }))
    const [p] = payouts()
    coll('organizers/org1/payouts')[p.id].status = 'approved'

    const refused = await declinePayout(req({ organizerId: 'org1', payoutId: p.id, reason: 'x' }))
    expect(refused.status).toBe(409)
    expect(ledger('htg1').withdrawnAmount).toBe(925_000)

    const ok = await declinePayout(req({ organizerId: 'org1', payoutId: p.id, reason: 'x', confirmNotPaid: true }))
    expect(ok.status).toBe(200)
    expect(ledger('htg1').withdrawnAmount).toBe(0)
    expect(coll('organizers/org1/payouts')[p.id]).toMatchObject({ status: 'cancelled', cancelledAfterApproval: true })

    // Completed payouts can never be cancelled.
    coll('organizers/org1/payouts')[p.id].status = 'completed'
    expect((await declinePayout(req({ organizerId: 'org1', payoutId: p.id, reason: 'x', confirmNotPaid: true }))).status).toBe(409)
  })
})

describe('integrity-flagged events are never paid through the batch', () => {
  it('a ticket sold in another currency than the event now shows: whole batch refused, nothing debited', async () => {
    seed()
    coll('events').htg2.currency = 'USD' // re-labelled after an HTG sale
    const res = await requestPayout(req({ currency: 'HTG' }))
    const out = await res.json()
    expect(res.status).toBe(409)
    expect(out).toMatchObject({ code: 'ticket_currency_review', eventId: 'htg2', needsAdminReview: true })
    expect(payouts()).toEqual([])
    expect(Object.keys(coll('event_earnings'))).toEqual([])
  })

  it('ticket gross above a complete ledger gross: refused, nothing debited', async () => {
    seed()
    coll('event_earnings').htg1 = { eventId: 'htg1', organizerId: 'org1', currency: 'HTG', grossSales: 500_000, grossSalesComplete: true, withdrawnAmount: 0 }
    const res = await requestPayout(req({ currency: 'HTG' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ledger_gross_exceeded')
    expect(payouts()).toEqual([])
    expect(coll('event_earnings').htg1.withdrawnAmount).toBe(0)
  })
})
