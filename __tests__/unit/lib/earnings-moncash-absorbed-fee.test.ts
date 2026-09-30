/**
 * MonCash keeps 2% of every collection (a 25 HTG sale lands as 24.50). The
 * platform fee is all-in for organizers, so that 2% is Tikèm's cost: it is
 * recorded as absorbedProcessingFees and must never reduce the organizer's net.
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
    haiti: { platformFeePercentage: 0.1, settlementHoldDays: 0 },
    usCanada: { platformFeePercentage: 0.1, settlementHoldDays: 0 },
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

describe('MonCash collection fee is recorded as Tikèm cost', () => {
  it('records 0.50 HTG absorbed on the 25 HTG sale and leaves the organizer net at 22.50', async () => {
    seed('HT')

    await addTicketToEarnings('evt_1', 2_500, 1, {
      currency: 'HTG',
      paymentMethod: 'moncash_button',
      chargedAmountCents: 2_500,
    })

    expect(earnings().platformFee).toBe(250)
    expect(earnings().absorbedProcessingFees).toBe(50)
    expect(earnings().processingFees).toBe(0)
    expect(earnings().netAmount).toBe(2_250)
    expect(earnings().availableToWithdraw).toBe(2_250)
  })

  it('converts the HTG fee back to event currency for a USD event paid via MonCash', async () => {
    seed('US')

    // $10 event charged as 1,300 HTG at fx 130 HTG/USD -> 26 HTG fee -> $0.20.
    await addTicketToEarnings('evt_1', 1_000, 1, {
      currency: 'USD',
      paymentMethod: 'moncash',
      chargedAmountCents: 130_000,
      fxRate: 130,
    })

    expect(earnings().absorbedProcessingFees).toBe(20)
    expect(earnings().netAmount).toBe(900)
  })

  it('records nothing for card sales', async () => {
    seed('US')

    await addTicketToEarnings('evt_1', 4_000, 1, { currency: 'USD', paymentMethod: 'stripe', feeIncidence: 'buyer' })

    expect(earnings().absorbedProcessingFees).toBe(0)
  })
})
