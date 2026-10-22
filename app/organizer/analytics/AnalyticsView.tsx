'use client'

import { Calendar, DollarSign, Ticket, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import SalesChart from '@/components/charts/SalesChart'
import CategoryChart from '@/components/charts/CategoryChart'
import { MetricCard, SectionHeader, OrgEmptyState } from '@/components/organizer/ui'
import { TranslatedPageHeader } from '@/components/organizer/ui/TranslatedPageHeader'
import { formatMoneyFromCents } from '@/lib/money'

/**
 * The analytics dashboard, split out of page.tsx so it can be a CLIENT
 * component and translate its own labels. The page keeps every query — it hands
 * this component finished numbers, so nothing server-only crosses the boundary.
 */
export default function AnalyticsView({
  totalEvents,
  publishedEvents,
  totalTicketsSold,
  totalRevenueCents,
  organizerCurrency,
  salesChartData,
  categoryChartData,
  eventsWithSales,
}: {
  totalEvents: number
  publishedEvents: number
  totalTicketsSold: number
  totalRevenueCents: number
  organizerCurrency: string
  salesChartData: any[]
  categoryChartData: { name: string; value: number }[]
  eventsWithSales: any[]
}) {
  const { t } = useTranslation('organizer')

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <TranslatedPageHeader
          eyebrowKey="organizer"
          titleKey="analytics_title"
          subtitleKey="analytics_subtitle"
        />

        {/* KPI row */}
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            icon={Calendar}
            label={t('analytics.total_events')}
            value={totalEvents}
            sublabel={`${publishedEvents} published`}
          />
          <MetricCard
            icon={Ticket}
            label={t('analytics.tickets_sold')}
            value={totalTicketsSold}
            sublabel={t('analytics.across_all_events')}
          />
          <MetricCard
            icon={DollarSign}
            label={t('analytics.total_revenue')}
            value={formatMoneyFromCents(totalRevenueCents, organizerCurrency, 'en-US', { currencyDisplay: 'code' })}
            sublabel={t('analytics.lifetime_earnings')}
          />
          <MetricCard
            icon={TrendingUp}
            label={t('analytics.avg_per_event')}
            value={totalEvents > 0 ? (totalTicketsSold / totalEvents).toFixed(1) : '0'}
            sublabel={t('analytics.tickets_per_event')}
          />
        </div>

        {/* Charts */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl bg-white/[0.055] p-6">
            <SectionHeader eyebrow={t('analytics.last_7_days')} title={t('analytics.sales_trend')} className="mb-5" />
            <SalesChart data={salesChartData} currency={organizerCurrency} />
            <div className="mt-4 flex justify-center gap-6">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-brand-700" />
                <span className="text-xs text-white/50">{t('analytics.tickets_sold')}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-brand-400" />
                <span className="text-xs text-white/50">{t('analytics.revenue')}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white/[0.055] p-6">
            <SectionHeader title={t('analytics.events_by_category')} className="mb-5" />
            {categoryChartData.length > 0 ? (
              <CategoryChart data={categoryChartData} />
            ) : (
              <div className="flex h-[300px] items-center justify-center text-sm text-white/40">
                {t('analytics.no_category_data')}
              </div>
            )}
          </div>
        </div>

        {/* Top events */}
        <div className="mt-6 rounded-2xl bg-white/[0.055] p-6">
          <SectionHeader eyebrow={t('analytics.leaderboard')} title={t('analytics.top_performing_events')} className="mb-6" />
          {eventsWithSales.length === 0 ? (
            <OrgEmptyState
              icon={Calendar}
              title={t('analytics.no_events_yet')}
              description={t('analytics.create_first_event')}
              action={
                <Link
                  href="/organizer/events/new"
                  className="inline-flex items-center gap-2 rounded bg-white px-6 py-3 font-semibold text-black hover:bg-white/90 transition-colors"
                >
                  <Calendar className="h-5 w-5" />
                  {t('analytics.create_event')}
                </Link>
              }
            />
          ) : (
            <div className="space-y-3">
              {eventsWithSales.slice(0, 10).map((event: any, index: number) => (
                <div
                  key={event.id}
                  className="flex items-center gap-4 rounded-xl bg-white/[0.06] p-4 transition-colors hover:bg-white/[0.12]"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded bg-white/[0.08] font-mono tabular-nums font-bold text-white text-sm">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/organizer/events/${event.id}`}
                      className="block truncate font-display italic text-white hover:text-white/75 transition-colors"
                    >
                      {event.title}
                    </Link>
                    <p className="font-mono tabular-nums text-xs text-white/50 mt-0.5">
                      {new Date(event.start_datetime).toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-6">
                    <div className="text-right">
                      <p className="label-mono text-[10px] uppercase text-white/40">{t('analytics.tickets')}</p>
                      <p className="font-mono tabular-nums text-xl font-bold text-brand-300">{event.ticketCount}</p>
                    </div>
                    <div className="text-right">
                      <p className="label-mono text-[10px] uppercase text-white/40">{t('analytics.revenue')}</p>
                      <p className="font-mono tabular-nums text-xl font-bold text-white">
                        {formatMoneyFromCents(event.revenueCents, organizerCurrency, 'en-US', { currencyDisplay: 'code' })}
                      </p>
                    </div>
                    {!event.is_published && (
                      <span className="rounded bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-white/60">
                        {t('analytics.draft')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
