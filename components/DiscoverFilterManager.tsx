'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { DiscoverTopBar } from './discover/DiscoverTopBar'
import { DiscoverFilterChipsStrip } from './discover/DiscoverFilterChipsStrip'
import { FiltersModal } from './FiltersModal'
import type { EventFilters, DEFAULT_FILTERS } from '@/lib/filters/types'
import { parseFiltersFromURL, serializeFilters, resetFilters } from '@/lib/filters/utils'
import { useHeaderCollapse } from '@/lib/hooks/useHeaderCollapse'

interface DiscoverFilterManagerProps {
  userCountry?: string
}

export function DiscoverFilterManager({ userCountry = 'HT' }: DiscoverFilterManagerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  // Parse filters from URL
  const [appliedFilters, setAppliedFilters] = useState<EventFilters>(() => 
    parseFiltersFromURL(searchParams ?? new URLSearchParams())
  )
  const [draftFilters, setDraftFilters] = useState<EventFilters>(appliedFilters)
  const [isModalOpen, setIsModalOpen] = useState(false)

  /**
   * The URL is the source of truth; this state only mirrors it.
   *
   * `appliedFilters` was seeded by a lazy `useState` initializer, which runs
   * ONCE at mount and never again. Every handler in this file happens to set
   * the state and push the URL together, so that was invisible — until you
   * used a control that pushes the URL WITHOUT going through this component.
   * DateChips does exactly that: tapping "Today" calls
   * `router.push('?date=today')` directly, the server re-renders the feed with
   * the new filter, and this state still says `any` — so the results changed
   * while "Any date" stayed the white, selected pill. Reported as: the pill
   * never turns white.
   *
   * Syncing from `searchParams` fixes that class of bug rather than that one
   * control, and it also makes BACK and FORWARD work: those change the URL
   * with no handler of ours involved at all, and previously left every chip
   * showing the filters from whenever the page mounted.
   *
   * Idempotent for our own handlers — they push a URL that parses back to the
   * value they just set. Depending on the STRING, not the object, because a
   * new `URLSearchParams` identity each render would loop.
   */
  const searchParamsKey = searchParams?.toString() ?? ''
  useEffect(() => {
    setAppliedFilters(parseFiltersFromURL(new URLSearchParams(searchParamsKey)))
  }, [searchParamsKey])

  // ---- Hide-on-scroll header -------------------------------------------------
  // The WHOLE header (search + filter button + quick-filter strip) retracts as
  // the reader moves down the feed and slides straight back the moment they
  // scroll up. It used to shed only the chips strip, which left ~64px of
  // permanent chrome above a feed the reader was clearly trying to see.
  //
  // useHeaderCollapse owns the scroll reading: one rAF-throttled listener, an
  // 8px dead zone so a jittery finger cannot flicker it, a 220px threshold so
  // it never hides near the top, no listener at all under
  // prefers-reduced-motion, and a hold while the reader is actively typing in
  // the search field. Everything below layers the two things it cannot know
  // about: whether the page is long enough to be worth reclaiming, and whether
  // focus has landed inside a header that is currently off-screen.
  const headerRef = useRef<HTMLDivElement>(null)
  const collapsed = useHeaderCollapse(headerRef)

  // Never retract on a page that barely scrolls — an "almost one screen" result
  // set (a narrow filter, an empty city) would otherwise lose its search box on
  // the one flick it takes to reach the bottom. Measured rather than assumed,
  // because posters loading in change the page height after hydration.
  const [worthHiding, setWorthHiding] = useState(false)
  useEffect(() => {
    const check = () => {
      // 220px threshold in the hook + a screenful of slack: below this there is
      // nothing meaningful to reclaim.
      setWorthHiding(document.documentElement.scrollHeight - window.innerHeight > 320)
    }
    check()
    window.addEventListener('resize', check)
    // Observing <body> rather than <html>: body's box tracks the content height
    // whatever height rule <html> happens to carry. Re-setting the same boolean
    // is a no-op in React, so this cannot feed itself.
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(check)
      ro.observe(document.body)
    }
    return () => {
      window.removeEventListener('resize', check)
      ro?.disconnect()
    }
  }, [])

  // A retracted header is still in the tab order — that is deliberate, the
  // search must stay reachable — so focus landing inside it has to bring it
  // back, or a keyboard reader ends up typing into something they cannot see.
  // React's focus events bubble, so the wrapper hears every descendant.
  const [focusWithin, setFocusWithin] = useState(false)
  const handleFocus = useCallback(() => setFocusWithin(true), [])
  const handleBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    // Moving between two controls inside the header must not flicker it.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setFocusWithin(false)
  }, [])

  // Don't slide the bar away while a sheet is open inside it.
  //
  // DateChips renders its calendar as a `fixed inset-0` element INSIDE this
  // header instead of portalling it out the way CategoryChips next to it does.
  // This header is ALREADY a containing block for `position: fixed` — not
  // because of the transform below, but because `backdrop-blur-xl` is a
  // backdrop-filter, and a filtered element is a fixed-position containing
  // block. So "inset-0" already means the header's own box rather than the
  // screen, and that sheet is already mispositioned in production. The
  // transform does not make that worse (measured: identical rect with and
  // without it), but retracting a header that CONTAINS an open sheet would
  // carry the sheet off-screen with it, so we simply don't.
  // A MutationObserver rather than props because that sheet's open state lives
  // inside DateChips and never reaches this component.
  const [dialogOpen, setDialogOpen] = useState(false)
  useEffect(() => {
    const el = headerRef.current
    if (!el || typeof MutationObserver === 'undefined') return
    const sync = () => setDialogOpen(!!el.querySelector('[role="dialog"]'))
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [])

  const retracted = collapsed && worthHiding && !focusWithin && !dialogOpen

  const handleOpenFilters = () => {
    setDraftFilters(appliedFilters)
    setIsModalOpen(true)
  }
  
  const handleCloseFilters = () => {
    setDraftFilters(appliedFilters)
    setIsModalOpen(false)
  }
  
  const handleApplyFilters = () => {
    setAppliedFilters(draftFilters)
    setIsModalOpen(false)
    
    const params = serializeFilters(draftFilters)
    const newUrl = params.toString() ? `/discover?${params.toString()}` : '/discover'
    router.push(newUrl, { scroll: false })
  }
  
  const handleResetFilters = () => {
    const reset = resetFilters()
    setDraftFilters(reset)
    setAppliedFilters(reset)
    setIsModalOpen(false)
    router.push('/discover', { scroll: false })
  }
  
  
  return (
    <>
      {/* Sticky discover header: search + location + always-reachable quick filters.
          Pins directly below the navbar (h-14 / sm:h-16). */}
      {/* Same translucency as the navbar above (which renders `flush` on this
          page), so the two bars read as ONE header band.
          NO bottom rule. It used to carry `border-b border-line`, which
          landed a few pixels under the navbar's own edge and read as a seam
          drawn across the page right below the chips. The blurred band plus the
          feed's own top padding separate the two regions on their own. */}
      {/* Retracting by TRANSFORM, not by unmounting or by collapsing height:
          the header keeps its box, so the feed below never reflows and the
          search field keeps its value, its caret and its focus while the bar is
          off-screen. `-100%` is the header's own height (whatever the chip set
          makes it) and --chrome-h is the navbar above it (56 / 64px, the same
          numbers as `top-14 sm:top-16`) — together they carry the whole bar
          past the top of the screen rather than parking it behind a navbar that
          is translucent and would show it through.
          No transform at all in the resting state, so nothing about this header
          changes for anything measuring against it until it actually moves.
          `transform: none` interpolates as the identity matrix, so the
          transition still animates both ways (verified in Chrome; the worst
          case elsewhere is a snap, not a broken layout). */}
      <div
        ref={headerRef}
        data-collapsed={retracted ? 'true' : 'false'}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={{
          transform: retracted
            ? 'translate3d(0, calc(-100% - var(--chrome-h)), 0)'
            : undefined,
        }}
        className="sticky top-14 sm:top-16 z-40 bg-canvas/80 backdrop-blur-xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      >
        <DiscoverTopBar
          filters={appliedFilters}
          onOpenFilters={handleOpenFilters}
          userCountry={userCountry}
        />
        <DiscoverFilterChipsStrip
          currentDate={appliedFilters.date}
          selectedCategories={appliedFilters.categories}
        />
      </div>
      
      {/* The active-filters row used to sit here: a chip repeating the chosen
          filter, plus Clear all. It restated what the pills directly above it
          already show — tapping Today turns that pill white, and the row then
          named Today a second time with its own remove control. Two controls
          for one piece of state, costing ~56px of chrome above the feed.
          Nothing is stranded by removing it: the quick pills unset themselves
          (Any date, or tapping a chosen category again), and anything set
          inside the modal is cleared by the modal's own Reset, still wired to
          handleResetFilters below. */}
      <FiltersModal
        isOpen={isModalOpen}
        draftFilters={draftFilters}
        appliedFilters={appliedFilters}
        onClose={handleCloseFilters}
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
        onDraftChange={setDraftFilters}
        userCountry={userCountry}
      />
    </>
  )
}
