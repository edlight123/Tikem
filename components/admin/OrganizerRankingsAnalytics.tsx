'use client'

import { useCallback, useEffect, useState } from 'react'
import { Crown, Star, Ticket, Calendar } from 'lucide-react'
import Link from 'next/link'

interface OrganizerData {
  id: string
  name: string
  email: string
  created_at: string
  eventsCount: number
  totalTickets: number
  totalFavorites: number
  avgRating: number
}

export function OrganizerRankingsAnalytics() {
  const [organizers, setOrganizers] = useState<OrganizerData[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/admin/analytics-data?type=organizers&limit=10')
      const result = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(result.error || `Failed to load organizer rankings (${res.status})`)
      }
      const organizersData = result.data || result
      setOrganizers(Array.isArray(organizersData) ? organizersData : [])
    } catch (err) {
      console.error('Failed to load organizer rankings:', err)
      setLoadError(err instanceof Error ? err.message : 'Failed to load organizer rankings')
      setOrganizers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  if (loading) {
    return <div className="h-64 animate-pulse rounded-lg bg-console-panel" />
  }

  if (loadError) {
    return (
      <div className="rounded-lg bg-console-panel p-8 text-center">
        <p className="mb-4 text-sm text-console-red">{loadError}</p>
        <button
          onClick={() => void loadData()}
          className="rounded bg-console-raise px-3 py-1.5 text-meta font-semibold text-console-mut transition-colors hover:text-console-text"
        >
          Retry
        </button>
      </div>
    )
  }

  if (organizers.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-console-mut">
        No organizer data available
      </div>
    )
  }

  const ratedCount = organizers.filter((o) => o.avgRating > 0).length
  const avgRating = ratedCount > 0 ? organizers.reduce((sum, o) => sum + o.avgRating, 0) / ratedCount : 0

  return (
    <div className="rounded-lg bg-console-panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <Crown className="h-4 w-4 text-console-faint" />
        <h3 className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">Top organizers</h3>
        <span className="text-xs text-console-mut">· by ticket sales</span>
      </div>

      <ul className="divide-y divide-console-raise">
        {organizers.map((organizer, index) => {
          const rank = index + 1
          const isTopThree = rank <= 3
          return (
            <li key={organizer.id} className="flex items-center gap-3 py-2.5 transition-colors hover:bg-console-raise">
              <span
                className={`w-5 shrink-0 text-center font-mono text-sm tabular-nums ${
                  isTopThree ? 'text-console-amber' : 'text-console-mut'
                }`}
              >
                {rank}
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/organizer/profile/${organizer.id}`}
                  className="block truncate text-sm font-semibold text-console-text hover:underline"
                >
                  {organizer.name}
                </Link>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-console-mut">
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums"><Ticket className="h-3 w-3" />{organizer.totalTickets.toLocaleString()}</span>
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums"><Calendar className="h-3 w-3" />{organizer.eventsCount}</span>
                  {organizer.avgRating > 0 && (
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums"><Star className="h-3 w-3 text-console-amber" />{organizer.avgRating.toFixed(1)}</span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-sm tabular-nums text-console-text">{organizer.totalTickets.toLocaleString()}</div>
                <div className="font-mono text-eyebrow tabular-nums text-console-mut">
                  {organizer.eventsCount > 0 ? `${(organizer.totalTickets / organizer.eventsCount).toFixed(0)}/event` : 'sales'}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {/* Summary */}
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-4 border-t border-console-raise pt-3">
        {[
          { v: organizers.reduce((s, o) => s + o.totalTickets, 0).toLocaleString(), l: 'Tickets sold' },
          { v: organizers.reduce((s, o) => s + o.eventsCount, 0).toLocaleString(), l: 'Events' },
          { v: avgRating > 0 ? avgRating.toFixed(1) : 'N/A', l: 'Avg rating' },
        ].map((s) => (
          <div key={s.l}>
            <div className="label-mono text-eyebrow uppercase tracking-[0.18em] text-console-faint">{s.l}</div>
            <div className="mt-1 font-mono text-xl tabular-nums text-console-text">{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
