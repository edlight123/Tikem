/**
 * Discover loading skeleton.
 *
 * This was missing its navbar entirely: /discover renders `<Navbar flush />`
 * itself (the root layout has no nav), so the skeleton started at the filter
 * bar and the whole page slid DOWN by 56px — 64px from sm — the moment the
 * real page painted.
 *
 * Derived geometry, top to bottom:
 *   navbar        h-14 sm:h-16, max-w-7xl px-4 sm:px-6 lg:px-8, NO bottom rule
 *                 (`flush` on this page — the filter header below owns the band)
 *   filter header DiscoverTopBar (pt-3 pb-2) + chips strip (pt-2 pb-3)
 *   feed          max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8
 *
 * `pb-mobile-nav` mirrors the real page's `surface-dark min-h-screen
 * pb-mobile-nav` root.
 */

import { DiscoverFilterBarSkeleton, DiscoverContentSkeleton } from '@/components/discover/DiscoverSkeleton'

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-mobile-nav">
      {/* Navbar. `flush` here, so no bottom hairline. */}
      <div className="sticky top-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between sm:h-16">
            <div className="flex items-center gap-8">
              <div className="skeleton h-7 w-24 rounded" />
              <div className="hidden gap-6 md:flex">
                <div className="skeleton h-4 w-16 rounded" />
                <div className="skeleton h-4 w-16 rounded" />
                <div className="skeleton h-4 w-24 rounded" />
              </div>
            </div>
            <div className="skeleton h-9 w-20 rounded" />
          </div>
        </div>
      </div>

      <DiscoverFilterBarSkeleton />

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <DiscoverContentSkeleton />
      </div>
    </div>
  )
}
