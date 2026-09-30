'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AdminEventsTopBar } from '@/components/admin/events/AdminEventsTopBar'
import { AdminEventsFilters } from '@/components/admin/events/AdminEventsFilters'
import { AdminEventsTabs } from '@/components/admin/events/AdminEventsTabs'
import { AdminEventsTable } from '@/components/admin/events/AdminEventsTable'
import { AdminEventDetailSheet } from '@/components/admin/events/AdminEventDetailSheet'
import { ConsoleButton } from '@/components/admin/console'
import { useToast } from '@/components/ui/Toast'
import type { EventModerationTab } from '@/lib/admin/event-moderation'

interface FilterOptions {
  city: string
  category: string
  sortBy: 'newest' | 'soonest'
}

interface AdminEventsModerationConsoleProps {
  userId: string
  userEmail: string
}

export function AdminEventsModerationConsole({ userId, userEmail }: AdminEventsModerationConsoleProps) {
  const { showToast } = useToast()
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [activeTab, setActiveTab] = useState<'pending' | 'published' | 'reported' | 'unpublished'>('published')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedEvent, setSelectedEvent] = useState<any>(null)
  const [events, setEvents] = useState<any[]>([])
  const [counts, setCounts] = useState<Record<EventModerationTab, number>>({
    pending: 0, published: 0, reported: 0, unpublished: 0,
  })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [refined, setRefined] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [filters, setFilters] = useState<FilterOptions>({
    city: '',
    category: '',
    sortBy: 'newest',
  })

  const loadEvents = useCallback(async (searchOverride?: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const response = await fetch('/api/admin/events/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab: activeTab, filters, searchQuery: searchOverride ?? searchQuery }),
      })
      const data = await response.json()
      if (!response.ok || data.error) {
        setLoadError(data.message || data.error || `Failed to load events (${response.status})`)
        setEvents([])
        setHasMore(false)
        setNextCursor(null)
        return
      }
      setEvents(data.events || [])
      if (data.counts) setCounts(data.counts)
      setNextCursor(data.nextCursor || null)
      setHasMore(Boolean(data.hasMore))
      setRefined(Boolean(data.refined))
    } catch (error) {
      console.error('Failed to load events:', error)
      setLoadError(error instanceof Error ? error.message : 'Failed to load events')
      setEvents([])
      setHasMore(false)
      setNextCursor(null)
    } finally {
      setLoading(false)
    }
  }, [activeTab, filters, searchQuery])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const response = await fetch('/api/admin/events/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab: activeTab, filters, searchQuery, cursor: nextCursor }),
      })
      const data = await response.json()
      if (!response.ok || data.error) {
        setLoadError(data.message || data.error || 'Failed to load more events')
        return
      }
      setEvents((prev) => [...prev, ...(data.events || [])])
      setNextCursor(data.nextCursor || null)
      setHasMore(Boolean(data.hasMore))
    } catch (error) {
      console.error('Failed to load more events:', error)
      setLoadError(error instanceof Error ? error.message : 'Failed to load more events')
    } finally {
      setLoadingMore(false)
    }
  }, [activeTab, filters, searchQuery, nextCursor, loadingMore])

  // Reload when tab / filters / search change
  useEffect(() => {
    void loadEvents()
  }, [loadEvents])

  // Deep link from a "content reported" admin notification:
  // /admin/events?tab=reported&event=<id> opens that tab and that event.
  const deepLinkEventRef = useRef<string | null>(null)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const tab = params.get('tab')
      if (tab === 'pending' || tab === 'published' || tab === 'reported' || tab === 'unpublished') {
        setActiveTab(tab)
      }
      deepLinkEventRef.current = params.get('event')
    } catch {
      // no-op: a malformed query string just lands on the default tab
    }
  }, [])
  useEffect(() => {
    const wanted = deepLinkEventRef.current
    if (!wanted || loading) return
    const match = events.find((e) => e.id === wanted)
    if (match) {
      deepLinkEventRef.current = null
      setSelectedEvent(match)
    }
  }, [events, loading])

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    // Debounce search
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }
    searchDebounceRef.current = setTimeout(() => {
      void loadEvents(query)
    }, 300)
  }

  const handleToggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const handleToggleSelectAll = () => {
    if (selectedIds.size === events.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(events.map(e => e.id)))
    }
  }

  const handleBulkAction = async (action: 'publish' | 'unpublish' | 'delete') => {
    try {
      const response = await fetch('/api/admin/events/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventIds: Array.from(selectedIds),
          action,
          adminId: userId,
          adminEmail: userEmail
        })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error((data as any).error || `Action failed (${response.status})`)
      }
      setSelectedIds(new Set())
      void loadEvents()
    } catch (error) {
      console.error('Bulk action failed:', error)
      showToast({
        type: 'error',
        title: 'Action failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleEventAction = async (action: 'publish' | 'unpublish' | 'delete' | 'feature' | 'unfeature', reason?: string) => {
    if (!selectedEvent) return

    try {
      const response = await fetch('/api/admin/events/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: selectedEvent.id,
          action,
          reason,
          adminId: userId,
          adminEmail: userEmail
        })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error((data as any).error || `Action failed (${response.status})`)
      }
      setSelectedEvent(null)
      void loadEvents()
    } catch (error) {
      console.error('Action failed:', error)
      showToast({
        type: 'error',
        title: 'Action failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  // Count active refinement filters (sort is not a filter)
  const activeFiltersCount = [filters.city, filters.category].filter(Boolean).length

  // Tab badges reflect true server-side counts across ALL events, not just the
  // currently loaded page.
  const tabs = [
    { id: 'pending' as const, label: 'Pending Review', count: counts.pending },
    { id: 'published' as const, label: 'Published', count: counts.published },
    { id: 'reported' as const, label: 'Reported', count: counts.reported },
    { id: 'unpublished' as const, label: 'Unpublished', count: counts.unpublished },
  ]

  // The server returns only this tab's events (plus any in-memory
  // city/category/search refinement), so render them directly.
  const filteredEvents = events

  return (
    <div>
      {/* Page Header — aligned with the breadcrumb + content column (matches other admin pages) */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3 pb-2 sm:pt-4 sm:pb-3">
        <h1 className="label-mono text-[15px] font-bold uppercase tracking-[0.14em] text-console-text">
          Events Moderation
        </h1>
        <p className="mt-1 hidden text-[13px] text-console-mut sm:block">
          Review and manage all events on the platform
        </p>
      </div>

      {/* Top Bar */}
      <AdminEventsTopBar
        searchQuery={searchQuery}
        onSearchChange={handleSearch}
        activeFiltersCount={activeFiltersCount}
        onOpenFilters={() => setShowFilters(true)}
        selectedCount={selectedIds.size}
        onBulkAction={handleBulkAction}
      />

      {/* Tabs */}
      <AdminEventsTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={tabs}
      />

      {/* Events Table */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3 pb-6 sm:pt-4">
        {loading ? (
          <div className="bg-console-panel rounded-lg p-12 text-center">
            <p className="text-console-mut">Loading events...</p>
          </div>
        ) : loadError ? (
          <div className="bg-console-panel rounded-lg p-12 text-center">
            <p className="mb-4 text-sm text-console-red">{loadError}</p>
            <ConsoleButton onClick={() => void loadEvents()}>
              Retry
            </ConsoleButton>
          </div>
        ) : (
          <AdminEventsTable
            events={filteredEvents}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
            onRowClick={setSelectedEvent}
          />
        )}

        {!loading && !loadError && filteredEvents.length > 0 && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="label-mono text-sm tabular-nums text-console-mut">
              Showing {filteredEvents.length}
              {refined ? ' matching' : ''} event{filteredEvents.length !== 1 ? 's' : ''} of {counts[activeTab]} in this tab
            </p>
            {hasMore && (
              <ConsoleButton
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </ConsoleButton>
            )}
          </div>
        )}
        {!loading && !loadError && refined && hasMore && (
          <p className="mt-2 text-xs text-console-faint">
            City, category, and search refine only the events loaded so far, load more to search further.
          </p>
        )}
      </div>

      {/* Filters Sheet */}
      <AdminEventsFilters
        isOpen={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        onApply={(newFilters) => {
          setFilters(newFilters)
          void loadEvents()
        }}
      />

      {/* Event Detail Sheet */}
      <AdminEventDetailSheet
        event={selectedEvent}
        isOpen={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onAction={handleEventAction}
        onReportsResolved={() => {
          setSelectedEvent(null)
          void loadEvents()
        }}
      />
    </div>
  )
}
