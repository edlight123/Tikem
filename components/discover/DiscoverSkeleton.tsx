import React from 'react'

/**
 * Discover loading skeletons.
 *
 * Rebuilt against the live page, because these had drifted badly:
 *
 *  - DiscoverContentSkeleton still drew the OLD discover — a three-up featured
 *    grid followed by three horizontal poster rails. DiscoverPageContent's own
 *    header comment now says the opposite in words: "a single-column feed with
 *    For You / Saved tabs (no hero, no multi-column grid)". So every navigation
 *    to /discover painted rails and then threw them away.
 *  - The card placeholder had NO fill on the poster at all — just two
 *    `bg-white/15` bars floating in an empty box — and the rail headings used
 *    bare `rounded` divs with no background class whatsoever, which on a
 *    #0a0a0a page renders literally nothing.
 *  - Everything used `animate-pulse`, which fades a whole block in and out and
 *    reads as flicker rather than as loading.
 *
 * Everything below uses `.skeleton` (app/globals.css): a left-to-right sweep
 * over a baked-in rgba(255,255,255,0.06) base, still under
 * prefers-reduced-motion.
 *
 * Geometry derived from the real markup:
 *   header row 1  DiscoverTopBar — max-w-7xl · px-4 sm:px-6 lg:px-8 · pt-3 pb-2
 *                 search: `relative flex-1`, input py-2.5 + 1px border + 16px
 *                 text ≈ 41px · two location pills py-2 rounded, md and up
 *                 only · filter button min-h-11 (44px) with its label hidden
 *                 below sm, so ~56px wide on a phone and ~100px from sm
 *   header row 2  DiscoverFilterChipsStrip — px-4 pb-3 pt-2 sm:px-6 lg:px-8,
 *                 chips 30px tall and rounded, with a h-5 w-px divider
 *                 between the date set and the category set
 *   feed          tabs row mb-6 (buttons min-h-11 on a phone, pb-2) then
 *                 grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3
 *                 xl:grid-cols-4 lg:gap-6 of PosterCard: aspect-[4/5] rounded,
 *                 then px-0.5 pt-2.5 title (15px) · mt-1 meta · mt-1 price
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

/** Single event card placeholder, matching DiscoverEventCard → PosterCard. */
export function EventCardSkeleton() {
  return (
    <div>
      {/* The house poster shape. A 16:9 here would jump on every card. */}
      <div className="skeleton aspect-[4/5] w-full rounded" />
      <div className="px-0.5 pt-2.5">
        <Bar className="h-[15px] w-3/4" />
        <Bar className="mt-1 h-[13px] w-1/2" />
        <Bar className="mt-1 h-[13px] w-16" />
      </div>
    </div>
  )
}

/**
 * Section header + a horizontal row of card placeholders.
 *
 * Kept only because it is an exported name; /discover no longer renders rails.
 * Nothing in the app imports it today.
 */
export function EventRailSkeleton({ cards = 5 }: { cards?: number }) {
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <Bar className="h-7 w-48" />
          <Bar className="h-4 w-64" />
        </div>
        <Bar className="hidden h-5 w-16 sm:block" />
      </div>
      <div className="-mx-4 flex gap-4 overflow-hidden px-4 sm:mx-0 sm:px-0">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="w-[260px] shrink-0 sm:w-[280px] lg:w-[300px]">
            <EventCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Placeholder for the sticky discover header (search row + quick-filter strip). */
export function DiscoverFilterBarSkeleton() {
  return (
    // No fill and no bottom rule: the real header is a transparent blurred
    // band with no hairline, and a bordered grey block here flashed a line
    // across the page for the first paint.
    <div>
      <div className="mx-auto max-w-7xl px-4 pb-2 pt-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          {/* search field */}
          <Bar className="h-[41px] flex-1 rounded-lg" />
          {/* the two location pills — md and up, as in DiscoverTopBar */}
          <Bar className="hidden h-9 w-28 rounded md:block" />
          <Bar className="hidden h-9 w-32 rounded md:block" />
          {/* filter button: icon only on a phone, icon + label from sm */}
          <Bar className="h-11 w-14 shrink-0 rounded-lg sm:w-[100px]" />
        </div>
      </div>
      <div className="mx-auto max-w-7xl">
        <div className="flex items-center gap-3 overflow-hidden px-4 pb-3 pt-2 sm:px-6 lg:px-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <Bar key={i} className="h-[30px] w-16 shrink-0 rounded" />
          ))}
          <div className="h-5 w-px shrink-0 bg-white/10" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Bar key={i} className="h-[30px] w-20 shrink-0 rounded" />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Full discover content placeholder: the For You / Saved tabs + one feed grid. */
export function DiscoverContentSkeleton() {
  return (
    <div>
      {/* Tabs. 44px tall on a phone (min-h-11 on the real buttons), text-sized
          from sm, with the count on the right from sm only. */}
      <div className="mb-6 flex items-end justify-between">
        <div className="flex items-center gap-6">
          <Bar className="h-9 w-20 sm:h-6" />
          <Bar className="h-9 w-16 sm:h-6" />
        </div>
        <Bar className="hidden h-4 w-16 sm:block" />
      </div>

      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3 lg:gap-6 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <EventCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

/** Legacy combined skeleton (kept for compatibility). */
export function DiscoverSkeleton() {
  return (
    <div className="space-y-8">
      <DiscoverFilterBarSkeleton />
      <DiscoverContentSkeleton />
    </div>
  )
}
