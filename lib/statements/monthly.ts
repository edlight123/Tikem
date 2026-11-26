/**
 * Monthly organizer statements: sales, fees, refunds and payouts for one
 * calendar month (UTC), per currency. Downloadable as CSV and PDF from the
 * organizer dashboard (app/organizer/statements).
 *
 * Money is priced by the same rules as the payout engine
 * (lib/payouts/availability computeEventAvailability): each ticket's face from
 * ticketPriceMinor (add-ons included, pay-at-door excluded), the event's fee
 * rule from feeRuleForEvent, and the fee per order (one payment) through
 * platformFeeForSale, zero when the buyer paid it. So a statement agrees with
 * the balance the organizer is paid from, on every rail (card, Haiti card,
 * MonCash, SogePay, Stripe Connect).
 *
 * Sales: paid tickets bought in the month (live or later refunded), grouped by order.
 * Refunds: tickets whose refund was processed in the month (face refunded).
 * Payouts: Stripe payout releases created in the month (not failed or
 * cancelled) and withdrawals completed in the month (MonCash, bank, and
 * printed tickets paid from the balance).
 */
import { adminDb } from '@/lib/firebase/admin'
import { getPlatformSettings } from '@/lib/admin/platform-settings'
import { defaultCurrencyForCountry } from '@/lib/country-support'
import { ticketFeeIncidence } from '@/lib/payouts/fee-incidence'
import { orderNumber } from '@/lib/receipts/receipt'
import { platformFeeForSale } from '@/lib/fees'
import { feeRuleForEvent } from '@/lib/payouts/availability-server'
import {
  isRefundedTicket,
  normalizeCurrencyCode,
  ticketPriceMinor,
  ticketPurchasedAt,
  ticketRefundedFaceMinor,
} from '@/lib/payouts/availability'
import { isLiveTicketStatus } from '@/lib/tickets/status'

export interface StatementSaleRow {
  date: string
  eventId: string
  eventTitle: string
  orderNumber: string
  tickets: number
  currency: string
  /** Face value, minor units, event currency. */
  grossMinor: number
  /** Tikèm fees deducted from the organizer (organizer-paid incidence). */
  feesMinor: number
  /** Service fees the buyer paid on top (not the organizer's money; for information). */
  buyerFeesMinor: number
  netMinor: number
}

export interface StatementRefundRow {
  date: string
  eventId: string
  eventTitle: string
  orderNumber: string
  currency: string
  amountMinor: number
}

export interface StatementPayoutRow {
  date: string
  currency: string
  amountMinor: number
  status: string
  reference: string
}

export interface StatementTotals {
  currency: string
  grossMinor: number
  feesMinor: number
  buyerFeesMinor: number
  netSalesMinor: number
  refundsMinor: number
  payoutsMinor: number
  ticketsSold: number
}

export interface MonthlyStatement {
  orgId: string
  orgName: string
  charityNumber: string | null
  month: string
  periodStart: string
  periodEnd: string
  sales: StatementSaleRow[]
  refunds: StatementRefundRow[]
  payouts: StatementPayoutRow[]
  totals: StatementTotals[]
}

/** "2026-11" → [start, end) in UTC; null when malformed or in the future. */
export function monthRange(month: string, now = new Date()): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''))
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  if (mo < 1 || mo > 12 || y < 2020) return null
  const start = new Date(Date.UTC(y, mo - 1, 1))
  const end = new Date(Date.UTC(y, mo, 1))
  if (start.getTime() > now.getTime()) return null
  return { start, end }
}

function ms(value: any): number | null {
  if (!value) return null
  if (typeof value === 'number') return value
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  if (typeof value?._seconds === 'number') return value._seconds * 1000
  const t = Date.parse(String(value))
  return Number.isFinite(t) ? t : null
}

const minor = (v: unknown) => Math.round((Number(v) || 0) * 100)
const NON_PAYOUT = new Set(['failed', 'canceled', 'cancelled', 'reserved'])

export interface StatementData {
  events: Array<{ id: string; data: Record<string, any> }>
  ticketsByEvent: Map<string, Array<{ id: string; data: Record<string, any> }>>
  releases: Array<Record<string, any>>
  /** withdrawal_requests of this org (MonCash, bank, printed-ticket balance offsets). */
  withdrawals?: Array<Record<string, any>>
  platformSettings: any
}

