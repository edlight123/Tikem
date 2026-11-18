'use client'

import { useEffect, useState, useCallback } from 'react'
import { formatCurrency } from '@/lib/currency'
import {
  CreditCard,
  Smartphone,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react'

interface RevenueData {
  totalRevenueUSD: number
  totalRevenueHTG: number
  totalTickets: number
  totalRevenueUSDWithFxSpread: number
  fxSpread: {
    ticketCount: number
    usdVolume: number
    profitHTG: number
    profitUSD: number
    averageSpreadPercent: number
  }
  byCurrency: {
    HTG: {
      revenue: number
      tickets: number
      averagePrice: number
      convertedToUSD: number
    }
    USD: {
      revenue: number
      tickets: number
      averagePrice: number
    }
  }
  byPaymentMethod: {
    stripe: {
      revenueUSD: number
      tickets: number
      averagePrice: number
    }
    moncash: {
      revenueHTG: number
      revenueUSD: number
      tickets: number
      averagePrice: number
    }
    natcash: {
      revenueHTG: number
      revenueUSD: number
      tickets: number
      averagePrice: number
    }
  }
  exchangeRates: {
    averageRate: number
    minRate: number
    maxRate: number
    rateSpread: number
  }
}

interface GrowthData {
  revenueGrowth7d: number
  ticketsGrowth7d: number
  revenueGrowth30d: number
  ticketsGrowth30d: number
}

interface Props {
  showFilters?: boolean
}

export function AdminRevenueAnalytics({ showFilters = false }: Props) {
  const [revenue, setRevenue] = useState<RevenueData | null>(null)
  const [growth, setGrowth] = useState<GrowthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<'all' | '7d' | '30d' | '90d'>('all')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      let url = '/api/admin/revenue-analytics?type=platform'
      
      if (dateRange !== 'all') {
        const days = parseInt(dateRange)
        const endDate = new Date()
        const startDate = new Date()
        startDate.setDate(startDate.getDate() - days)
        
        url += `&startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`
      }
      
      const res = await fetch(url)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || `Failed to load revenue analytics (${res.status})`)
      }
      setRevenue(data.revenue)
      setGrowth(data.growth)
      setLoading(false)
    } catch (err) {
      console.error('Failed to load revenue analytics:', err)
      setLoadError(err instanceof Error ? err.message : 'Failed to load revenue analytics')
      setRevenue(null)
      setLoading(false)
    }
  }, [dateRange])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-16 animate-pulse rounded-lg bg-console-panel" />
        <div className="h-40 animate-pulse rounded-lg bg-console-panel" />
      </div>
    )
  }

  if (loadError || !revenue) {
    return (
      <div className="rounded-lg bg-console-panel p-8 text-center">
        <p className="mb-4 text-sm text-console-red">{loadError || 'Failed to load revenue analytics'}</p>
        <button
          onClick={() => void fetchData()}
          className="rounded bg-console-raise px-3 py-1.5 text-meta font-semibold text-console-mut transition-colors hover:text-console-text"
        >
          Retry
        </button>
      </div>
    )
  }

  const GrowthBadge = ({ value }: { value: number }) => {
    if (value === 0) return <span className="text-sm text-console-faint">No change</span>
    const isPositive = value > 0
    return (
      <span className={`flex items-center font-mono text-sm font-medium tabular-nums ${isPositive ? 'text-console-green' : 'text-console-red'}`}>
        {isPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
        {Math.abs(value).toFixed(1)}%
      </span>
    )
  }

  return (
    <div className="space-y-4">
      {/* Date Range Filter */}
      {showFilters && (
        <div className="flex gap-2 flex-wrap">
          {[
            { value: 'all', label: 'All Time' },
            { value: '7d', label: 'Last 7 Days' },
            { value: '30d', label: 'Last 30 Days' },
            { value: '90d', label: 'Last 90 Days' }
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => setDateRange(option.value as any)}
              className={`rounded px-3 py-1.5 text-meta font-semibold transition-colors ${
                dateRange === option.value
                  ? 'bg-console-raise text-console-text'
                  : 'text-console-mut hover:text-console-text'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {/* Total Revenue Overview — unboxed KPI figures */}
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Revenue (USD)</span>
            {growth && <GrowthBadge value={growth.revenueGrowth7d} />}
          </div>
          <div className="mt-1 font-mono text-xl tabular-nums text-console-text">
            {formatCurrency(revenue.totalRevenueUSDWithFxSpread ?? revenue.totalRevenueUSD, 'USD')}
          </div>
          {revenue.fxSpread?.ticketCount > 0 && (
            <div className="mt-1 text-xs text-console-mut">
              Incl. FX spread <span className="font-mono tabular-nums">{formatCurrency(revenue.fxSpread.profitUSD || 0, 'USD')}</span>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-3">
            <span className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Tickets sold</span>
            {growth && <GrowthBadge value={growth.ticketsGrowth7d} />}
          </div>
          <div className="mt-1 font-mono text-xl tabular-nums text-console-text">{revenue.totalTickets.toLocaleString()}</div>
        </div>

        <div>
          <div className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Avg ticket price</div>
          <div className="mt-1 font-mono text-xl tabular-nums text-console-text">
            {formatCurrency(revenue.totalRevenueUSD / revenue.totalTickets || 0, 'USD')}
          </div>
          <div className="mt-1 text-xs text-console-mut">Across all currencies</div>
        </div>
      </div>

      {/* Currency Breakdown */}
      <div className="rounded-lg bg-console-panel p-4">
        <h3 className="label-mono mb-3 text-eyebrow uppercase tracking-[0.18em] text-console-faint">Revenue by Currency</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* HTG Revenue */}
          <div className="rounded bg-console-raise p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-console-mut">HTG (Haitian Gourde)</h4>
              <span className="font-mono text-xs tabular-nums text-console-mut">
                {revenue.byCurrency.HTG.tickets} tickets
              </span>
            </div>
            <div className="space-y-1.5">
              <div>
                <div className="text-xs text-console-mut">Total Revenue</div>
                <div className="font-mono text-xl tabular-nums text-console-text">
                  {formatCurrency(revenue.byCurrency.HTG.revenue, 'HTG')}
                </div>
              </div>
              <div>
                <div className="text-xs text-console-mut">Converted to USD</div>
                <div className="font-mono text-base tabular-nums text-console-text">
                  {formatCurrency(revenue.byCurrency.HTG.convertedToUSD, 'USD')}
                </div>
              </div>
              <div>
                <div className="text-xs text-console-mut">Average Price</div>
                <div className="font-mono text-sm tabular-nums text-console-mut">
                  {formatCurrency(revenue.byCurrency.HTG.averagePrice, 'HTG')}
                </div>
              </div>
            </div>
          </div>

          {/* USD Revenue */}
          <div className="rounded bg-console-raise p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-console-mut">USD (US Dollar)</h4>
              <span className="font-mono text-xs tabular-nums text-console-mut">
                {revenue.byCurrency.USD.tickets} tickets
              </span>
            </div>
            <div className="space-y-1.5">
              <div>
                <div className="text-xs text-console-mut">Total Revenue</div>
                <div className="font-mono text-xl tabular-nums text-console-text">
                  {formatCurrency(revenue.byCurrency.USD.revenue, 'USD')}
                </div>
              </div>
              <div>
                <div className="text-xs text-console-mut">Average Price</div>
                <div className="font-mono text-sm tabular-nums text-console-mut">
                  {formatCurrency(revenue.byCurrency.USD.averagePrice, 'USD')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FX Spread Profit */}
      {revenue.fxSpread?.ticketCount > 0 && (
        <div className="rounded-lg bg-console-panel p-4">
          <h3 className="label-mono mb-3 text-eyebrow uppercase tracking-[0.18em] text-console-faint">FX Spread Profit (MonCash USD Events)</h3>
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <div>
              <div className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">USD Volume</div>
              <div className="mt-1 font-mono text-xl tabular-nums text-console-text">
                {formatCurrency(revenue.fxSpread.usdVolume, 'USD')}
              </div>
              <div className="mt-1 text-xs text-console-mut"><span className="font-mono tabular-nums">{revenue.fxSpread.ticketCount}</span> tickets</div>
            </div>
            <div>
              <div className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Spread Profit</div>
              <div className="mt-1 font-mono text-xl tabular-nums text-console-text">
                {formatCurrency(revenue.fxSpread.profitHTG, 'HTG')}
              </div>
              <div className="mt-1 font-mono text-xs tabular-nums text-console-mut">{formatCurrency(revenue.fxSpread.profitUSD || 0, 'USD')}</div>
              <div className="mt-1 text-xs text-console-faint">Computed from base vs effective rate</div>
            </div>
            <div>
              <div className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Avg Spread</div>
              <div className="mt-1 font-mono text-xl tabular-nums text-console-text">
                {(revenue.fxSpread.averageSpreadPercent * 100).toFixed(2)}%
              </div>
              <div className="mt-1 text-xs text-console-faint">From quote metadata</div>
            </div>
          </div>
        </div>
      )}

      {/* Payment Method Breakdown */}
      <div>
        <h3 className="label-mono mb-3 text-eyebrow uppercase tracking-[0.18em] text-console-faint">Revenue by payment method</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            {
              name: 'Stripe',
              icon: CreditCard,
              code: 'USD',
              primary: formatCurrency(revenue.byPaymentMethod.stripe.revenueUSD, 'USD'),
              meta: [
                `${revenue.byPaymentMethod.stripe.tickets.toLocaleString()} tickets`,
                `Avg ${formatCurrency(revenue.byPaymentMethod.stripe.averagePrice, 'USD')}`,
              ],
            },
            {
              name: 'MonCash',
              icon: Smartphone,
              code: 'HTG',
              primary: formatCurrency(revenue.byPaymentMethod.moncash.revenueHTG, 'HTG'),
              meta: [
                `${revenue.byPaymentMethod.moncash.tickets.toLocaleString()} tickets`,
                `≈ ${formatCurrency(revenue.byPaymentMethod.moncash.revenueUSD, 'USD')}`,
              ],
            },
            {
              name: 'NatCash',
              icon: Smartphone,
              code: 'HTG',
              primary: formatCurrency(revenue.byPaymentMethod.natcash.revenueHTG, 'HTG'),
              meta: [
                `${revenue.byPaymentMethod.natcash.tickets.toLocaleString()} tickets`,
                `≈ ${formatCurrency(revenue.byPaymentMethod.natcash.revenueUSD, 'USD')}`,
              ],
            },
          ].map((m) => {
            const Icon = m.icon
            return (
              <div key={m.name} className="rounded-lg bg-console-panel p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Icon className="h-4 w-4 text-console-faint" />
                  <h4 className="text-sm font-semibold text-console-text">{m.name}</h4>
                  <span className="label-mono ml-auto text-eyebrow uppercase tracking-[0.18em] text-console-faint">
                    {m.code}
                  </span>
                </div>
                <div className="font-mono text-xl leading-none tabular-nums text-console-text">
                  {m.primary}
                </div>
                <div className="mt-4 flex items-center gap-4 border-t border-console-raise pt-3 text-xs text-console-mut">
                  {m.meta.map((x, i) => (
                    <span key={i} className="font-mono tabular-nums">{x}</span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Exchange Rate Info */}
      {revenue.exchangeRates.averageRate > 0 && (
        <div className="rounded-lg bg-console-panel p-4">
          <h3 className="label-mono mb-3 text-eyebrow uppercase tracking-[0.18em] text-console-faint">Exchange Rate Analytics</h3>
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <div>
              <div className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Average Rate</div>
              <div className="mt-1 font-mono text-base tabular-nums text-console-text">
                {revenue.exchangeRates.averageRate.toFixed(6)}
              </div>
            </div>
            <div>
              <div className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Min Rate</div>
              <div className="mt-1 font-mono text-base tabular-nums text-console-text">
                {revenue.exchangeRates.minRate.toFixed(6)}
              </div>
            </div>
            <div>
              <div className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Max Rate</div>
              <div className="mt-1 font-mono text-base tabular-nums text-console-text">
                {revenue.exchangeRates.maxRate.toFixed(6)}
              </div>
            </div>
            <div>
              <div className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Rate Spread</div>
              <div className="mt-1 font-mono text-base tabular-nums text-console-text">
                {revenue.exchangeRates.rateSpread.toFixed(6)}
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-console-mut">
            HTG to USD conversion rates across all transactions
          </p>
        </div>
      )}
    </div>
  )
}
