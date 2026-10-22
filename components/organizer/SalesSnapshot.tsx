'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar, Users, DollarSign, TrendingUp } from 'lucide-react'
import { formatMoneyFromCents, formatMultiCurrencyFromCents } from '@/lib/money'

type TimeRange = '7d' | '30d' | 'lifetime'

interface SalesSnapshotProps {
  data: {
    '7d': {
      upcomingEvents: number
      ticketsSold: number
      revenueCents: number
      revenueByCurrencyCents?: Record<string, number>
      avgTicketsPerEvent: number
    }
    '30d': {
      upcomingEvents: number
      ticketsSold: number
      revenueCents: number
      revenueByCurrencyCents?: Record<string, number>
      avgTicketsPerEvent: number
    }
    lifetime: {
      upcomingEvents: number
      ticketsSold: number
      revenueCents: number
      revenueByCurrencyCents?: Record<string, number>
      avgTicketsPerEvent: number
    }
  }
  currency?: string
}

export function SalesSnapshot({ data, currency = 'HTG' }: SalesSnapshotProps) {
  const { t } = useTranslation('common')
  const [range, setRange] = useState<TimeRange>('7d')
  const metrics = data[range]

  const hasMultipleCurrencies = (() => {
    const breakdown = metrics.revenueByCurrencyCents || {}
    const nonZeroCurrencies = Object.entries(breakdown).filter(([, cents]) => (cents || 0) !== 0)
    return nonZeroCurrencies.length > 1
  })()

  const formatRevenue = () => {
    const breakdown = metrics.revenueByCurrencyCents || {}
    const nonZero = Object.entries(breakdown).filter(([, cents]) => (cents || 0) !== 0)

    if (hasMultipleCurrencies) {
      return formatMultiCurrencyFromCents(breakdown)
    }

    if (nonZero.length === 1) {
      const [onlyCurrency, cents] = nonZero[0]
      if ((cents || 0) === 0) return 'No earnings yet'
      return formatMoneyFromCents(Number(cents || 0), onlyCurrency, 'en-US', { currencyDisplay: 'code' })
    }

    if (metrics.revenueCents === 0) return 'No earnings yet'
    return formatMoneyFromCents(metrics.revenueCents, currency, 'en-US', { currencyDisplay: 'code' })
  }

  const getRangeLabel = (r: TimeRange) => {
    switch (r) {
      case '7d': return t('sales_snapshot.7d')
      case '30d': return t('sales_snapshot.30d')
      case 'lifetime': return t('sales_snapshot.lifetime')
    }
  }

  return (
    <div className="rounded-2xl bg-white/[0.03] p-4 shadow-soft sm:p-5">
      {/* Header with Toggle */}
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <h3 className="font-display text-lg leading-none text-white sm:text-xl">{t('sales_snapshot.title')}</h3>
          <span className="truncate text-xs text-white/40">{getRangeLabel(range)}</span>
        </div>
        {/*
          The selected range used to be `bg-white/[0.03]` sitting inside a
          `bg-white/[0.03]` track on a card of the same value — three identical
          fills, so nothing read as chosen. Selection is a white fill now, and
          the ::after gives each 30px chip a 44px touch box.
        */}
        <div className="flex shrink-0 items-center gap-0.5 rounded bg-white/[0.06] p-1">
          {(['7d', '30d', 'lifetime'] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`relative inline-flex items-center rounded px-2.5 py-1.5 text-[13px] font-medium leading-[18px] transition-colors after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                range === r
                  ? 'bg-white text-black'
                  : 'text-white/70 hover:bg-white/[0.12] hover:text-white'
              }`}
            >
              {r === '7d' ? '7d' : r === '30d' ? '30d' : 'Lifetime'}
            </button>
          ))}
        </div>
      </div>

      {/* Metrics row — compact chips (icon + label inline, value below) */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <div className="rounded-xl bg-white/[0.06] px-3.5 py-3">
          <div className="mb-1 flex items-center gap-1.5 text-white/50">
            <Calendar className="h-3.5 w-3.5 text-brand-300" />
            <p className="label-mono text-[11px] uppercase">{t('sales_snapshot.events')}</p>
          </div>
          <p className="text-2xl font-bold leading-none text-white font-mono tabular-nums">{metrics.upcomingEvents}</p>
          <p className="mt-1 text-[11px] text-white/40">{t('sales_snapshot.upcoming')}</p>
        </div>

        <div className="rounded-xl bg-white/[0.06] px-3.5 py-3">
          <div className="mb-1 flex items-center gap-1.5 text-white/50">
            <Users className="h-3.5 w-3.5 text-brand-300" />
            <p className="label-mono text-[11px] uppercase">{t('sales_snapshot.tickets')}</p>
          </div>
          <p className="text-2xl font-bold leading-none text-white font-mono tabular-nums">{metrics.ticketsSold}</p>
          <p className="mt-1 text-[11px] text-white/40">{t('sales_snapshot.sold')}</p>
        </div>

        <div className="rounded-xl bg-white/[0.06] px-3.5 py-3">
          <div className="mb-1 flex items-center gap-1.5 text-white/50">
            <DollarSign className="h-3.5 w-3.5 text-brand-300" />
            <p className="label-mono text-[11px] uppercase">{t('sales_snapshot.revenue')}</p>
          </div>
          <p className={`font-bold leading-tight ${metrics.revenueCents === 0 ? 'text-base text-white' : 'text-2xl leading-none font-mono tabular-nums text-brand-300'}`}>
            {formatRevenue()}
          </p>
          <p className="mt-1 text-[11px] text-white/40">
            {metrics.revenueCents === 0
              ? 'Start selling tickets'
              : hasMultipleCurrencies
                ? 'Multiple currencies'
                : t('sales_snapshot.earned')}
          </p>
        </div>

        <div className="rounded-xl bg-white/[0.06] px-3.5 py-3">
          <div className="mb-1 flex items-center gap-1.5 text-white/50">
            <TrendingUp className="h-3.5 w-3.5 text-brand-300" />
            <p className="label-mono text-[11px] uppercase">{t('sales_snapshot.avg_event')}</p>
          </div>
          <p className="text-2xl font-bold leading-none text-white font-mono tabular-nums">{metrics.avgTicketsPerEvent.toFixed(1)}</p>
          <p className="mt-1 text-[11px] text-white/40">{t('sales_snapshot.tickets_per_event')}</p>
        </div>
      </div>
    </div>
  )
}
