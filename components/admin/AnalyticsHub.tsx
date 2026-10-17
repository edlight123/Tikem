'use client'

// The analytics LANDING: the live scorecard plus a drill-down index — one card
// per analytics area, each its own page under /admin/analytics/[section].
// Replaces the old single-page tab stack whose Overview rendered every module
// at once (owner call, 2026-08-29: "cramps a lot of info together").

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { useAdminMetrics } from '@/lib/realtime/AdminRealtimeProvider'
import { EMPTY_VALUE } from '@/lib/format'

const fmtNum = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)
const fmtHTG = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`

export function HeroScorecard() {
  const { metrics, isConnected } = useAdminMetrics()
  const m = metrics

  const cells = [
    { label: 'Total users', value: m ? fmtNum(m.usersCount) : EMPTY_VALUE },
    { label: 'Active events', value: m ? fmtNum(m.eventsCount) : EMPTY_VALUE },
    { label: 'Tickets · 7d', value: m ? fmtNum(m.tickets7d) : EMPTY_VALUE },
    { label: 'Revenue · 7d', value: m ? fmtHTG(m.gmv7d) : EMPTY_VALUE, sub: 'HTG' },
    { label: 'Refunds · 7d', value: m ? fmtNum(m.refunds7d) : EMPTY_VALUE },
    { label: 'Pending', value: m ? fmtNum(m.pendingCount) : EMPTY_VALUE },
  ]

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-console-green' : 'bg-console-faint'}`} />
        <span className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">
          {isConnected ? 'Live' : 'Snapshot'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-4">
        {cells.map((c) => (
          <div key={c.label}>
            <div className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">{c.label}</div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="font-mono text-xl tabular-nums text-console-text">{c.value}</span>
              {c.sub && <span className="font-mono text-xs text-console-mut">{c.sub}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export const ANALYTICS_SECTIONS = [
  { id: 'revenue', label: 'Revenue', blurb: 'Gross sales, payment methods, currencies & FX' },
  { id: 'users', label: 'User growth', blurb: 'Signups, organizers and verification over time' },
  { id: 'events', label: 'Event performance', blurb: 'Top events by tickets sold and sell-through' },
  { id: 'conversion', label: 'Conversion funnel', blurb: 'Page views → checkout → completed orders' },
  { id: 'organizers', label: 'Organizer rankings', blurb: 'Best-performing organizers by revenue' },
] as const

function AnalyticsHubInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Back-compat: the old single-page UI used ?tab= — forward old links/bookmarks
  // to the section's own page.
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && ANALYTICS_SECTIONS.some((s) => s.id === tab)) {
      router.replace(`/admin/analytics/${tab}`)
    }
  }, [searchParams, router])

  return (
    <div className="space-y-8">
      <HeroScorecard />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ANALYTICS_SECTIONS.map((s) => (
          <Link
            key={s.id}
            href={`/admin/analytics/${s.id}`}
            className="group rounded-lg bg-console-panel p-4 transition-colors hover:bg-console-raise focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="label-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-console-text">
                {s.label}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-console-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-console-text" />
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-console-mut">{s.blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function AnalyticsHub() {
  // useSearchParams requires a Suspense boundary during static prerender.
  return (
    <Suspense fallback={<HeroScorecard />}>
      <AnalyticsHubInner />
    </Suspense>
  )
}
