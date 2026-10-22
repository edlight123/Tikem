'use client'

import { useCallback, useEffect, useState } from 'react'
import { Eye, Heart, ShoppingCart, TrendingUp } from 'lucide-react'

interface ConversionData {
  views: number
  favorites: number
  purchases: number
  favoriteRate: number
  purchaseRate: number
  overallConversion: number
}

export function ConversionFunnelAnalytics() {
  const [data, setData] = useState<ConversionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/admin/analytics-data?type=conversion&days=30')
      const result = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(result.error || `Failed to load conversion data (${res.status})`)
      }
      const conversionData = result.data || result
      setData(conversionData)
    } catch (err) {
      console.error('Failed to load conversion data:', err)
      setLoadError(err instanceof Error ? err.message : 'Failed to load conversion data')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-20 animate-pulse rounded-lg bg-console-panel" />
        <div className="h-48 animate-pulse rounded-lg bg-console-panel" />
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="rounded-lg bg-console-panel p-8 text-center">
        <p className="mb-4 text-sm text-console-red">{loadError || 'Failed to load conversion data'}</p>
        <button
          onClick={() => void loadData()}
          className="rounded bg-console-raise px-3 py-1.5 text-[13px] font-semibold text-console-mut transition-colors hover:text-console-text"
        >
          Retry
        </button>
      </div>
    )
  }

  const stages = [
    { label: 'Event views', value: data.views, icon: Eye },
    { label: 'Favorites', value: data.favorites, icon: Heart, conversionRate: data.favoriteRate },
    { label: 'Purchases', value: data.purchases, icon: ShoppingCart, conversionRate: data.purchaseRate },
  ]

  return (
    <div className="space-y-4">
      {/* Overall conversion — unboxed KPI figure */}
      <div>
        <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Overall conversion</div>
        <div className="mt-1 font-mono text-xl tabular-nums text-console-text">{data.overallConversion.toFixed(2)}%</div>
        <div className="mt-0.5 text-xs text-console-mut">Views → purchases · last 30 days</div>
      </div>

      {/* Funnel */}
      <div className="rounded-lg bg-console-panel p-4">
        <h3 className="label-mono mb-3 text-[10px] uppercase tracking-[0.18em] text-console-faint">Conversion funnel</h3>
        <div className="space-y-3">
          {stages.map((stage) => {
            const StageIcon = stage.icon
            const widthPercentage = data.views > 0 ? (stage.value / data.views) * 100 : 0
            return (
              <div key={stage.label}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-console-text">
                    <StageIcon className="h-4 w-4 text-console-faint" /> {stage.label}
                    {stage.conversionRate !== undefined && (
                      <span className="font-mono text-xs tabular-nums text-console-mut">· {stage.conversionRate.toFixed(1)}%</span>
                    )}
                  </span>
                  <span className="font-mono text-sm tabular-nums text-console-text">{stage.value.toLocaleString()}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded bg-console-raise">
                  <div className="h-full rounded bg-console-mut transition-all duration-500" style={{ width: `${widthPercentage}%` }} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Insights */}
        <div className="mt-4 rounded bg-console-raise p-3">
          <div className="label-mono mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-console-faint">
            <TrendingUp className="h-3.5 w-3.5 text-console-faint" /> Insights
          </div>
          <ul className="space-y-0.5 text-xs text-console-mut">
            <li><span className="font-mono tabular-nums">{data.favoriteRate.toFixed(1)}%</span> of viewers favorite events</li>
            <li><span className="font-mono tabular-nums">{data.purchaseRate.toFixed(1)}%</span> of favorited events lead to purchases</li>
            <li>Overall <span className="font-mono tabular-nums">{data.overallConversion.toFixed(2)}%</span> of viewers complete a purchase</li>
          </ul>
        </div>
      </div>

      <p className="text-center text-[11px] text-console-faint">
        Event views are estimated (10× favorites) until view tracking is implemented.
      </p>
    </div>
  )
}