/** Pure: build the statement from already-loaded data. */
export function buildMonthlyStatement(
  org: { id: string; name: string; charityNumber?: string | null },
  month: string,
  range: { start: Date; end: Date },
  data: StatementData
): MonthlyStatement {
  const inMonth = (t: number | null) => t != null && t >= range.start.getTime() && t < range.end.getTime()
  const sales: StatementSaleRow[] = []
  const refunds: StatementRefundRow[] = []

  for (const ev of data.events) {
    const e = ev.data
    const currency = normalizeCurrencyCode(e.currency || defaultCurrencyForCountry(String(e.country || 'HT')))
    const rule = feeRuleForEvent(e, data.platformSettings)
    const title = String(e.title || 'Event')
    const tickets = data.ticketsByEvent.get(ev.id) || []

    // Sales, grouped by order (one payment), as the payout engine groups them.
    const orders = new Map<string, Array<Record<string, any>>>()
    for (const t of tickets) {
      const d: Record<string, any> = { id: t.id, ...t.data }
      if (!(ticketPriceMinor(d) > 0) || !d.payment_id) continue
      if (!isLiveTicketStatus(d.status) && !isRefundedTicket(d)) continue
      if (!inMonth(ticketPurchasedAt(d)?.getTime() ?? null)) continue
      const list = orders.get(String(d.payment_id)) || []
      list.push(d)
      orders.set(String(d.payment_id), list)
    }
    for (const [paymentId, list] of Array.from(orders.entries())) {
      const gross = list.reduce((sum, d) => sum + ticketPriceMinor(d), 0)
      const incidence = list.every((d) => ticketFeeIncidence(d) === 'buyer') ? 'buyer' : 'organizer'
      const bought =
        list
          .map((d) => ticketPurchasedAt(d))
          .filter((x): x is Date => !!x)
          .sort((x, y) => x.getTime() - y.getTime())[0] || null
      const fee =
        incidence === 'buyer'
          ? 0
          : platformFeeForSale(gross, rule.platformFeePercentage, {
              legacyCapMinorPerTicket: rule.legacyCapMinorPerTicket ?? null,
              quantity: list.length,
              purchasedAt: bought,
              fixedFeeMinorPerTicket: rule.fixedFeeMinorPerTicket ?? 0,
            })
      const sameCurrency = list.every((d) => normalizeCurrencyCode(d.charged_currency || currency) === currency)
      const buyerFees = sameCurrency ? list.reduce((sum, d) => sum + minor(d.buyer_fee_charged_amount), 0) : 0
      sales.push({
        date: (bought || range.start).toISOString(),
        eventId: ev.id,
        eventTitle: title,
        orderNumber: orderNumber(paymentId),
        tickets: list.length,
        currency,
        grossMinor: gross,
        feesMinor: fee,
        buyerFeesMinor: buyerFees,
        netMinor: gross - fee,
      })
    }

    // Refunds processed this month.
    for (const t of tickets) {
      const d = t.data
      const at = ms(d.refund_processed_at)
      const refundedMinor = ticketRefundedFaceMinor({ id: t.id, ...d }, currency)
      if (!inMonth(at) || !(refundedMinor > 0)) continue
      refunds.push({
        date: new Date(at as number).toISOString(),
        eventId: ev.id,
        eventTitle: title,
        orderNumber: orderNumber(String(d.payment_id || t.id)),
        currency,
        amountMinor: refundedMinor,
      })
    }
  }

  const payouts: StatementPayoutRow[] = data.releases
    .filter((r) => inMonth(ms(r.createdAt || r.created_at)) && !NON_PAYOUT.has(String(r.status || '').toLowerCase()))
    .map((r) => ({
      date: new Date(ms(r.createdAt || r.created_at) as number).toISOString(),
      currency: String(r.currency || 'CAD').toUpperCase(),
      amountMinor: Math.max(0, Math.round(Number(r.amountMinor) || 0)),
      status: String(r.status || ''),
      reference: String(r.payoutId || ''),
    }))
  // Withdrawals paid out this month (withdrawal_requests, amount in minor units).
  for (const w of data.withdrawals || []) {
    if (String(w.status || '').toLowerCase() !== 'completed') continue
    const at = ms(w.completedAt || w.completed_at || w.processedAt || w.updatedAt || w.createdAt)
    if (!inMonth(at)) continue
    const method = String(w.method || '').toLowerCase()
    payouts.push({
      date: new Date(at as number).toISOString(),
      currency: normalizeCurrencyCode(w.currency || 'HTG'),
      amountMinor: Math.max(0, Math.round(Number(w.amount) || 0)),
      status: 'completed',
      reference: method === 'balance_offset' ? 'printed tickets' : method === 'bank' ? 'bank' : 'moncash',
    })
  }

  sales.sort((a, b) => a.date.localeCompare(b.date))
  refunds.sort((a, b) => a.date.localeCompare(b.date))
  payouts.sort((a, b) => a.date.localeCompare(b.date))

  const totalsBy = new Map<string, StatementTotals>()
  const tot = (c: string) => {
    if (!totalsBy.has(c)) {
      totalsBy.set(c, { currency: c, grossMinor: 0, feesMinor: 0, buyerFeesMinor: 0, netSalesMinor: 0, refundsMinor: 0, payoutsMinor: 0, ticketsSold: 0 })
    }
    return totalsBy.get(c) as StatementTotals
  }
  for (const s of sales) {
    const t = tot(s.currency)
    t.grossMinor += s.grossMinor
    t.feesMinor += s.feesMinor
    t.buyerFeesMinor += s.buyerFeesMinor
    t.netSalesMinor += s.netMinor
    t.ticketsSold += s.tickets
  }
  for (const r of refunds) tot(r.currency).refundsMinor += r.amountMinor
  for (const p of payouts) tot(p.currency).payoutsMinor += p.amountMinor
  return {
    orgId: org.id,
    orgName: org.name,
    charityNumber: org.charityNumber || null,
    month,
    periodStart: range.start.toISOString(),
    periodEnd: range.end.toISOString(),
    sales,
    refunds,
    payouts,
    totals: Array.from(totalsBy.values()).sort((a, b) => a.currency.localeCompare(b.currency)),
  }
}

