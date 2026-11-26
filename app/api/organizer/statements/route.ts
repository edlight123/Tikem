/**
 * GET /api/organizer/statements?month=YYYY-MM&format=csv|pdf|xlsx&lang=en|fr
 *
 * The acting organization's monthly statement (sales, Tikèm fees, refunds,
 * payouts). Finance-view gate (owner, or a team admin with the finance grant);
 * scoped by ctx.orgId, never the caller's uid. See lib/statements/monthly.ts.
 */
import { NextResponse } from 'next/server'
import { requireFinanceView, orgDisplayName } from '@/lib/organizer/context'
import { formatMoneyFromCents } from '@/lib/money'
import { loadMonthlyStatement, monthRange, statementCsv, STATEMENT_LABELS, type MonthlyStatement } from '@/lib/statements/monthly'
import { EXPORT_LABELS, EXPORT_LOCALE, exportLang } from '@/lib/exports/labels'
import { exportResponse } from '@/lib/exports/respond'
import { contentDisposition, exportFileName } from '@/lib/exports/fileName'
import type { ExportReport } from '@/lib/exports/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const major = (m: number) => m / 100

function toReport(s: MonthlyStatement, lang: 'en' | 'fr' | 'ht'): ExportReport {
  const L = STATEMENT_LABELS[lang]
  const money = (m: number, currency: string) => ({ amount: major(m), currency })
  return {
    title: s.orgName || 'Tikèm',
    reportLabel: `${L.title} · ${s.month}`,
    subtitle: [
      `${L.period}: ${s.periodStart.slice(0, 10)} – ${new Date(Date.parse(s.periodEnd) - 1).toISOString().slice(0, 10)} (UTC)`,
      ...(s.charityNumber ? [`${L.charity}: ${s.charityNumber}`] : []),
    ],
    organizerName: s.orgName,
    stats: s.totals.map((t) => ({ label: `${L.net} (${t.currency})`, value: formatMoneyFromCents(t.netSalesMinor, t.currency) })),
    sections: [
      {
        name: L.summary,
        note: L.note,
        columns: [
          { key: 'currency', header: L.currency, width: 10 },
          { key: 'tickets', header: L.tickets, kind: 'integer', width: 10 },
          { key: 'gross', header: L.gross, kind: 'money', width: 16 },
          { key: 'fees', header: L.fees, kind: 'money', width: 14 },
          { key: 'net', header: L.net, kind: 'money', width: 14 },
          { key: 'refunds', header: L.refunds, kind: 'money', width: 14 },
          { key: 'payouts', header: L.payouts, kind: 'money', width: 14 },
          { key: 'buyerFees', header: L.buyerFees, kind: 'money', width: 18 },
        ],
        rows: s.totals.map((t) => ({
          currency: t.currency,
          tickets: t.ticketsSold,
          gross: money(t.grossMinor, t.currency),
          fees: money(t.feesMinor, t.currency),
          net: money(t.netSalesMinor, t.currency),
          refunds: money(t.refundsMinor, t.currency),
          payouts: money(t.payoutsMinor, t.currency),
          buyerFees: money(t.buyerFeesMinor, t.currency),
        })),
      },
      {
        name: L.sales,
        totals: s.sales.length > 0 && new Set(s.sales.map((r) => r.currency)).size === 1,
        columns: [
          { key: 'date', header: L.date, kind: 'date', width: 12 },
          { key: 'event', header: L.event, width: 28 },
          { key: 'order', header: L.order, width: 16 },
          { key: 'tickets', header: L.tickets, kind: 'integer', width: 8, total: true },
          { key: 'gross', header: L.gross, kind: 'money', width: 14, total: true },
          { key: 'fees', header: L.fees, kind: 'money', width: 12, total: true },
          { key: 'net', header: L.net, kind: 'money', width: 14, total: true },
        ],
        rows: s.sales.map((r) => ({
          date: new Date(r.date),
          event: r.eventTitle,
          order: r.orderNumber,
          tickets: r.tickets,
          gross: money(r.grossMinor, r.currency),
          fees: money(r.feesMinor, r.currency),
          net: money(r.netMinor, r.currency),
        })),
      },
      {
        name: L.refunds,
        columns: [
          { key: 'date', header: L.date, kind: 'date', width: 12 },
          { key: 'event', header: L.event, width: 30 },
          { key: 'order', header: L.order, width: 16 },
          { key: 'amount', header: L.refund, kind: 'money', width: 14 },
        ],
        rows: s.refunds.map((r) => ({ date: new Date(r.date), event: r.eventTitle, order: r.orderNumber, amount: money(r.amountMinor, r.currency) })),
      },
      {
        name: L.payouts,
        columns: [
          { key: 'date', header: L.date, kind: 'date', width: 12 },
          { key: 'amount', header: L.payout, kind: 'money', width: 14 },
          { key: 'status', header: L.type, width: 12 },
          { key: 'reference', header: L.reference, width: 28, pdf: false },
        ],
        rows: s.payouts.map((r) => ({ date: new Date(r.date), amount: money(r.amountMinor, r.currency), status: r.status, reference: r.reference })),
      },
    ],
    locale: EXPORT_LOCALE[lang],
    timeZone: 'UTC',
    labels: EXPORT_LABELS[lang],
  }
}

export async function GET(request: Request) {
  const gate = await requireFinanceView()
  if (!gate.ok) return gate.response
  const ctx = gate.value
  const url = new URL(request.url)
  const month = String(url.searchParams.get('month') || '')
  const range = monthRange(month)
  if (!range) return NextResponse.json({ error: 'month must be YYYY-MM, not in the future', code: 'bad_month' }, { status: 400 })
  const format = String(url.searchParams.get('format') || 'csv').toLowerCase()
  if (!['csv', 'pdf', 'xlsx'].includes(format)) return NextResponse.json({ error: 'format must be csv, pdf or xlsx', code: 'bad_format' }, { status: 400 })
  const lang = exportLang(url.searchParams.get('lang'))

  const name = (await orgDisplayName(ctx.orgId)) || 'Tikèm organizer'
  const statement = await loadMonthlyStatement({ id: ctx.orgId, name, charityNumber: null }, month, range)
  const label = STATEMENT_LABELS[lang].title

  if (format === 'csv') {
    const fileName = exportFileName({ title: name, label, day: month, ext: 'xlsx' }).replace(/\.xlsx$/, '.csv')
    return new NextResponse(statementCsv(statement, STATEMENT_LABELS[lang]), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': contentDisposition(fileName),
        'Cache-Control': 'private, no-store',
      },
    })
  }
  return exportResponse(toReport(statement, lang), format as 'pdf' | 'xlsx', { title: name, label, day: month })
}
