import { T } from '@/components/organizer/ui/TranslatedText'
import { DaysWithSalesCaption } from './DaysWithSalesCaption'
import { requireAuth } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { loadTicketDocsForEvent } from '@/lib/tickets/loadTicketsForEvent'
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
  const { user, error } = await requireAuth()
  if (error || !user) redirect(`/auth/login?redirect=/organizer/events/${eventId}/analytics`)
  if (user.role !== 'organizer') redirect('/organizer')

  const eventDoc = await adminDb.collection('events').doc(eventId).get()
  if (!eventDoc.exists) notFound()
  const eventData = eventDoc.data()!
  if (eventData.organizer_id !== user.id && !user.isAdmin) notFound()

  const eventCurrency = normalizeCurrency(eventData.currency, 'HTG')
  const capacity = Number(eventData.total_tickets || 0)

  // Fetch all tickets
  const ticketDocs = await loadTicketDocsForEvent(eventId)

  const tickets = ticketDocs.map((doc) => {
    const d = doc.data()
    return {
      status: String(d.status || 'active'),
      currency: String(d.currency || eventCurrency),
      price_paid: Number(d.price_paid || 0),
      purchased_at: serializeTs(d.purchased_at),
      checked_in_at: serializeTs(d.checked_in_at),
      tier_id: String(d.tier_id || ''),
      tier_name: String(d.tier_name || ''),
    }
  })

  const active = tickets.filter((t) => t.status !== 'cancelled')
  const ticketsSold = active.length
  const checkedIn = active.filter((t) => t.checked_in_at).length
  const checkInRate = ticketsSold > 0 ? (checkedIn / ticketsSold) * 100 : 0
  const capacityRate = capacity > 0 ? (ticketsSold / capacity) * 100 : 0

  // Revenue by currency
  const revenueByCurrencyCents: Record<string, number> = {}
  for (const t of active) {
    const currency = normalizeCurrency(t.currency, eventCurrency)
    const cents = Math.round(t.price_paid * 100)
    revenueByCurrencyCents[currency] = (revenueByCurrencyCents[currency] || 0) + cents
  }
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
            <div className="rounded-2xl border border-white/10 p-5">
              <h2 className="mb-4 font-semibold text-white"><T k="event_analytics.sales_by_tier" /></h2>
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
                      <div className="h-2 overflow-hidden rounded-full bg-white/[0.03]">
                        <div
                          className="h-full rounded-full bg-brand-600 transition-all"
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
            <div className="rounded-2xl border border-white/10 p-5">
              <h2 className="mb-4 font-semibold text-white"><T k="event_analytics.daily_sales" /></h2>
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
                        className="w-4 rounded-sm bg-brand-600 transition-all group-hover:bg-brand-400"
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
