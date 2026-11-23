'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import { EventFilters, DEFAULT_FILTERS } from '@/lib/filters/types'
import { CATEGORIES, PRICE_FILTERS, CITY_CONFIG, formatPriceForCountry } from '@/lib/filters/config'
import { parsePriceRange } from '@/lib/filters/utils'
import { FilterChip } from './FilterChip'
import { format } from 'date-fns'

interface FilterChipsRowProps {
  filters: EventFilters
  onRemoveFilter: (key: keyof EventFilters, value?: string) => void
  onClearAll: () => void
  /** Needed to render a price RANGE in the right currency. */
  userCountry?: string
}

export function FilterChipsRow({ filters, onRemoveFilter, onClearAll, userCountry = 'HT' }: FilterChipsRowProps) {
  const { t } = useTranslation('common')
  const chips: Array<{ key: keyof EventFilters; label: string; value?: string }> = []

  // Date filter
  if (filters.date !== DEFAULT_FILTERS.date) {
    let dateLabel = ''
    switch (filters.date) {
      case 'today': dateLabel = t('filters.today'); break
      case 'tomorrow': dateLabel = t('filters.tomorrow'); break
      case 'this-week': dateLabel = t('filters.this_week'); break
      case 'this-weekend': dateLabel = t('filters.this_weekend'); break
      case 'pick-date': 
        dateLabel = filters.pickedDate ? format(new Date(filters.pickedDate + 'T00:00:00'), 'MMM d, yyyy') : t('filters.pick_date')
        break
    }
    if (dateLabel) {
      chips.push({ key: 'date', label: dateLabel })
    }
  }

  // City filter
  if (filters.city) {
    chips.push({ key: 'city', label: filters.city })
  }

  // Commune filter
  if (filters.commune) {
    const locationLabel = CITY_CONFIG[filters.city]?.type === 'commune' ? t('filters.commune') : t('filters.neighborhood')
    chips.push({ key: 'commune', label: `${locationLabel}: ${filters.commune}` })
  }

  // Category filters
  filters.categories.forEach(category => {
    chips.push({ key: 'categories', label: category, value: category })
  })

  // Price filter. A custom slider range is not in PRICE_FILTERS, so without a
  // range-aware label an applied range rendered NO chip at all — visible in the
  // modal and the URL, but impossible to dismiss from here.
  if (filters.price !== DEFAULT_FILTERS.price) {
    const range = parsePriceRange(filters.price)
    if (range) {
      const from = formatPriceForCountry(range.min, userCountry)
      chips.push({
        key: 'price',
        label:
          range.max === undefined
            ? t('filters.price_and_up', { price: from, defaultValue: `${from} and up` })
            : `${from}, ${formatPriceForCountry(range.max, userCountry)}`,
      })
    } else {
      const priceConfig = PRICE_FILTERS.find(p => p.value === filters.price)
      if (priceConfig) {
        chips.push({ key: 'price', label: priceConfig.label })
      }
    }
  }

  // Event type filter
  if (filters.eventType !== DEFAULT_FILTERS.eventType) {
    const typeLabel = filters.eventType === 'in-person' ? t('filters.in_person') : t('filters.online')
    chips.push({ key: 'eventType', label: typeLabel })
  }

  if (filters.stepFree) chips.push({ key: 'stepFree', label: t('filters.step_free') })

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl  p-3.5 shadow-poster-sm">
      <span className="eyebrow text-eyebrow text-fg-subtle">{t('filters.active_filters')}</span>
      {chips.map((chip, index) => (
        <FilterChip
          key={`${chip.key}-${chip.value || index}`}
          label={chip.label}
          onRemove={() => onRemoveFilter(chip.key, chip.value)}
        />
      ))}
      <button
        onClick={onClearAll}
        className="ml-1 text-sm font-semibold text-brand-400 transition-colors hover:text-brand-300"
      >
        {t('filters.clear_all')}
      </button>
    </div>
  )
}
