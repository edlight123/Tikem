/**
 * Promoter attribution: code normalization, commission math for both types,
 * the HMAC stats token, and the exactly-once sale ledger.
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
    path: `${name}/${id}`,
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

  const matches = (data: Doc, [field, op, value]: [string, string, any]) => {
    if (op === '==') return data[field] === value
    if (op === 'array-contains') return Array.isArray(data[field]) && data[field].includes(value)
    return true
  }

  const makeQuery = (name: string, filters: Array<[string, string, any]>) => ({
    where: (field: string, op: string, value: any) =>
      makeQuery(name, [...filters, [field, op, value]]),
    orderBy: () => makeQuery(name, filters),
    limit: () => makeQuery(name, filters),
    get: async () => {
      const rows = collectionDocs(name).filter(({ data }) => filters.every((f) => matches(data, f)))
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

  let autoId = 0
  const collection = (name: string) => ({
    ...makeQuery(name, []),
    doc: (id?: string) => docRef(name, id || `auto_${++autoId}`),
  })

  const runTransaction = async (fn: (tx: any) => Promise<any>) => {
    const tx = {
      get: (ref: any) => ref.get(),
      set: (ref: any, data: Doc) => {
        store.set(ref.path, { ...(store.get(ref.path) || {}), ...data })
      },
      update: (ref: any, data: Doc) => {
        store.set(ref.path, { ...(store.get(ref.path) || {}), ...data })
      },
    }
    return await fn(tx)
  }

  return { adminDb: { collection, runTransaction } }
})

import {
  remainingAfterReversal,
  normalizePromoterCode,
  calculateCommissionCents,
  promoterTokenFor,
  verifyPromoterToken,
  mintPromoterStatsKey,
  resolvePromoterCode,
  recordPromoterSale,
  reversePromoterSaleForTicket,
  getFundedCommissionForEvent,
  excludeStripeConnectSales,
  maxTierPriceCentsForEvent,
} from '@/lib/promoters'

function seedPromoter(overrides: Doc = {}) {
  store.clear()
  store.set('event_promoters/prm_1', {
    event_id: 'evt_1',
    organizer_id: 'org_1',
    code: 'STEEVE',
    name: 'Steeve L.',
    commission_type: 'percentage',
    commission_value: 10,
    is_active: true,
    stats_key: 'a'.repeat(48),
    tickets_sold: 0,
    orders_count: 0,
    gross_cents: 0,
    commission_cents: 0,
    currency: 'HTG',
    ...overrides,
  })
}

describe('normalizePromoterCode', () => {
  it('uppercases and accepts the link-safe alphabet', () => {
    expect(normalizePromoterCode(' steeve ')).toBe('STEEVE')
    expect(normalizePromoterCode('ti-jo_2')).toBe('TI-JO_2')
  })
  it('rejects junk without throwing', () => {
    expect(normalizePromoterCode('')).toBeNull()
    expect(normalizePromoterCode('a')).toBeNull() // too short
    expect(normalizePromoterCode('has space')).toBeNull()
    expect(normalizePromoterCode('x'.repeat(25))).toBeNull()
    expect(normalizePromoterCode(null)).toBeNull()
  })
})

describe('calculateCommissionCents', () => {
  const pct = { commission_type: 'percentage', commission_value: 10 }
  const flat = { commission_type: 'flat_per_ticket', commission_value: 250 }

  it('percentage of the order gross', () => {
    expect(calculateCommissionCents(pct, 100_000, 2)).toBe(10_000)
  })
  it('flat amount per ticket', () => {
    expect(calculateCommissionCents(flat, 100_000, 3)).toBe(750)
  })
  it('free orders earn zero under both types', () => {
    expect(calculateCommissionCents(pct, 0, 2)).toBe(0)
    expect(calculateCommissionCents(flat, 0, 2)).toBe(0)
  })
  it('never exceeds the order gross', () => {
    expect(calculateCommissionCents({ commission_type: 'flat_per_ticket', commission_value: 5_000 }, 4_000, 1)).toBe(4_000)
    expect(calculateCommissionCents({ commission_type: 'percentage', commission_value: 500 }, 4_000, 1)).toBe(4_000)
  })
  it('rejects non-positive or non-finite values', () => {
    expect(calculateCommissionCents({ commission_type: 'percentage', commission_value: -5 }, 4_000, 1)).toBe(0)
    expect(calculateCommissionCents({ commission_type: 'percentage', commission_value: NaN }, 4_000, 1)).toBe(0)
  })
})

describe('promoter stats token', () => {
  it('round-trips', () => {
    const key = mintPromoterStatsKey()
    expect(key).toMatch(/^[a-f0-9]{48}$/)
    expect(verifyPromoterToken(promoterTokenFor(key))).toBe(key)
  })
  it('rejects tampering and malformed tokens identically', () => {
    const token = promoterTokenFor(mintPromoterStatsKey())
    expect(verifyPromoterToken(token.slice(0, -1) + (token.endsWith('x') ? 'y' : 'x'))).toBeNull()
    expect(verifyPromoterToken('nonsense')).toBeNull()
    expect(verifyPromoterToken('')).toBeNull()
    expect(verifyPromoterToken(`${'b'.repeat(48)}.forged-signature-here`)).toBeNull()
  })
})

describe('resolvePromoterCode', () => {
  it('resolves an active code, case-insensitively', async () => {
    seedPromoter()
    const p = await resolvePromoterCode('evt_1', 'steeve')
    expect(p?.id).toBe('prm_1')
  })
  it('resolves by doc id but only for the right event', async () => {
    seedPromoter()
    expect((await resolvePromoterCode('evt_1', 'prm_1'))?.id).toBe('prm_1')
    expect(await resolvePromoterCode('evt_OTHER', 'prm_1')).toBeNull()
  })
  it('refuses inactive and unknown codes alike', async () => {
    seedPromoter({ is_active: false })
    expect(await resolvePromoterCode('evt_1', 'STEEVE')).toBeNull()
    expect(await resolvePromoterCode('evt_1', 'NOBODY')).toBeNull()
  })
})

describe('recordPromoterSale / reversal', () => {
  it('appends a ledger row and bumps counters', async () => {
    seedPromoter()
    const result = await recordPromoterSale({
      promoterId: 'prm_1',
      eventId: 'evt_1',
      ticketIds: ['tkt_1', 'tkt_2'],
      quantity: 2,
      orderGrossCents: 100_000,
      currency: 'HTG',
      paymentMethod: 'moncash',
      paymentId: 'MC_1',
      buyerEmail: 'Buyer@Example.com',
    })

    expect(result.recorded).toBe(true)
    expect(result.commissionCents).toBe(10_000)

    const promoter = store.get('event_promoters/prm_1')!
    expect(promoter.tickets_sold).toBe(2)
    expect(promoter.orders_count).toBe(1)
    expect(promoter.gross_cents).toBe(100_000)
    expect(promoter.commission_cents).toBe(10_000)

    const sales = collectionDocs('promoter_sales')
    expect(sales).toHaveLength(1)
    expect(sales[0].data.status).toBe('accrued')
    expect(sales[0].data.buyer_key).toBe('email:buyer@example.com')
    expect(sales[0].data.commission_type).toBe('percentage')
  })

  it('never throws for a missing promoter — the sale is kept', async () => {
    seedPromoter()
    const result = await recordPromoterSale({
      promoterId: 'prm_GONE',
      eventId: 'evt_1',
      ticketIds: ['tkt_1'],
      quantity: 1,
      orderGrossCents: 5_000,
      currency: 'HTG',
      paymentMethod: 'moncash',
    })
    expect(result.recorded).toBe(false)
    expect(collectionDocs('promoter_sales')).toHaveLength(0)
  })

  it('reverses an accrued order ticket by ticket, each ticket exactly once', async () => {
    seedPromoter()
    await recordPromoterSale({
      promoterId: 'prm_1',
      eventId: 'evt_1',
      ticketIds: ['tkt_1', 'tkt_2'],
      quantity: 2,
      orderGrossCents: 100_000,
      currency: 'HTG',
      paymentMethod: 'moncash',
    })
    const accrued = Number(store.get('event_promoters/prm_1')!.commission_cents)
    expect(accrued).toBeGreaterThan(0)

    // First ticket: half the order comes back, the row stays accrued.
    expect(await reversePromoterSaleForTicket('tkt_2')).toBe(true)
    let promoter = store.get('event_promoters/prm_1')!
    expect(promoter.tickets_sold).toBe(1)
    expect(promoter.orders_count).toBe(1)
    expect(promoter.commission_cents).toBe(accrued - Math.round(accrued / 2))
    let sale = collectionDocs('promoter_sales')[0].data
    expect(sale.status).toBe('accrued')
    expect(sale.reversed_ticket_ids).toEqual(['tkt_2'])

    // The same ticket again is a no-op.
    expect(await reversePromoterSaleForTicket('tkt_2')).toBe(false)
    expect(store.get('event_promoters/prm_1')!.commission_cents).toBe(accrued - Math.round(accrued / 2))

    // Last ticket: the remainder, the row is reversed, counters at zero.
    expect(await reversePromoterSaleForTicket('tkt_1')).toBe(true)
    promoter = store.get('event_promoters/prm_1')!
    expect(promoter.tickets_sold).toBe(0)
    expect(promoter.orders_count).toBe(0)
    expect(promoter.commission_cents).toBe(0)
    expect(promoter.gross_cents).toBe(0)
    sale = collectionDocs('promoter_sales')[0].data
    expect(sale.status).toBe('reversed')
    expect(sale.commission_cents).toBe(accrued) // fully reversed rows keep the original figures
    expect(sale.reversed_commission_cents).toBe(accrued)

    // Nothing left to reverse.
    expect(await reversePromoterSaleForTicket('tkt_1')).toBe(false)
  })

  it('reverses only one ticket’s share of a 4-ticket order, with no rounding drift', async () => {
    // 10% of 100_007 = 10_001 cents: neither commission nor gross divides by 4.
    seedPromoter()
    await recordPromoterSale({
      promoterId: 'prm_1',
      eventId: 'evt_1',
      ticketIds: ['a', 'b', 'c', 'd'],
      quantity: 4,
      orderGrossCents: 100_007,
      currency: 'HTG',
      paymentMethod: 'moncash',
    })
    const sale0 = collectionDocs('promoter_sales')[0].data
    const total = Number(sale0.commission_cents)
    const gross = Number(sale0.order_gross_cents)
    expect(total).toBeGreaterThan(0)
    expect(total % 4).not.toBe(0) // the case under test: shares are not equal
    expect(gross % 4).not.toBe(0)

    expect(await reversePromoterSaleForTicket('b')).toBe(true)
    let promoter = store.get('event_promoters/prm_1')!
    expect(promoter.tickets_sold).toBe(3)
    expect(promoter.commission_cents).toBe(total - Math.round(total / 4))
    expect(collectionDocs('promoter_sales')[0].data.commission_cents).toBe(total - Math.round(total / 4))

    const reversedSoFar: number[] = [total - Number(promoter.commission_cents)]
    for (const t of ['d', 'a', 'c']) {
      const before = Number(store.get('event_promoters/prm_1')!.commission_cents)
      expect(await reversePromoterSaleForTicket(t)).toBe(true)
      reversedSoFar.push(before - Number(store.get('event_promoters/prm_1')!.commission_cents))
    }
    // Shares sum exactly to the original commission and gross.
    expect(reversedSoFar.reduce((a, b) => a + b, 0)).toBe(total)
    promoter = store.get('event_promoters/prm_1')!
    expect(promoter.commission_cents).toBe(0)
    expect(promoter.gross_cents).toBe(0)
    expect(promoter.tickets_sold).toBe(0)
    expect(collectionDocs('promoter_sales')[0].data).toMatchObject({
      status: 'reversed',
      commission_cents: total,
      order_gross_cents: gross,
      quantity: 4,
    })
  })

  it('writes funded:true by default and funded:false atomically when asked', async () => {
    seedPromoter()
    await recordPromoterSale({
      promoterId: 'prm_1',
      eventId: 'evt_1',
      ticketIds: ['f1'],
      quantity: 1,
      orderGrossCents: 10_000,
      currency: 'HTG',
      paymentMethod: 'stripe',
    })
    await recordPromoterSale({
      promoterId: 'prm_1',
      eventId: 'evt_1',
      ticketIds: ['f2'],
      quantity: 1,
      orderGrossCents: 10_000,
      currency: 'HTG',
      paymentMethod: 'stripe_connect',
      funded: false,
      unfundedReason: 'destination_charge',
    })
    const rows = collectionDocs('promoter_sales').map((d: any) => d.data)
    const byTicket = (t: string) => rows.find((r: any) => r.ticket_ids[0] === t)
    expect(byTicket('f1')).toMatchObject({ funded: true })
    expect(byTicket('f1').unfunded_reason).toBeUndefined()
    expect(byTicket('f2')).toMatchObject({ funded: false, unfunded_reason: 'destination_charge' })
  })

  it('ignores a ticket that is not on any accrued order', async () => {
    seedPromoter()
    expect(await reversePromoterSaleForTicket('nope')).toBe(false)
  })
})

describe('commission ceiling: gross minus platform fee', () => {
  const flat = { commission_type: 'flat_per_ticket' as const, commission_value: 5_000 }
  const pct = { commission_type: 'percentage' as const, commission_value: 100 }

  it('caps a flat fee at the gross minus the platform fee, not the gross', () => {
    // 4,000 gross, 400 fee: the organizer's net is 3,600 and that is the most a promoter can take.
    expect(calculateCommissionCents(flat, 4_000, 1, 400)).toBe(3_600)
    expect(calculateCommissionCents(pct, 4_000, 1, 400)).toBe(3_600)
  })

  it('earns nothing when the fee eats the whole order', () => {
    expect(calculateCommissionCents(flat, 400, 1, 400)).toBe(0)
  })

  it('recordPromoterSale applies the event fee rule when the caller does not pass one', async () => {
    seedPromoter({ commission_type: 'flat_per_ticket', commission_value: 50_000 })
    const result = await recordPromoterSale({
      promoterId: 'prm_1',
      eventId: 'evt_1',
      ticketIds: ['tkt_1'],
      quantity: 1,
      orderGrossCents: 10_000,
      currency: 'HTG',
      paymentMethod: 'moncash',
    })
    expect(result.recorded).toBe(true)
    // Default 10% fee on 10,000 → ceiling 9,000.
    expect(result.commissionCents).toBe(9_000)
  })

  it('honours an explicit platformFeeCents', async () => {
    seedPromoter({ commission_type: 'flat_per_ticket', commission_value: 50_000 })
    const result = await recordPromoterSale({
      promoterId: 'prm_1',
      eventId: 'evt_1',
      ticketIds: ['tkt_1'],
      quantity: 1,
      orderGrossCents: 10_000,
      currency: 'HTG',
      paymentMethod: 'moncash',
      platformFeeCents: 2_500,
    })
    expect(result.commissionCents).toBe(7_500)
  })
})

describe('getFundedCommissionForEvent', () => {
  it('sums funded accrued rows and skips Stripe Connect sales', async () => {
    store.clear()
    store.set('promoter_sales/s1', { event_id: 'evt_1', funded: true, status: 'accrued', commission_cents: 1_000, payment_method: 'moncash' })
    store.set('promoter_sales/s2', { event_id: 'evt_1', funded: true, status: 'accrued', commission_cents: 2_000, payment_method: 'stripe_connect' })
    store.set('promoter_sales/s3', { event_id: 'evt_1', funded: true, status: 'accrued', commission_cents: 4_000, payment_method: 'stripe', ticket_ids: ['t_conn'] })
    store.set('tickets/t_conn', { payment_method: 'stripe_connect' })
    store.set('promoter_sales/s4', { event_id: 'evt_1', funded: true, status: 'accrued', commission_cents: 8_000, payment_method: 'stripe', ticket_ids: ['t_plat'] })
    store.set('tickets/t_plat', { payment_method: 'stripe' })
    store.set('promoter_sales/s5', { event_id: 'evt_1', funded: false, status: 'accrued', commission_cents: 16_000, payment_method: 'stripe_connect' })
    store.set('promoter_sales/s6', { event_id: 'evt_1', funded: true, status: 'reversed', commission_cents: 32_000, payment_method: 'moncash' })
    expect(await getFundedCommissionForEvent('evt_1')).toBe(9_000)
  })

  it('throws when the ledger is unreachable instead of reporting 0', async () => {
    const admin = jest.requireMock('@/lib/firebase/admin') as any
    const original = admin.adminDb.collection
    admin.adminDb.collection = () => ({
      where: () => ({ where: () => ({ get: async () => { throw new Error('UNAVAILABLE') } }) }),
    })
    try {
      await expect(getFundedCommissionForEvent('evt_1')).rejects.toThrow('UNAVAILABLE')
    } finally {
      admin.adminDb.collection = original
    }
  })
})

describe('excludeStripeConnectSales', () => {
  it('keeps non-Stripe rails without any ticket read', async () => {
    store.clear()
    const rows = [{ payment_method: 'moncash' }, { payment_method: 'free' }]
    expect(await excludeStripeConnectSales(rows)).toEqual(rows)
  })
})

describe('maxTierPriceCentsForEvent', () => {
  it('reads the priciest tier in cents', async () => {
    store.clear()
    store.set('ticket_tiers/a', { event_id: 'evt_1', price: 25 })
    store.set('ticket_tiers/b', { event_id: 'evt_1', price: 100 })
    store.set('ticket_tiers/c', { event_id: 'evt_2', price: 999 })
    expect(await maxTierPriceCentsForEvent('evt_1')).toBe(10_000)
  })
  it('falls back to embedded tiers and returns null when nothing is priced', async () => {
    store.clear()
    expect(await maxTierPriceCentsForEvent('evt_1', { ticket_tiers: [{ price: 40 }] })).toBe(4_000)
    expect(await maxTierPriceCentsForEvent('evt_1', {})).toBeNull()
  })
})

describe('remainingAfterReversal', () => {
  it('rounds cumulatively so the last share takes the exact remainder', () => {
    expect(remainingAfterReversal(10_001, 0, 4)).toBe(10_001)
    expect(remainingAfterReversal(10_001, 1, 4)).toBe(10_001 - 2_500)
    expect(remainingAfterReversal(10_001, 2, 4)).toBe(10_001 - 5_001)
    expect(remainingAfterReversal(10_001, 3, 4)).toBe(10_001 - 7_501)
    expect(remainingAfterReversal(10_001, 4, 4)).toBe(0)
    expect(remainingAfterReversal(10_001, 9, 4)).toBe(0)
    expect(remainingAfterReversal(7, 1, 1)).toBe(0)
  })
})
