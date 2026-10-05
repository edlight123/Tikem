/**
 * The INCREMENTAL earnings write must honor fee incidence, exactly like the
 * derived read path already does (earnings-fee-incidence.test.ts).
 *
 * addTicketToEarnings runs at fulfillment for every sale. Under buyer
 * incidence (US / Canada / France) the buyer paid the fee on top and the
 * organizer's transfer is the face value exactly — deducting platform or
 * processing fees here under-reports the organizer's balance on every sale,
 * which getEventEarnings then papers over by preferring the derived view.
 *
 * Firestore is modelled in memory (same approach as earnings-fee-incidence).
 */

type Doc = Record<string, any>

const store = new Map<string, Doc>()

function collectionDocs(name: string): Array<{ id: string; data: Doc }> {
  const out: Array<{ id: string; data: Doc }> = []
  for (const [key, data] of Array.from(store.entries())) {
    const slash = key.indexOf('/')
    if (key.slice(0, slash) === name) out.push({ id: key.slice(slash + 1), data })
  }
  return out
}

jest.mock('@/lib/firebase/admin', () => {
  const docRef = (name: string, id: string) => ({
    id,
    get: async () => {
      const data = store.get(`${name}/${id}`)
      return { exists: !!data, id, data: () => data }
    },
    set: async (data: Doc) => {
      store.set(`${name}/${id}`, { ...(store.get(`${name}/${id}`) || {}), ...data })
    },
    update: async (data: Doc) => {
      store.set(`${name}/${id}`, { ...(store.get(`${name}/${id}`) || {}), ...data })
    },
  })

  const makeQuery = (name: string, filters: Array<[string, string, any]>) => ({
    where: (field: string, op: string, value: any) =>
      makeQuery(name, [...filters, [field, op, value]]),
    orderBy: () => makeQuery(name, filters),
    limit: () => makeQuery(name, filters),
    get: async () => {
      const rows = collectionDocs(name).filter(({ data }) =>
        filters.every(([field, op, value]) => (op === '==' ? data[field] === value : true))
      )
      return {
        empty: rows.length === 0,
        size: rows.length,
        docs: rows.map(({ id, data }) => ({
          id,
          exists: true,
          data: () => data,
          ref: docRef(name, id),
        })),
      }
    },
  })

  const collection = (name: string) => ({
    ...makeQuery(name, []),
    doc: (id?: string) => docRef(name, id || `auto_${store.size}`),
  })

  return { adminDb: { collection } }
})

// Percentage is a FRACTION (0.10), matching DEFAULT_PLATFORM_SETTINGS.
jest.mock('@/lib/admin/platform-settings', () => ({
  getPlatformSettings: async () => ({
    haiti: { platformFeePercentage: 0.1, settlementHoldDays: 0, platformFeeCapMinorByCurrency: { HTG: 75_000, USD: 500 } },
    usCanada: { platformFeePercentage: 0.1, settlementHoldDays: 0, platformFeeCapMinorByCurrency: { USD: 500 } },
  }),
}))

import { addTicketToEarnings } from '@/lib/earnings'

const YESTERDAY = new Date(Date.now() - 24 * 3_600_000).toISOString()

function seed(country: string) {
  store.clear()
  store.set('events/evt_1', {
    country,
    title: 'Test event',
    organizer_id: 'org_1',
    start_datetime: YESTERDAY,
    end_datetime: YESTERDAY,
    currency: country === 'HT' ? 'HTG' : 'USD',
  })
  store.set('event_earnings/earn_1', {
    eventId: 'evt_1',
    organizerId: 'org_1',
    grossSales: 0,
    ticketsSold: 0,
    platformFee: 0,
    processingFees: 0,
    netAmount: 0,
    availableToWithdraw: 0,
    withdrawnAmount: 0,
    settlementStatus: 'pending',
    settlementReadyDate: YESTERDAY,
    currency: country === 'HT' ? 'HTG' : 'USD',
  })
}

const earnings = () => store.get('event_earnings/earn_1')!

describe('addTicketToEarnings fee incidence', () => {
  it('credits a US organizer the full face value when the buyer paid the fee', async () => {
    seed('US')

    await addTicketToEarnings('evt_1', 4_000, 2, {
      currency: 'USD',
      paymentMethod: 'stripe',
      chargedAmountCents: 4_520, // face + grossed-up fee, charged to the buyer
      feeIncidence: 'buyer',
    })

    expect(earnings().grossSales).toBe(4_000)
    expect(earnings().ticketsSold).toBe(2)
    expect(earnings().platformFee).toBe(0)
    expect(earnings().processingFees).toBe(0)
    expect(earnings().netAmount).toBe(4_000)
    expect(earnings().availableToWithdraw).toBe(4_000)
  })

  it('still deducts fees when the organizer absorbs them', async () => {
    seed('HT')

    await addTicketToEarnings('evt_1', 100_000, 1, {
      currency: 'HTG',
      paymentMethod: 'moncash',
      feeIncidence: 'organizer',
    })

    expect(earnings().grossSales).toBe(100_000)
    expect(earnings().platformFee).toBe(10_000) // 10%
    expect(earnings().netAmount).toBe(90_000)
  })

  it('withholds funded promoter commission from the organizer net — both incidences', async () => {
    // Organizer-absorbs: net = gross − platform fee − commission.
    seed('HT')
    await addTicketToEarnings('evt_1', 100_000, 1, {
      currency: 'HTG',
      paymentMethod: 'moncash',
      feeIncidence: 'organizer',
      promoterCommissionCents: 10_000,
    })
    expect(earnings().netAmount).toBe(80_000) // 100k − 10k fee − 10k commission
    expect(earnings().availableToWithdraw).toBe(80_000)
    expect(earnings().promoterCommission).toBe(10_000)

    // Buyer-pays: the fee never touched the organizer, but the commission is a
    // share of the face value and still comes out of their net.
    seed('US')
    await addTicketToEarnings('evt_1', 4_000, 2, {
      currency: 'USD',
      paymentMethod: 'stripe',
      chargedAmountCents: 4_520,
      feeIncidence: 'buyer',
      promoterCommissionCents: 400,
    })
    expect(earnings().netAmount).toBe(3_600)
    expect(earnings().promoterCommission).toBe(400)
  })

  it('treats an absent incidence flag as organizer-paid, unchanged', async () => {
    // Callers that predate the flag (or rails with no buyer-pays pricing at
    // all — MonCash, SogePay) must keep their old arithmetic.
    seed('US')

    await addTicketToEarnings('evt_1', 2_000, 1, {
      currency: 'USD',
      paymentMethod: 'stripe',
      chargedAmountCents: 2_000,
    })

    expect(earnings().platformFee).toBeGreaterThan(0)
    expect(earnings().netAmount).toBeLessThan(2_000)
  })

  it('records the CAPPED fee checkout charged: 750 HTG per ticket, scaled by quantity', async () => {
    seed('HT')
    // Two 10,000 HTG tickets in one order: 10% would be 2,000 HTG; the cap is 2 × 750.
    await addTicketToEarnings('evt_1', 2_000_000, 2, {
      currency: 'HTG',
      paymentMethod: 'moncash',
      feeIncidence: 'organizer',
    })
    expect(earnings().platformFee).toBe(150_000)
    expect(earnings().netAmount).toBe(1_850_000)
  })
})
