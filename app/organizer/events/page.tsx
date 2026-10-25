'use client'

import { useState, useEffect, useMemo } from 'react'
import OrganizerEventsFiltersModal, { type EventFilters } from '@/components/organizer/events-manager/OrganizerEventsFiltersModal'
import OrganizerEventCard from '@/components/organizer/events-manager/OrganizerEventCard'
import CalendarView from '@/components/organizer/events-manager/CalendarView'
import EventCardSkeleton from '@/components/organizer/events-manager/EventCardSkeleton'
import QuickLinksBar from '@/components/organizer/events-manager/QuickLinksBar'
import { PageHeader, FilterBar, FilterChip, OrgEmptyState, SearchInput } from '@/components/organizer/ui'
import { Plus, List, Calendar, SlidersHorizontal, CalendarRange } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isDemoMode, DEMO_EVENTS } from '@/lib/demo'
import { getOrganizerEventsClient } from '@/lib/data/events.client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useOrgClientAuth } from '@/lib/organizer/useOrgClientAuth'
import { useOrgRole } from '@/components/organizer/OrgRoleProvider'

type StatusFilter = 'all' | 'published' | 'draft' | 'past'

export default function OrganizerEventsPage() {
  const { t } = useTranslation('organizer')

  const { firebaseUser, loading: authLoading } = useOrgClientAuth('/organizer/events')
  // The acting org (own, or one this account runs as admin/manager), from the layout.
  const org = useOrgRole()
  const orgId = org?.orgId || ''
  const router = useRouter()
  // No org at all (attendee, or staff-only seats): the upgrade prompt, as before.
  useEffect(() => {
    if (!org) router.replace('/organizer?redirect=/organizer/events')
  }, [org, router])
  
  // State
  const [events, setEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [lastDoc, setLastDoc] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [showFiltersModal, setShowFiltersModal] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(new Date())
  const [filters, setFilters] = useState<EventFilters>({
    dateRange: null,
    cities: [],
    categories: [],
    hasSales: null,
    sortBy: 'date',
    sortOrder: 'desc'
  })

  // Fetch first page of events once authenticated.
  useEffect(() => {
    if (authLoading) return
    if (!firebaseUser || !orgId) return

    let cancelled = false

    const load = async () => {
      try {
        setLoading(true)

        if (isDemoMode()) {
          if (cancelled) return
          setEvents(DEMO_EVENTS)
          setHasMore(false)
          setLastDoc(null)
          return
        }

        const result = await getOrganizerEventsClient(orgId, 50)
        if (cancelled) return

        setEvents(result.data)
        setHasMore(Boolean(result.hasMore))
        setLastDoc(result.lastDoc)
      } catch (error) {
        console.error('Error fetching events:', error)
        if (!cancelled) {
          setEvents([])
          setHasMore(false)
          setLastDoc(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [authLoading, firebaseUser, orgId])

  const handleLoadMore = async () => {
    if (!firebaseUser) return
    if (!hasMore || !lastDoc) return
    if (loadingMore) return

    try {
      setLoadingMore(true)
      const result = await getOrganizerEventsClient(orgId, 50, lastDoc)
      const next = result.data || []

      setEvents((prev) => {
        const existingIds = new Set(prev.map((e: any) => String(e?.id || '')))
        const deduped = next.filter((e: any) => !existingIds.has(String(e?.id || '')))
        return [...prev, ...deduped]
      })

      setHasMore(Boolean(result.hasMore))
      setLastDoc(result.lastDoc)
    } catch (error) {
      console.error('Error loading more events:', error)
    } finally {
      setLoadingMore(false)
    }
  }

  // Filter events by search + advanced filters, then sort.
  const filteredEvents = useMemo(() => {
    let filtered = events.filter((event) => {
      if (!searchQuery) return true

      const searchLower = searchQuery.toLowerCase()
      return (
        event.title?.toLowerCase().includes(searchLower) ||
        event.city?.toLowerCase().includes(searchLower) ||
        event.category?.toLowerCase().includes(searchLower) ||
        event.location_name?.toLowerCase().includes(searchLower)
      )
    })

    // Apply filters
    if (filters.dateRange?.start || filters.dateRange?.end) {
      filtered = filtered.filter((event) => {
        const eventDate = new Date(event.start_datetime)
        if (filters.dateRange?.start && eventDate < new Date(filters.dateRange.start)) {
          return false
        }
        if (filters.dateRange?.end && eventDate > new Date(filters.dateRange.end)) {
          return false
        }
        return true
      })
    }

    if (filters.cities.length > 0) {
      filtered = filtered.filter((event) => filters.cities.includes(event.city))
    }

    if (filters.categories.length > 0) {
      filtered = filtered.filter((event) => filters.categories.includes(event.category))
    }

    if (filters.hasSales === true) {
      filtered = filtered.filter((event) => (event.tickets_sold || 0) > 0)
    } else if (filters.hasSales === false) {
      filtered = filtered.filter((event) => (event.tickets_sold || 0) === 0)
    }

    // Apply sorting
    const sortFn = (a: any, b: any) => {
      let comparison = 0

      switch (filters.sortBy) {
        case 'date':
          comparison = new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
          break
        case 'sales':
          comparison = (a.tickets_sold || 0) - (b.tickets_sold || 0)
          break
        case 'created':
          comparison = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
          break
        case 'alphabetical':
          comparison = (a.title || '').localeCompare(b.title || '')
          break
      }

      return filters.sortOrder === 'asc' ? comparison : -comparison
    }

    return [...filtered].sort(sortFn)
  }, [events, searchQuery, filters])

  // Counts per status chip (All / Published / Draft / Past).
  const statusCounts = useMemo(() => {
    const now = new Date()
    const isPublished = (e: any) => e.is_published && !e.is_cancelled && new Date(e.start_datetime) >= now
    const isDraft = (e: any) => !e.is_published
    const isPast = (e: any) => e.is_published && new Date(e.start_datetime) < now
    return {
      all: filteredEvents.length,
      published: filteredEvents.filter(isPublished).length,
      draft: filteredEvents.filter(isDraft).length,
      past: filteredEvents.filter(isPast).length,
    }
  }, [filteredEvents])

  // Events visible under the current status chip.
  const currentEvents = useMemo(() => {
    if (statusFilter === 'all') return filteredEvents
    const now = new Date()
    return filteredEvents.filter((e) => {
      const start = new Date(e.start_datetime)
      if (statusFilter === 'published') return e.is_published && !e.is_cancelled && start >= now
      if (statusFilter === 'draft') return !e.is_published
      if (statusFilter === 'past') return e.is_published && start < now
      return true
    })
  }, [filteredEvents, statusFilter])

  // Available cities and categories for filters
  const availableCities = useMemo(() => {
    const cities = new Set(events.map((e) => e.city).filter(Boolean))
    return Array.from(cities).sort()
  }, [events])

  const availableCategories = useMemo(() => {
    const categories = new Set(events.map((e) => e.category).filter(Boolean))
    return Array.from(categories).sort()
  }, [events])

  // Count active filters
  const activeFiltersCount =
    (filters.dateRange ? 1 : 0) +
    filters.cities.length +
    filters.categories.length +
    (filters.hasSales !== null ? 1 : 0)

  // Handle filter clear
  const handleClearFilters = () => {
    setFilters({
      dateRange: null,
      cities: [],
      categories: [],
      hasSales: null,
      sortBy: 'date',
      sortOrder: 'desc'
    })
    setSearchQuery('')
    setStatusFilter('all')
  }

  const statusChips: { id: StatusFilter; label: string; count: number }[] = [
    { id: 'all', label: t('events_page.all', 'All'), count: statusCounts.all },
    { id: 'published', label: t('event_card_detail.published', 'Published'), count: statusCounts.published },
    { id: 'draft', label: t('event_card_detail.draft', 'Draft'), count: statusCounts.draft },
    { id: 'past', label: t('events_page.past', 'Past'), count: statusCounts.past },
  ]

  // Show loading state during auth or initial fetch
  if (authLoading || (loading && events.length === 0)) {
    return (
      <div className="min-h-screen bg-[#0a0a0a]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <PageHeader
            eyebrow={t('events_page.eyebrow', 'Organizer')}
            title={t('events_page.title', 'My Events')}
            subtitle={t('events_page.subtitle', 'Create, manage, and track all of your events.')}
          />
          <div className="mt-8 space-y-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <EventCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Redirect if not logged in
  if (!firebaseUser) {
    return null
  }

  const hasSearchOrFilters = Boolean(searchQuery || activeFiltersCount > 0 || statusFilter !== 'all')

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        {/* Header */}
        <PageHeader
          eyebrow={t('events_page.eyebrow', 'Organizer')}
          title={t('events_page.title', 'My Events')}
          subtitle={t('events_page.subtitle', 'Create, manage, and track all of your events.')}
          actions={
            <Link
              href="/organizer/events/new"
              className="inline-flex items-center gap-2 rounded bg-white px-5 py-2.5 font-semibold text-black transition-colors hover:bg-white/90"
            >
              <Plus className="h-5 w-5" />
              <span className="hidden sm:inline">{t('events_page.create_event', 'Create Event')}</span>
            </Link>
          }
        />

        {/* Quick Links */}
        <div className="mt-6">
          <QuickLinksBar />
        </div>

        {/* Controls: search + view toggle + advanced filters */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={t('events_page.search_placeholder', 'Search events…')}
            className="flex-1"
          />

          <div className="flex items-center gap-2">
            {/* View toggle */}
            {/*
              The track was a hairline around `bg-white/[0.03]` — the page's own
              value — so the group read as an empty outline. It is a fill now,
              and each 36px icon button carries a 44px tap box on an ::after.
            */}
            <div className="flex items-center rounded bg-white/[0.06] p-1">
              <button
                type="button"
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
                className={`relative rounded p-2 transition-colors after:absolute after:-inset-[4px] after:content-[''] ${
                  view === 'list' ? 'bg-white text-black' : 'text-white/70 hover:bg-white/[0.12] hover:text-white'
                }`}
                aria-label={t('events_page.list_view', 'List view')}
              >
                <List className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setView('calendar')}
                aria-pressed={view === 'calendar'}
                className={`relative rounded p-2 transition-colors after:absolute after:-inset-[4px] after:content-[''] ${
                  view === 'calendar' ? 'bg-white text-black' : 'text-white/70 hover:bg-white/[0.12] hover:text-white'
                }`}
                aria-label={t('events_page.calendar_view', 'Calendar view')}
              >
                <Calendar className="h-5 w-5" />
              </button>
            </div>

            {/* Advanced filters */}
            <button
              type="button"
              onClick={() => setShowFiltersModal(true)}
              className="relative inline-flex h-11 items-center gap-2 rounded bg-white/[0.06] px-4 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>{t('events_page.filters', 'Filters')}</span>
              {activeFiltersCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-bold text-black">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Status filter chips */}
        <FilterBar className="mt-4">
          {statusChips.map((chip) => (
            <FilterChip
              key={chip.id}
              active={statusFilter === chip.id}
              onClick={() => setStatusFilter(chip.id)}
              count={chip.count}
            >
              {chip.label}
            </FilterChip>
          ))}
        </FilterBar>

        {/* Main Content */}
        <div className="mt-6">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <EventCardSkeleton key={i} />
              ))}
            </div>
          ) : currentEvents.length === 0 ? (
            <OrgEmptyState
              icon={CalendarRange}
              title={
                hasSearchOrFilters
                  ? t('events_page.empty_filtered_title', 'No events match')
                  : t('events_page.empty_title', 'No events yet')
              }
              description={
                hasSearchOrFilters
                  ? (hasMore
                      ? t('events_page.empty_filtered_more_desc', {
                          count: events.length,
                          defaultValue: `No matches in the ${events.length} events loaded so far. Load more to keep searching, or adjust your filters.`,
                        })
                      : t('events_page.empty_filtered_desc', "Try adjusting your search or filters to find what you're looking for."))
                  : t('events_page.empty_desc', 'Create your first event to start selling tickets and tracking sales.')
              }
              action={
                hasSearchOrFilters ? (
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    {hasMore && (
                      <button
                        type="button"
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                        className="inline-flex items-center gap-2 rounded bg-white px-5 py-2.5 font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-60"
                      >
                        {loadingMore ? t('events_page.loading', 'Loading…') : t('events_page.load_more', 'Load more events')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleClearFilters}
                      className="inline-flex items-center gap-2 rounded-lg bg-white/[0.06] px-5 py-2.5 font-semibold text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
                    >
                      {t('events_page.clear_filters', 'Clear filters')}
                    </button>
                  </div>
                ) : (
                  <Link
                    href="/organizer/events/new"
                    className="inline-flex items-center gap-2 rounded bg-white px-6 py-3 font-semibold text-black transition-colors hover:bg-white/90"
                  >
                    <Plus className="h-5 w-5" />
                    {t('events_page.create_event', 'Create Event')}
                  </Link>
                )
              }
            />
          ) : view === 'calendar' ? (
            <CalendarView
              events={currentEvents}
              currentMonth={calendarMonth}
              onMonthChange={setCalendarMonth}
            />
          ) : (
            <>
              <div className="space-y-3">
                {currentEvents.map((event) => (
                  <OrganizerEventCard
                    key={event.id}
                    event={event}
                    showNeedsAttention={statusFilter !== 'past'}
                  />
                ))}
              </div>

              {hasMore && view === 'list' && (
                <div className="mt-8 flex flex-col items-center gap-2">
                  {hasSearchOrFilters && (
                    <p className="text-xs text-white/70">
                      {t('events_page.search_scope_note', {
                        count: events.length,
                        defaultValue: `Search covers the ${events.length} events loaded so far, load more to search further.`,
                      })}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-2 rounded-lg bg-white/[0.06] px-5 py-2.5 font-medium text-white transition-colors hover:bg-white/[0.12] disabled:opacity-60"
                  >
                    {loadingMore ? t('events_page.loading', 'Loading…') : t('events_page.load_more', 'Load more events')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Filters Modal */}
      <OrganizerEventsFiltersModal
        isOpen={showFiltersModal}
        onClose={() => setShowFiltersModal(false)}
        filters={filters}
        onApplyFilters={setFilters}
        availableCities={availableCities}
        availableCategories={availableCategories}
      />
    </div>
  )
}
