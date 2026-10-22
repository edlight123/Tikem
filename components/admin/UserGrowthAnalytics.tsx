'use client'

import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface UserGrowthData {
  dailySignups: Array<{
    date: string
    attendees: number
    organizers: number
    total: number
  }>
  totalUsers: number
  organizerCount: number
  attendeeCount: number
}

interface Props {
  days?: number
}

export function UserGrowthAnalytics({ days = 30 }: Props) {
  const [data, setData] = useState<UserGrowthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedDays, setSelectedDays] = useState(days)

  useEffect(() => {
    fetchData(selectedDays)
  }, [selectedDays])

  const fetchData = async (period: number) => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/admin/analytics-data?type=user-growth&days=${period}`)
      const result = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(result.error || `Failed to load user growth data (${res.status})`)
      }
      // Access data from wrapped response
      const userData = result.data || result
      setData({
        dailySignups: Array.isArray(userData.dailySignups) ? userData.dailySignups : [],
        totalUsers: userData.totalUsers || 0,
        organizerCount: userData.organizerCount || 0,
        attendeeCount: userData.attendeeCount || 0
      })
    } catch (err) {
      console.error('Failed to load user growth data:', err)
      setLoadError(err instanceof Error ? err.message : 'Failed to load user growth data')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-16 animate-pulse rounded-lg bg-console-panel" />
        <div className="h-60 animate-pulse rounded-lg bg-console-panel" />
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="rounded-lg bg-console-panel p-8 text-center">
        <p className="mb-4 text-sm text-console-red">{loadError || 'Failed to load user growth data'}</p>
        <button
          onClick={() => fetchData(selectedDays)}
          className="rounded bg-console-raise px-3 py-1.5 text-[13px] font-semibold text-console-mut transition-colors hover:text-console-text"
        >
          Retry
        </button>
      </div>
    )
  }

  const pct = (n: number) => (data.totalUsers > 0 ? ((n / data.totalUsers) * 100).toFixed(0) : '0')

  return (
    <div className="space-y-4">
      {/* Period Selector */}
      <div className="flex flex-wrap gap-1">
        {[7, 14, 30, 60, 90].map((period) => (
          <button
            key={period}
            onClick={() => setSelectedDays(period)}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
              selectedDays === period ? 'bg-console-raise text-console-text' : 'text-console-mut hover:text-console-text'
            }`}
          >
            {period}d
          </button>
        ))}
      </div>

      {/* Summary — unboxed KPI figures */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-4">
        {[
          { label: 'Total users', value: data.totalUsers, sub: `last ${selectedDays}d` },
          { label: 'Attendees', value: data.attendeeCount, sub: `${pct(data.attendeeCount)}% of total` },
          { label: 'Organizers', value: data.organizerCount, sub: `${pct(data.organizerCount)}% of total` },
        ].map((s) => (
          <div key={s.label}>
            <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">{s.label}</div>
            <div className="mt-1 font-mono text-xl tabular-nums text-console-text">{s.value.toLocaleString()}</div>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-console-mut">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Growth Chart */}
      <div className="rounded-lg bg-console-panel p-4">
        <h3 className="label-mono mb-3 text-[10px] uppercase tracking-[0.18em] text-console-faint">Daily signups</h3>
        {data.dailySignups.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.dailySignups} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#20252E" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#8B93A1' }}
                tickLine={false}
                axisLine={{ stroke: '#20252E' }}
                tickFormatter={(value) => {
                  const date = new Date(value)
                  return `${date.getMonth() + 1}/${date.getDate()}`
                }}
              />
              <YAxis tick={{ fontSize: 11, fill: '#8B93A1' }} tickLine={false} axisLine={false} width={32} />
              <Tooltip
                // Recharts types this value as ReactNode, which includes
                // undefined. Casting it away would just move the failure to
                // runtime as "Invalid Date" in the tooltip.
                labelFormatter={(value) => {
                  const date = new Date(value as string | number)
                  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()
                }}
                contentStyle={{ background: '#20252E', border: 'none', borderRadius: 4, fontSize: 12 }}
                labelStyle={{ color: '#8B93A1' }}
                itemStyle={{ color: '#E8EAED' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#8B93A1' }} iconType="plainline" />
              <Line type="monotone" dataKey="total" stroke="#14B8A6" strokeWidth={2.5} dot={false} name="Total" />
              <Line type="monotone" dataKey="attendees" stroke="#5EEAD4" strokeWidth={2} dot={false} name="Attendees" />
              <Line type="monotone" dataKey="organizers" stroke="#0F766E" strokeWidth={2} dot={false} name="Organizers" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="py-12 text-center text-sm text-console-mut">No signup data for this period</div>
        )}
      </div>
    </div>
  )
}
