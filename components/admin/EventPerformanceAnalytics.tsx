'use client'

import { useCallback, useEffect, useState } from 'react'
import { Trophy, TrendingUp } from 'lucide-react'
import Link from 'next/link'

interface EventData {
  id: string
  title: string
  date: string
  ticket_price: number
  capacity: number
  organizer_id: string
  successScore: number
  users?: { name: string }
}

interface CategoryData {
  category: string
  count: number
}

export function EventPerformanceAnalytics() {
  const [topEvents, setTopEvents] = useState<EventData[]>([])
  const [categories, setCategories] = useState<CategoryData[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [eventsResp, catsResp] = await Promise.all([
        fetch('/api/admin/analytics-data?type=top-events&limit=10'),
        fetch('/api/admin/analytics-data?type=categories&days=30'),
      ])
      if (!eventsResp.ok || !catsResp.ok) {
        throw new Error(`Failed to load event data (${!eventsResp.ok ? eventsResp.status : catsResp.status})`)
      }
      const eventsRes = await eventsResp.json()
      const catsRes = await catsResp.json()
      const events = eventsRes.data || eventsRes
      const cats = catsRes.data || catsRes
      setTopEvents(Array.isArray(events) ? events : [])
      setCategories(Array.isArray(cats) ? cats : [])
    } catch (err) {
      console.error('Failed to load event data:', err)
      setLoadError(err instanceof Error ? err.message : 'Failed to load event data')
      setTopEvents([])
      setCategories([])
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
        <div className="h-48 animate-pulse rounded-lg bg-console-panel" />
        <div className="h-32 animate-pulse rounded-lg bg-console-panel" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="rounded-lg bg-console-panel p-8 text-center">
        <p className="mb-4 text-sm text-console-red">{loadError}</p>
        <button
          onClick={() => void loadData()}
          className="rounded bg-console-raise px-3 py-1.5 text-[13px] font-semibold text-console-mut transition-colors hover:text-console-text"
        >
          Retry
        </button>
      </div>
    )
  }

  const totalTicketsSold = categories.reduce((sum, cat) => sum + cat.count, 0)

  return (
    <div className="space-y-4">
      {/* Top Performing Events */}
      <div className="rounded-lg bg-console-panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-console-faint" />
          <h3 className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Top performing events</h3>
        </div>
        {topEvents.length > 0 ? (
          <ul className="divide-y divide-console-raise">
            {topEvents.map((event, index) => (
              <li key={event.id} className="flex items-center gap-3 py-2.5 transition-colors hover:bg-console-raise">
                <span className="w-5 shrink-0 text-center font-mono text-sm tabular-nums text-console-mut">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/events/${event.id}`}
                    className="block truncate text-sm font-medium text-console-text hover:underline"
                  >
                    {event.title}
                  </Link>
                  <div className="mt-0.5 truncate text-xs text-console-mut">
                    <span className="font-mono tabular-nums">{new Date(event.date).toLocaleDateString()}</span> · {event.users?.name || 'Unknown'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded bg-console-raise">
                    <div className="h-full rounded bg-console-mut" style={{ width: `${Math.min(100, event.successScore)}%` }} />
                  </div>
                  <span className="w-10 text-right font-mono text-sm tabular-nums text-console-text">{event.successScore}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="py-8 text-center text-sm text-console-mut">No event data available</div>
        )}
      </div>

      {/* Category Popularity */}
      <div className="rounded-lg bg-console-panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-console-faint" />
          <h3 className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Popular categories · 30d</h3>
        </div>
        {categories.length > 0 ? (
          <div className="space-y-2.5">
            {categories.map((category) => {
              const percentage = totalTicketsSold > 0 ? (category.count / totalTicketsSold) * 100 : 0
              return (
                <div key={category.category} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 truncate text-sm text-console-text">{category.category}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-console-raise">
                    <div className="h-full rounded bg-console-mut transition-all duration-500" style={{ width: `${percentage}%` }} />
                  </div>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-console-mut">{category.count} · {percentage.toFixed(0)}%</span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-console-mut">No category data available</div>
        )}
      </div>
    </div>
  )
}
