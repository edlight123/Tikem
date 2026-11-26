/**
 * The receipt route's access rules and the monthly organizer statement.
 *
 * @jest-environment node
 */
let currentUser: any = null
jest.mock('@/lib/auth', () => ({ getCurrentUser: async () => currentUser }))
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

const loaded = {
  model: null as any,
  buyerIds: ['buyer1'],
  organizerId: 'org1',
}
jest.mock('@/lib/receipts/receipt-server', () => ({
  loadReceipt: async (id: string) => (id === 'pi_1' ? loaded : null),
}))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))
jest.mock('@/lib/admin/platform-settings', () => ({ getPlatformSettings: async () => ({}) }))

process.env.RECEIPT_LINK_SECRET = 'a-test-secret-long-enough'
import { buildReceipt, receiptPath } from '@/lib/receipts/receipt'
import { GET } from '@/app/receipts/[orderId]/route'
import { buildMonthlyStatement, monthRange, statementCsv, STATEMENT_LABELS } from '@/lib/statements/monthly'
import { DEFAULT_PLATFORM_SETTINGS } from '@/types/platform-settings'

loaded.model = buildReceipt({
  paymentId: 'pi_1',
  tickets: [{ id: 't1', tier_name: 'GA', charged_amount: 21, buyer_fee_charged_amount: 1, charged_currency: 'CAD', purchased_at: '2026-11-01T00:00:00Z' }],
  event: { title: 'Kompa Night', country: 'CA' },
  organizer: { name: 'Org' },
})

const get = (path: string) => GET(new Request(`https://tikra.example${path}`), { params: Promise.resolve({ orderId: 'pi_1' }) })

