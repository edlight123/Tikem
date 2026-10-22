'use client'

import { DiscoverEventCard } from '@/components/discover/DiscoverEventCard'
import { useEffect, useState } from 'react'
import PullToRefresh from '@/components/PullToRefresh'
import CategoryGrid from '@/components/CategoryGrid'
import type { Database } from '@/types/database'
import { isDemoMode, DEMO_EVENTS } from '@/lib/demo'
import LoadingSkeleton from '@/components/ui/LoadingSkeleton'
import { firebaseDb } from '@/lib/firebase-db/client'
import { coerceEventDate } from '@/lib/discover/helpers'
import { useTranslation } from 'react-i18next'

type Event = Database['public']['Tables']['events']['Row']

interface CategoriesContentProps {
  initialCategory?: string
}

export default function CategoriesContent({ initialCategory }: CategoriesContentProps) {
  const { t } = useTranslation('common')
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)

  const loadEvents = async () => {
    setLoading(true)
    try {
      if (isDemoMode()) {
        setEvents(DEMO_EVENTS as Event[])
      } else {
        // Filter by category server-side, but do the DATE cut in memory: the
        // stored start_datetime is a string on newer docs and a Firestore
        // Timestamp on legacy ones, and a type-sensitive gte-string constraint
        // silently drops every Timestamp doc — including future events.
        let query = firebaseDb
          .from('events')
          .select('*')
          .eq('is_published', true)

        if (initialCategory) {
          query = query.eq('category', initialCategory)
        }

        const { data } = await query.limit(100)

        const now = Date.now()
        const upcoming = (data || [])
          // Normalize both date shapes to ISO strings so the cards (parseISO)
          // and the filters below see one consistent type.
          .map((e: any) => ({
            ...e,
            start_datetime: coerceEventDate(e.start_datetime)?.toISOString() ?? e.start_datetime,
            end_datetime: coerceEventDate(e.end_datetime)?.toISOString() ?? e.end_datetime,
          }))
          .filter((e: any) => {
            const start = coerceEventDate(e.start_datetime)
            const end = coerceEventDate(e.end_datetime)
            if (end) return end.getTime() >= now
            // No end time: keep if it hasn't started, or started < a week ago
            // (could be ongoing) — the same leniency the homepage uses.
            if (start) return start.getTime() >= now - 7 * 24 * 3_600_000
            return true
          })
          .sort((a: any, b: any) => {
            const ta = coerceEventDate(a.start_datetime)?.getTime() ?? Infinity
            const tb = coerceEventDate(b.start_datetime)?.getTime() ?? Infinity
            return ta - tb
          })
          .slice(0, 50)

        setEvents(upcoming as Event[])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEvents()
  }, [])

  const filteredEvents = (initialCategory
    ? events.filter(e => e.category === initialCategory)
    : events
  // Moderation: never surface admin-rejected events (in-memory so legacy docs without the
  // field aren't dropped by a type-sensitive Firestore inequality query).
  ).filter((e: any) => e.rejected !== true)

  return (
    <PullToRefresh onRefresh={loadEvents}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
        <div className="mb-6 md:mb-8">
          {/* Editorial voice: serif lowercase, like every public section header. */}
          <h1 className="font-display lowercase italic !text-[clamp(28px,4.5vw,40px)] !leading-[1.02] text-white/90">
            {t('events.rail_worlds', { defaultValue: 'dekouvri monn ou' })}
          </h1>
          <p className="mt-2 text-[13px] text-white/55 md:text-[15px]">
            {t('events.rail_worlds_desc', {
              defaultValue: 'discover your world: mizik, kilti, espò and more',
            })}
          </p>
        </div>

        {/* Category Grid */}
        <div className="mb-8 md:mb-12">
          <CategoryGrid />
        </div>

        {/* Events in Selected Category */}
        {initialCategory && (
          <div>
            <h2 className="text-xl md:text-2xl font-bold text-white mb-4 md:mb-6 capitalize">
              {t('events.category_events', { category: initialCategory })}
            </h2>
            {loading ? (
              <LoadingSkeleton rows={9} animated tone="dark" />
            ) : filteredEvents.length === 0 ? (
              <div className="text-center py-12 md:py-16 rounded-xl md:rounded-2xl ">
                <div className="inline-flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded mb-3 md:mb-4">
                  <svg className="w-7 h-7 md:w-8 md:h-8 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-base md:text-lg font-semibold text-white mb-2">
                  {t('events.no_category_events', { category: initialCategory })}
                </h3>
                <p className="text-[13px] md:text-base text-white/55">
                  {t('events.check_back_or_explore')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                {filteredEvents.map((event) => (
                  <DiscoverEventCard key={event.id} event={event} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </PullToRefresh>
  )
}
