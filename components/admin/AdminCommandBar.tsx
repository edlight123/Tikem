'use client'

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Bell, Calendar, Loader2, MapPin, DollarSign, User } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAdminPendingCount } from '@/lib/realtime/AdminRealtimeProvider'

interface AdminCommandBarProps {
  // Props removed - will fetch client-side
}

interface SearchResult {
  id: string
  type: 'event' | 'user' | 'order'
  title: string
  subtitle?: string
  href: string
  metadata?: {
    status?: string
    price?: number
    currency?: string
    city?: string
  }
}

export function AdminCommandBar({}: AdminCommandBarProps) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  // Single source of truth: the AdminRealtimeProvider (10s poll) feeds the
  // combined "needs attention" figure — no independent polling here.
  const { total: pendingTotal } = useAdminPendingCount()
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [showResults, setShowResults] = useState(false)

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      setShowResults(false)
      return
    }

    const timer = setTimeout(async () => {
      setIsSearching(true)
      setShowResults(true)
      
      try {
        const response = await fetch('/api/admin/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: searchQuery.trim() })
        })

        if (response.ok) {
          const data = await response.json()
          setSearchResults(data.results || [])
        } else {
          setSearchResults([])
        }
      } catch (error) {
        console.error('Search error:', error)
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleResultClick = (href: string) => {
    setSearchQuery('')
    setShowResults(false)
    router.push(href)
  }

  return (
    // top-0, not top-14: the 14 cleared the old admin top nav, which the rail
    // replaced — left as-was, the bar stuck 56px down with content sliding
    // through the gap above it.
    <div className="sticky top-0 z-30 bg-console-ground">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex items-center gap-4">
          {/* Search */}
          <div className="flex-1 max-w-2xl relative">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-console-mut" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchQuery && setShowResults(true)}
                onBlur={() => setTimeout(() => setShowResults(false), 200)}
                placeholder={t('nav.search_placeholder')}
                className="w-full rounded bg-console-panel py-2 pl-10 pr-10 text-sm text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut"
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-console-mut animate-spin" />
              )}
            </div>
            
            {/* Search Results Dropdown */}
            {showResults && searchQuery && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-console-raise rounded-lg shadow-xl max-h-96 overflow-y-auto z-50">
                {isSearching ? (
                  <div className="p-8 text-center">
                    <Loader2 className="w-6 h-6 text-console-mut animate-spin mx-auto mb-2" />
                    <p className="text-sm text-console-mut">Searching...</p>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="p-8 text-center">
                    <Search className="w-8 h-8 text-console-mut mx-auto mb-2" />
                    <p className="text-sm text-console-mut">No results found</p>
                    <p className="text-xs text-console-mut mt-1">Try a different search term</p>
                  </div>
                ) : (
                  <div className="py-2">
                    {searchResults.map((result) => (
                      <button
                        key={`${result.type}-${result.id}`}
                        onClick={() => handleResultClick(result.href)}
                        className="w-full px-4 py-3 hover:bg-console-panel transition-colors flex items-start gap-3 text-left"
                      >
                        {/* Icon */}
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          result.type === 'event' ? '' :
                          result.type === 'user' ? '' :
                          ''
                        }`}>
                          {result.type === 'event' ? (
                            <Calendar className="w-4 h-4 text-console-mut" />
                          ) : result.type === 'user' ? (
                            <User className="w-4 h-4 text-console-mut" />
                          ) : (
                            <DollarSign className="w-4 h-4 text-console-green" />
                          )}
                        </div>
                        
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-console-text truncate">{result.title}</p>
                            {result.metadata?.status && (
                              <span className={`label-mono uppercase px-2 py-0.5 text-xs font-medium rounded ${
                                result.metadata.status === 'published' || result.metadata.status === 'confirmed' ? 'text-console-green' :
                                result.metadata.status === 'draft' || result.metadata.status === 'pending' ? 'text-console-amber' :
                                'text-console-mut'
                              }`}>
                                {result.metadata.status}
                              </span>
                            )}
                          </div>
                          {result.subtitle && (
                            <p className="text-sm text-console-mut truncate">{result.subtitle}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1">
                            <span className="label-mono uppercase text-xs text-console-mut">{result.type}</span>
                            {result.metadata?.city && (
                              <span className="flex items-center gap-1 text-xs text-console-mut">
                                <MapPin className="w-3 h-3" />
                                {result.metadata.city}
                              </span>
                            )}
                            {result.metadata?.price !== undefined && (
                              <span className="font-mono tabular-nums text-xs text-console-mut">
                                {result.metadata.price === 0 ? 'Free' : `${result.metadata.price} ${result.metadata.currency || 'HTG'}`}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick-nav links removed — they duplicated the left sidebar.
              The top bar is now just global search + the alerts status badge. */}

          {/* Alerts Badge */}
          {pendingTotal > 0 && (
            <Link
              href="/admin/trust"
              className="relative flex items-center gap-2 px-3 py-2 text-console-amber rounded hover:bg-console-panel transition-colors"
            >
              <Bell className="w-4 h-4" />
              <span className="label-mono absolute -top-1 -right-1 w-5 h-5 bg-console-red text-console-ground text-eyebrow font-bold rounded-full flex items-center justify-center tabular-nums">
                {pendingTotal > 9 ? '9+' : pendingTotal}
              </span>
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