describe('GET /receipts/[orderId]', () => {
  beforeEach(() => {
    currentUser = null
  })

  it('opens with the signed key, without signing in', async () => {
    const res = await get(receiptPath('pi_1', { signed: true }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(await res.text()).toContain(loaded.model.orderNumber)
  })

  it('opens for the signed-in buyer, and is a 404 for anyone else', async () => {
    currentUser = { id: 'buyer1', role: 'attendee' }
    expect((await get('/receipts/pi_1')).status).toBe(200)
    currentUser = { id: 'stranger', role: 'attendee' }
    expect((await get('/receipts/pi_1')).status).toBe(404)
    currentUser = null
    expect((await get('/receipts/pi_1?k=wrong')).status).toBe(404)
  })

})

describe('monthly statement', () => {

  it('Haiti: a MonCash order at the 10% rate, a completed withdrawal, HTG without decimals', () => {
    const s = buildMonthlyStatement({ id: 'org1', name: 'Kompa Events', charityNumber: null }, '2026-11', range, {
      events: [{ id: 'h1', data: { title: 'Kanaval', country: 'HT', currency: 'HTG' } }],
      ticketsByEvent: new Map([
        ['h1', [
          { id: 'm1', data: { payment_id: 'mc_1', status: 'valid', price_paid: 1000, payment_method: 'moncash', purchased_at: '2026-11-05T15:00:00Z' } },
          { id: 'm2', data: { payment_id: 'mc_1', status: 'valid', price_paid: 1000, payment_method: 'moncash', purchased_at: '2026-11-05T15:00:00Z' } },
          // Paid at the door: the organizer's own cash, never on a statement.
          { id: 'd1', data: { payment_id: 'door_1', status: 'valid', price_paid: 500, payment_method: 'pay_at_door', purchased_at: '2026-11-06T15:00:00Z' } },
          // Never completed: not a sale.
          { id: 'p1', data: { payment_id: 'mc_2', status: 'pending', price_paid: 1000, payment_method: 'moncash', purchased_at: '2026-11-07T15:00:00Z' } },
        ]],
      ]),
      releases: [],
      withdrawals: [
        { organizerId: 'org1', amount: 150000, currency: 'HTG', method: 'moncash', status: 'completed', completedAt: '2026-11-15T00:00:00Z' },
        { organizerId: 'org1', amount: 5000, currency: 'HTG', method: 'balance_offset', status: 'completed', completedAt: '2026-11-16T00:00:00Z' },
        { organizerId: 'org1', amount: 99900, currency: 'HTG', method: 'moncash', status: 'pending', createdAt: '2026-11-17T00:00:00Z' },
      ],
      platformSettings: settings,
    })
    expect(s.sales).toHaveLength(1)
    expect(s.sales[0]).toMatchObject({ tickets: 2, currency: 'HTG', grossMinor: 200000, feesMinor: 20000, netMinor: 180000 })
    expect(s.payouts.map((p) => [p.amountMinor, p.reference])).toEqual([[150000, 'moncash'], [5000, 'printed tickets']])
    const csv = statementCsv(s, STATEMENT_LABELS.ht)
    expect(csv).toContain('2000')
    expect(csv).not.toMatch(/2000\.00/)
  })
  const range = monthRange('2026-11', new Date('2026-11-25T00:00:00Z'))!
  const settings = { id: 'global', ...DEFAULT_PLATFORM_SETTINGS }

  it('rejects malformed and future months', () => {
    expect(monthRange('2026-13')).toBeNull()
    expect(monthRange('nope')).toBeNull()
    expect(monthRange('2027-01', new Date('2026-11-25T00:00:00Z'))).toBeNull()
    expect(range.start.toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-12-01T00:00:00.000Z')
  })

  it('totals sales, fees, refunds and payouts for the month only', () => {
    const s = buildMonthlyStatement({ id: 'org1', name: 'Kompa Events', charityNumber: null }, '2026-11', range, {
      events: [{ id: 'e1', data: { title: 'Kompa Night', country: 'CA', currency: 'CAD' } }],
      ticketsByEvent: new Map([
        ['e1', [
          // One order of two organizer-paid tickets in November.
          { id: 't1', data: { payment_id: 'pi_A', price_paid: 20, charged_amount: 20, charged_currency: 'CAD', purchased_at: '2026-11-03T10:00:00Z', payment_method: 'stripe_connect', fee_incidence: 'organizer' } },
          { id: 't2', data: { payment_id: 'pi_A', price_paid: 20, charged_amount: 20, charged_currency: 'CAD', purchased_at: '2026-11-03T10:00:00Z', payment_method: 'stripe_connect', fee_incidence: 'organizer', refund_amount: 20, refund_currency: 'CAD', refund_processed_at: '2026-11-10T00:00:00Z' } },
          // October sale, and a free ticket: not in the statement.
          { id: 't3', data: { payment_id: 'pi_B', price_paid: 20, purchased_at: '2026-10-30T10:00:00Z' } },
          { id: 't4', data: { payment_id: 'free_1', price_paid: 0, purchased_at: '2026-11-04T10:00:00Z' } },
        ]],
      ]),
      releases: [
        { organizerId: 'org1', amountMinor: 3000, currency: 'cad', status: 'paid', payoutId: 'po_1', createdAt: '2026-11-20T00:00:00Z' },
        { organizerId: 'org1', amountMinor: 999, currency: 'cad', status: 'failed', createdAt: '2026-11-21T00:00:00Z' },
        { organizerId: 'org1', amountMinor: 500, currency: 'cad', status: 'paid', createdAt: '2026-12-01T00:00:00Z' },
      ],
      platformSettings: settings,
    })
    expect(s.sales).toHaveLength(1)
    expect(s.sales[0]).toMatchObject({ orderNumber: 'TK-A', tickets: 2, currency: 'CAD', grossMinor: 4000 })
    expect(s.sales[0].feesMinor).toBeGreaterThan(0)
    expect(s.sales[0].netMinor).toBe(4000 - s.sales[0].feesMinor)
    expect(s.refunds).toEqual([expect.objectContaining({ amountMinor: 2000, currency: 'CAD' })])
    expect(s.payouts).toEqual([expect.objectContaining({ amountMinor: 3000, currency: 'CAD', reference: 'po_1' })])
    expect(s.totals).toEqual([
      expect.objectContaining({ currency: 'CAD', grossMinor: 4000, refundsMinor: 2000, payoutsMinor: 3000, ticketsSold: 2 }),
    ])

    const csv = statementCsv(s, STATEMENT_LABELS.en)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('Kompa Events')
    expect(csv).toContain('Sale,2026-11-03,Kompa Night,TK-A,2,CAD,40.00,4.38')
    expect(csv).toContain('Payout,2026-11-20')
  })

  it('neutralizes spreadsheet formulas in event titles', () => {
    const s = buildMonthlyStatement({ id: 'o', name: '=HYPERLINK("x")' }, '2026-11', range, {
      events: [], ticketsByEvent: new Map(), releases: [], platformSettings: settings,
    })
    expect(statementCsv(s, STATEMENT_LABELS.en)).toContain(`"'=HYPERLINK(""x"")"`)
  })
})
