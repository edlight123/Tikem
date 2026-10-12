/**
 * @jest-environment node
 *
 * `exchange_rate_used` is USD-per-HTG on a card sale of an HTG event but
 * HTG-per-USD (spread included) on a MonCash sale of a USD event. Top
 * organizers / top events / the revenue trend used to read it as one number
 * defaulted to 1: a 5,000 HTG MonCash ticket counted as $5,000 and a $50
 * MonCash ticket showed as 0.36 HTG. Every roll-up now goes through
 * ticketRevenueAmounts.
 */

let tickets: Array<Record<string, any>> = []

jest.mock('@/lib/firebase/admin', () => {
  const query: any = {
    where: () => query,
    get: async () => ({ docs: tickets.map((t, i) => ({ id: `t${i}`, data: () => t })) }),
  }
  return { adminDb: { collection: () => query } }
})

import {
  ticketRevenueAmounts,
  getCompletePlatformMetrics,
  getRevenueByPeriod,
  getPlatformRevenueAnalytics,
} from '@/lib/admin/revenue-analytics'

const when = { toDate: () => new Date('2026-10-01T12:00:00Z') }

const cardUsd = {
  price_paid: 50, currency: 'USD', charged_currency: 'USD', payment_method: 'stripe',
  organizer_id: 'orgA', event_id: 'evA', created_at: when,
}
// HTG event bought by card: charged 38 USD, rate = USD per HTG.
const cardHtg = {
  price_paid: 5000, currency: 'HTG', charged_currency: 'USD', charged_amount: 38,
  exchange_rate_used: 0.0076, payment_method: 'stripe',
  organizer_id: 'orgB', event_id: 'evB', created_at: when,
}
// HTG event paid with MonCash: no conversion, no rate recorded.
const moncashHtg = {
  price_paid: 5000, currency: 'HTG', charged_currency: 'HTG', payment_method: 'moncash',
  organizer_id: 'orgC', event_id: 'evC', created_at: when,
}
// USD event paid with MonCash in HTG: rate = HTG per USD (with spread).
const moncashUsd = {
  price_paid: 50, currency: 'USD', charged_currency: 'HTG', charged_amount: 6900,
  exchange_rate_used: 138, exchange_rate_base: 132, payment_method: 'moncash_button',
  organizer_id: 'orgD', event_id: 'evD', created_at: when,
}

describe('ticketRevenueAmounts', () => {
  it('card USD sale is its own USD price, no HTG leg', () => {
    expect(ticketRevenueAmounts(cardUsd)).toEqual({ priceUSD: 50, priceHTG: 0, htgToUsdRate: null })
  })

  it('card HTG sale uses the USD actually charged', () => {
    const r = ticketRevenueAmounts(cardHtg)
    expect(r.priceUSD).toBe(38)
    expect(r.priceHTG).toBe(5000)
    expect(r.htgToUsdRate).toBe(0.0076)
  })

  it('card HTG sale without charged_amount converts with the USD-per-HTG rate', () => {
    const r = ticketRevenueAmounts({ ...cardHtg, charged_amount: undefined })
    expect(r.priceUSD).toBeCloseTo(38, 6)
  })

  it('MonCash HTG sale with no rate never counts HTG as dollars', () => {
    const r = ticketRevenueAmounts(moncashHtg)
    expect(r.priceHTG).toBe(5000)
    expect(r.priceUSD).toBeCloseTo(38, 6) // legacy 0.0076 fallback, not 5000
    expect(r.htgToUsdRate).toBeNull()
  })

  it('MonCash USD-converted sale keeps USD face and the HTG collected', () => {
    const r = ticketRevenueAmounts(moncashUsd)
    expect(r.priceUSD).toBe(50)
    expect(r.priceHTG).toBe(6900)
    expect(r.htgToUsdRate).toBeCloseTo(1 / 138, 10)
  })

  it('MonCash USD-converted sale without charged_amount multiplies by HTG-per-USD', () => {
    const r = ticketRevenueAmounts({ ...moncashUsd, charged_amount: undefined })
    expect(r.priceHTG).toBe(50 * 138)
  })
})

describe('admin roll-ups agree with the per-ticket conversion', () => {
  beforeEach(() => {
    tickets = [cardUsd, cardHtg, moncashHtg, moncashUsd]
  })

  it('top organizers and top events are in real USD', async () => {
    const metrics = await getCompletePlatformMetrics()
    const org = Object.fromEntries(metrics.topOrganizers.map((o) => [o.organizerId, o.revenueUSD]))
    expect(org.orgA).toBe(50)
    expect(org.orgB).toBe(38)
    expect(org.orgC).toBeCloseTo(38, 6)
    expect(org.orgD).toBe(50)
    const ev = Object.fromEntries(metrics.topEvents.map((e) => [e.eventId, e.revenueUSD]))
    expect(ev.evC).toBeCloseTo(38, 6)
    expect(ev.evD).toBe(50)
  })

  it('revenue trend totals match getPlatformRevenueAnalytics', async () => {
    const [point] = await getRevenueByPeriod('daily', new Date('2026-09-01'), new Date('2026-11-01'))
    const totals = await getPlatformRevenueAnalytics()
    expect(point.tickets).toBe(4)
    expect(point.revenueUSD).toBeCloseTo(totals.totalRevenueUSD, 6)
    expect(point.revenueHTG).toBeCloseTo(totals.totalRevenueHTG, 6)
    // 5000 (card HTG) + 5000 (MonCash HTG) + 6900 (MonCash USD) — never 0.36 HTG.
    expect(point.revenueHTG).toBeCloseTo(16900, 6)
    expect(point.revenueUSD).toBeCloseTo(50 + 38 + 38 + 50, 6)
  })
})
