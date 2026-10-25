import { T } from '@/components/organizer/ui/TranslatedText'
import { DaysWithSalesCaption } from './DaysWithSalesCaption'
import { requireEventPage } from '../../../_lib/orgPage'
import { adminDb } from '@/lib/firebase/admin'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'
import { summarizeEventTickets, ticketCountsAsSold } from '@/lib/organizer/salesSummary'
import { normalizeCurrency } from '@/lib/money'
import { formatPrimaryMoneyFromCentsByCurrency } from '@/lib/money'
import { BarChart2, Ticket, Users, CheckCircle, TrendingUp } from 'lucide-react'
import { MetricCard } from '@/components/organizer/ui'
import { OrgEmptyState } from '@/components/organizer/ui'
import { EMPTY_VALUE } from '@/lib/format'

export const revalidate = 0

function serializeTs(v: unknown): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  if (typeof (v as any).toDate === 'function') return (v as any).toDate().toISOString()
  return String(v)
}

export default async function EventAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: eventId } = await params
  const { event: __event } = await requireEventPage(eventId, 'view', `/organizer/events/${eventId}/analytics`)
  const eventData = __event

  const eventCurrency = normalizeCurrency(eventData.currency, 'HTG')
  const capacity = Number(eventData.total_tickets || 0)

  // Fetch all tickets
  const ticketDocs = await loadTicketDocsForEvent(eventId)

  const ticketDatas = ticketDocs.map((doc) => doc.data() || {})
  const tickets = ticketDatas.map((d) => {
    return {
      sold: ticketCountsAsSold(d),
      status: String(d.status || 'active'),
      currency: String(d.currency || eventCurrency),
      price_paid: Number(d.price_paid || 0),
      purchased_at: serializeTs(d.purchased_at),
      checked_in_at: serializeTs(d.checked_in_at),
      tier_id: String(d.tier_id || ''),
      tier_name: String(d.tier_name || ''),
    }
  })

  // Live tickets only (valid / confirmed / active): refunds are not sales.
  const active = tickets.filter((t) => t.sold)
  const sales = summarizeEventTickets(ticketDatas, eventCurrency)
  const ticketsSold = sales.ticketsSold
  const checkedIn = sales.checkedIn
  const checkInRate = ticketsSold > 0 ? (checkedIn / ticketsSold) * 100 : 0
  const capacityRate = capacity > 0 ? (ticketsSold / capacity) * 100 : 0

  // Revenue by currency (listed currency, as earnings counts it)
  const revenueByCurrencyCents = sales.revenueByCurrencyCents
  const revenueLabel =
    Object.keys(revenueByCurrencyCents).length > 0
      ? formatPrimaryMoneyFromCentsByCurrency(revenueByCurrencyCents, eventCurrency, 'en-US', {
          currencyDisplay: 'code',
        })
      : EMPTY_VALUE

  // Sales by day (last 30 days of purchases)
  type DayStat = { date: string; count: number }
  const byDay: Record<string, number> = {}
  for (const t of active) {
    if (!t.purchased_at) continue
    const day = t.purchased_at.slice(0, 10) // YYYY-MM-DD
    byDay[day] = (byDay[day] || 0) + 1
  }
  const salesByDay: DayStat[] = Object.entries(byDay)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30)

  // Tier breakdown
  type TierStat = { name: string; sold: number }
  const tierMap: Record<string, TierStat> = {}
  for (const t of active) {
    const key = t.tier_id || 'default'
    if (!tierMap[key]) tierMap[key] = { name: t.tier_name || 'General Admission', sold: 0 }
    tierMap[key].sold += 1
  }
  const tierBreakdown = Object.values(tierMap).sort((a, b) => b.sold - a.sold)

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {ticketsSold === 0 ? (
        <OrgEmptyState
          icon={BarChart2}
          title={<T k="event_analytics.no_sales_data_yet" />}
          description={<T k="event_analytics.analytics_after_sales" />}
          className="mt-2"
        />
      ) : (
        <div className="space-y-8">
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetricCard
              icon={Ticket}
              label={<T k="event_analytics.tickets_sold" />}
              value={ticketsSold}
              sublabel={capacity > 0 ? `${capacityRate.toFixed(0)}% of capacity` : undefined}
            />
            <MetricCard
              icon={TrendingUp}
              label={<T k="event_analytics.revenue" />}
              value={revenueLabel}
            />
            <MetricCard
              icon={Users}
              label={<T k="event_analytics.capacity" />}
              value={capacity > 0 ? capacity : EMPTY_VALUE}
              sublabel={capacity > 0 ? `${(capacity - ticketsSold)} remaining` : 'Unlimited'}
            />
            <MetricCard
              icon={CheckCircle}
              label={<T k="event_analytics.checked_in" />}
              value={checkedIn}
              sublabel={ticketsSold > 0 ? `${checkInRate.toFixed(0)}% rate` : undefined}
            />
          </div>

          {/* Ticket tier breakdown */}
          {tierBreakdown.length > 0 && (
            <div className="rounded-2xl p-5 bg-white/[0.055]">
              <h2 className="mb-4 font-display lowercase italic !text-[22px] !leading-snug text-white"><T k="event_analytics.sales_by_tier" /></h2>
              <div className="space-y-3">
                {tierBreakdown.map((tier) => {
                  const pct = ticketsSold > 0 ? (tier.sold / ticketsSold) * 100 : 0
                  return (
                    <div key={tier.name}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="text-white/80">{tier.name}</span>
                        <span className="font-mono tabular-nums text-white">
                          {tier.sold} <span className="text-white/40">({pct.toFixed(0)}%)</span>
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded bg-white/[0.03]">
                        <div
                          className="h-full rounded bg-white transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Daily sales chart (text-based sparkline) */}
          {salesByDay.length > 1 && (
            <div className="rounded-2xl p-5 bg-white/[0.055]">
              <h2 className="mb-4 font-display lowercase italic !text-[22px] !leading-snug text-white"><T k="event_analytics.daily_sales" /></h2>
              <div className="flex items-end gap-1 overflow-x-auto pb-1">
                {salesByDay.map(({ date, count }) => {
                  const max = Math.max(...salesByDay.map((d) => d.count), 1)
                  const heightPct = Math.max((count / max) * 100, 4)
                  return (
                    <div
                      key={date}
                      className="group relative flex shrink-0 flex-col items-center gap-1"
                      style={{ minWidth: '24px' }}
                    >
                      <div
                        className="w-4 rounded-sm bg-white/70 transition-all group-hover:bg-white"
                        style={{ height: `${heightPct * 0.8}px`, maxHeight: '80px' }}
                        title={`${count} on ${date}`}
                      />
                      <span className="hidden font-mono tabular-nums text-[9px] text-white/30 group-hover:block">
                        {date.slice(5)}
                      </span>
                    </div>
                  )
                })}
              </div>
              <DaysWithSalesCaption count={salesByDay.length} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