/** Load everything for one org and month, then build. */
export async function loadMonthlyStatement(
  org: { id: string; name: string; charityNumber?: string | null },
  month: string,
  range: { start: Date; end: Date }
): Promise<MonthlyStatement> {
  const [eventsSnap, releasesSnap, withdrawalsSnap, platformSettings] = await Promise.all([
    adminDb.collection('events').where('organizer_id', '==', org.id).get(),
    adminDb.collection('payout_releases').where('organizerId', '==', org.id).get(),
    adminDb.collection('withdrawal_requests').where('organizerId', '==', org.id).get(),
    getPlatformSettings(),
  ])
  const events = eventsSnap.docs.map((d: any) => ({ id: d.id, data: d.data() || {} }))
  const ticketsByEvent = new Map<string, Array<{ id: string; data: Record<string, any> }>>()
  await Promise.all(
    events.map(async (ev: { id: string }) => {
      const snap = await adminDb.collection('tickets').where('event_id', '==', ev.id).get()
      ticketsByEvent.set(ev.id, snap.docs.map((d: any) => ({ id: d.id, data: d.data() || {} })))
    })
  )
  return buildMonthlyStatement(org, month, range, {
    events,
    ticketsByEvent,
    releases: releasesSnap.docs.map((d: any) => d.data() || {}),
    withdrawals: withdrawalsSnap.docs.map((d: any) => d.data() || {}),
    platformSettings,
  })
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  // Spreadsheet formula injection: a cell starting with = + - @ is data, not a formula.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV amount in major units; HTG has no decimals. */
const amtIn = (m: number, currency: string) => (currency === 'HTG' ? String(Math.round(m / 100)) : (m / 100).toFixed(2))

/** One CSV: a header block, then one row per sale, refund and payout, then totals. */
export function statementCsv(s: MonthlyStatement, labels: StatementLabels): string {
  const rows: unknown[][] = []
  rows.push([labels.title, s.orgName])
  if (s.charityNumber) rows.push([labels.charity, s.charityNumber])
  rows.push([labels.period, `${s.periodStart.slice(0, 10)} – ${new Date(Date.parse(s.periodEnd) - 1).toISOString().slice(0, 10)} (UTC)`])
  rows.push([])
  rows.push([labels.type, labels.date, labels.event, labels.order, labels.tickets, labels.currency, labels.gross, labels.fees, labels.buyerFees, labels.net, labels.refund, labels.payout, labels.reference])
  for (const r of s.sales) {
    const amt = (v: number) => amtIn(v, r.currency)
    rows.push([labels.sale, r.date.slice(0, 10), r.eventTitle, r.orderNumber, r.tickets, r.currency, amt(r.grossMinor), amt(r.feesMinor), amt(r.buyerFeesMinor), amt(r.netMinor), '', '', ''])
  }
  for (const r of s.refunds) {
    const amt = (v: number) => amtIn(v, r.currency)
    rows.push([labels.refundType, r.date.slice(0, 10), r.eventTitle, r.orderNumber, '', r.currency, '', '', '', '', amt(r.amountMinor), '', ''])
  }
  for (const r of s.payouts) {
    const amt = (v: number) => amtIn(v, r.currency)
    rows.push([labels.payoutType, r.date.slice(0, 10), '', '', '', r.currency, '', '', '', '', '', amt(r.amountMinor), r.reference])
  }
  rows.push([])
  for (const t of s.totals) {
    const amt = (v: number) => amtIn(v, t.currency)
    rows.push([labels.total, '', '', '', t.ticketsSold, t.currency, amt(t.grossMinor), amt(t.feesMinor), amt(t.buyerFeesMinor), amt(t.netSalesMinor), amt(t.refundsMinor), amt(t.payoutsMinor), ''])
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export interface StatementLabels {
  title: string
  charity: string
  period: string
  type: string
  date: string
  event: string
  order: string
  tickets: string
  currency: string
  gross: string
  fees: string
  buyerFees: string
  net: string
  refund: string
  payout: string
  reference: string
  sale: string
  refundType: string
  payoutType: string
  total: string
  summary: string
  sales: string
  refunds: string
  payouts: string
  note: string
}

export const STATEMENT_LABELS: Record<'en' | 'fr' | 'ht', StatementLabels> = {
  en: {
    title: 'Monthly statement', charity: 'Charity / registration no.', period: 'Period', type: 'Type', date: 'Date', event: 'Event',
    order: 'Order', tickets: 'Tickets', currency: 'Currency', gross: 'Ticket sales', fees: 'Tikèm fees', buyerFees: 'Service fees paid by buyers',
    net: 'Net sales', refund: 'Refund', payout: 'Payout', reference: 'Reference', sale: 'Sale', refundType: 'Refund', payoutType: 'Payout',
    total: 'Total', summary: 'Summary', sales: 'Sales', refunds: 'Refunds', payouts: 'Payouts',
    note: 'Dates are in UTC. Service fees paid by buyers are Tikèm\'s, shown for information; they are not part of your sales. Payouts are what was sent to you this month: Stripe transfers, MonCash and bank withdrawals, and printed tickets paid from your balance.',
  },
  fr: {
    title: 'Relevé mensuel', charity: "N° d'organisme de bienfaisance / d'enregistrement", period: 'Période', type: 'Type', date: 'Date', event: 'Événement',
    order: 'Commande', tickets: 'Billets', currency: 'Devise', gross: 'Ventes de billets', fees: 'Frais Tikèm', buyerFees: 'Frais de service payés par les acheteurs',
    net: 'Ventes nettes', refund: 'Remboursement', payout: 'Versement', reference: 'Référence', sale: 'Vente', refundType: 'Remboursement', payoutType: 'Versement',
    total: 'Total', summary: 'Résumé', sales: 'Ventes', refunds: 'Remboursements', payouts: 'Versements',
    note: "Les dates sont en UTC. Les frais de service payés par les acheteurs reviennent à Tikèm et sont indiqués à titre d'information ; ils ne font pas partie de vos ventes. Les versements sont ce qui vous a été envoyé ce mois-ci : virements Stripe, retraits MonCash et bancaires, et billets imprimés payés depuis votre solde.",
  },
  ht: {
    title: 'Rapò chak mwa', charity: 'Nimewo anrejistreman', period: 'Peryòd', type: 'Kalite', date: 'Dat', event: 'Evènman',
    order: 'Kòmand', tickets: 'Tikè', currency: 'Lajan', gross: 'Vant tikè', fees: 'Frè Tikèm', buyerFees: 'Frè sèvis achtè yo peye',
    net: 'Vant nèt', refund: 'Ranbousman', payout: 'Peman', reference: 'Referans', sale: 'Vant', refundType: 'Ranbousman', payoutType: 'Peman',
    total: 'Total', summary: 'Rezime', sales: 'Vant', refunds: 'Ranbousman', payouts: 'Peman',
    note: "Dat yo an UTC. Frè sèvis achtè yo peye se pou Tikèm, nou montre yo pou enfòmasyon sèlman; yo pa fè pati vant ou. Peman se sa yo voye ba ou mwa sa a: transfè Stripe, retrè MonCash ak bank, ak tikè enprime ki peye sou balans ou.",
  },
}
