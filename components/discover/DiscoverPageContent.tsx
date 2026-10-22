'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { EmptyState } from './EmptyState'
import { DiscoverEventCard } from './DiscoverEventCard'
import { FriendsGoingProvider } from './FriendsGoingContext'
import { LOCATION_CONFIG } from '@/lib/filters/config'

interface DiscoverPageContentProps {
  hasActiveFilters: boolean
  featuredEvents: any[]
  upcomingEvents: any[]
  countryEvents: any[]
  nearYouEvents: any[]
  budgetEvents: any[]
  onlineEvents: any[]
  filteredEvents: any[]
  city?: string
  commune?: string
  userCountry?: string
  userId?: string
}

type DiscoverTab = 'forYou' | 'saved'

/**
 * Web Discover mirrors the mobile app: a single-column feed with For You /
 * Saved tabs (no hero, no multi-column grid). The filter bar above
 * (DiscoverFilterManager) drives the For You feed.
 */
export function DiscoverPageContent({
  hasActiveFilters,
  filteredEvents,
  userCountry = 'HT',
  userId,
}: DiscoverPageContentProps) {
  const { t } = useTranslation('common')
  const countryName = LOCATION_CONFIG[userCountry]?.name || 'Haiti'
  const [tab, setTab] = useState<DiscoverTab>('forYou')
  const [savedEvents, setSavedEvents] = useState<any[] | null>(null)

  // De-dupe the feed.
  const feed = useMemo(() => {
    const seen = new Set<string>()
    const out: any[] = []
    for (const e of filteredEvents || []) {
      if (e?.id && !seen.has(e.id)) {
        seen.add(e.id)
        out.push(e)
      }
    }
    return out
  }, [filteredEvents])

  // Saved tab — intersect the user's favorites with the loaded events.
  //
  // BUNDLE: Firestore is fetched inside this effect rather than imported at
  // module scope. A static import put the whole Firebase client — 444KB across
  // three chunks (223 + 136 + 85) out of ~988KB of shared JS — on /discover's
  // first load, for every visitor, even though the only read here happens after
  // a signed-in reader taps "Saved". A route only sheds those chunks when its
  // LAST static importer goes, so please don't hoist this back up.
  //
  // The `active` flag already existed to guard the setState; it now also covers
  // the chunk fetch, so switching tabs (or React 18 StrictMode's double-invoke
  // in dev) can't land a stale result. One-shot getDocs — no listener, nothing
  // to unsubscribe.
  useEffect(() => {
    if (tab !== 'saved' || !userId) return
    let active = true
    ;(async () => {
      try {
        const [{ collection, getDocs, query, where }, { db }] = await Promise.all([
          import('firebase/firestore'),
          import('@/lib/firebase/client'),
        ])
        if (!active) return
        const favs = await getDocs(
          query(collection(db, 'event_favorites'), where('user_id', '==', userId))
        )
        const ids = new Set(favs.docs.map((d) => d.data().event_id))
        if (active) setSavedEvents(feed.filter((e) => ids.has(e.id)))
      } catch {
        if (active) setSavedEvents([])
      }
    })()
    return () => {
      active = false
    }
  }, [tab, userId, feed])

  const allEventIds = useMemo(() => feed.map((e) => e.id).filter(Boolean), [feed])

  const tabs: { key: DiscoverTab; label: string }[] = [
    { key: 'forYou', label: t('discover.for_you', 'For You') },
    { key: 'saved', label: t('discover.saved', 'Saved') },
  ]

  // One column on a phone, which is what the header comment above always
  // claimed and what the app actually does. Two columns at 390px gave each card
  // ~170px, and at that width the venue AND the date both truncated on every
  // card — "Karibe Convention Ce…", "· Sep…" — so the feed hid the two facts a
  // person scans for. Full width also lets the poster carry the card, which is
  // the point of a poster. Two-up returns at 420px, where the metadata fits.
  const renderFeed = (list: any[]) =>
    list.length > 0 ? (
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 lg:gap-6">
        {list.map((event) => (
          <DiscoverEventCard key={event.id} event={event} />
        ))}
      </div>
    ) : null

  return (
    <FriendsGoingProvider eventIds={allEventIds}>
      {/* Tabs — the active underline marks the selection; no full-width rule,
          the sticky filter header above already draws one. */}
      <div className="mb-6 flex items-end justify-between">
        <div className="flex items-center gap-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              // 44px tall on a phone. These were 31px — the smallest tap
              // target on the page and the one that switches the whole feed.
              // The underline still sits on the text's own baseline, so the
              // bigger box costs nothing visually.
              className={`relative inline-flex min-h-11 items-end pb-2 text-[15px] font-medium transition-colors sm:min-h-0 ${
                tab === t.key ? 'text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              {t.label}
              {tab === t.key && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded bg-brand-400" />}
            </button>
          ))}
        </div>
        {tab === 'forYou' && feed.length > 0 && (
          <span className="hidden pb-2 text-sm text-white/70 sm:block">
            {feed.length} event{feed.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* For You */}
      {tab === 'forYou' &&
        (feed.length > 0 ? (
          renderFeed(feed)
        ) : (
          <EmptyState hasFilters={hasActiveFilters} countryName={countryName} />
        ))}

      {/* Saved */}
      {tab === 'saved' &&
        (!userId ? (
          <div className="mx-auto max-w-2xl rounded-2xl bg-white/[0.055] py-16 text-center text-white/70">
            <Link href="/auth/login?redirect=/discover" className="font-semibold text-brand-300 hover:text-brand-200">
              {t('discover.sign_in', 'Sign in')}
            </Link>{' '}
            {t('discover.sign_in_desc', "to see events you've saved.")}
          </div>
        ) : savedEvents === null ? (
          <div className="mx-auto max-w-2xl py-16 text-center text-white/70">{t('discover.loading_saved', 'Loading saved events…')}</div>
        ) : savedEvents.length > 0 ? (
          renderFeed(savedEvents)
        ) : (
          <div className="mx-auto max-w-2xl rounded-2xl bg-white/[0.055] py-16 text-center">
            <Search className="mx-auto mb-3 h-8 w-8 text-white/30" />
            <p className="text-white/70">{t('discover.no_saved_title', 'No saved events yet')}</p>
            <p className="mt-1 text-sm text-white/70">{t('discover.no_saved_desc', 'Tap the bookmark on any event to save it here.')}</p>
          </div>
        ))}
    </FriendsGoingProvider>
  )
}
