'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { DateFilter } from '@/lib/filters/types'
import { DateChips } from './DateChips'
import { CategoryChips } from './CategoryChips'

interface DiscoverFilterChipsStripProps {
  currentDate: DateFilter
  selectedCategories: string[]
}

/**
 * Compact, horizontally-scrolling strip that keeps the date + category quick
 * filters reachable at all times. Rendered inside the sticky discover header so
 * users can re-filter while scrolling the rails below.
 */
export function DiscoverFilterChipsStrip({
  currentDate,
  selectedCategories,
}: DiscoverFilterChipsStripProps) {
  const { t } = useTranslation('common')

  return (
    <div className="max-w-7xl mx-auto">
      {/* The rail bleeds off the right edge by design — there are more chips
          than a 402px phone can hold. Two details keep that from reading as a
          rendering fault: the trailing spacer lets the last chip scroll clear
          of the edge instead of stopping half-shaved against it, and `pt-2`
          keeps each chip's 44px ::after touch box inside this scroller's
          padding box — 7px of vertical overflow here would turn an
          `overflow-x` rail into one that also scrolls a few pixels vertically.
          `overscroll-x-contain` stops a fling that runs off the end of the rail
          from chaining outward — into the page, or on iOS into the browser's
          own back-swipe. The rail is the reader's, not a gesture handle for
          something else. */}
      <div className="scrollbar-hide flex items-center gap-3 overflow-x-auto overscroll-x-contain px-4 pb-3 pt-2 sm:px-6 lg:px-8">
        <span className="sr-only">{t('common.when')}</span>
        <DateChips currentDate={currentDate} bare />
        <div className="h-5 w-px shrink-0 bg-surface-raised" aria-hidden="true" />
        <span className="sr-only">{t('common.categories')}</span>
        <CategoryChips selectedCategories={selectedCategories} bare />
        <span className="w-1 shrink-0" aria-hidden="true" />
      </div>
    </div>
  )
}
