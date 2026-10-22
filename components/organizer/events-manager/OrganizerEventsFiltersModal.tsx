'use client'

import { useTranslation } from 'react-i18next'

import { useState } from 'react'
import { X, Calendar, MapPin, Tag, DollarSign, ArrowUpDown } from 'lucide-react'

export interface EventFilters {
  dateRange: {
    start: string
    end: string
  } | null
  cities: string[]
  categories: string[]
  hasSales: boolean | null
  sortBy: 'date' | 'sales' | 'created' | 'alphabetical'
  sortOrder: 'asc' | 'desc'
}

interface OrganizerEventsFiltersModalProps {
  isOpen: boolean
  onClose: () => void
  filters: EventFilters
  onApplyFilters: (filters: EventFilters) => void
  availableCities: string[]
  availableCategories: string[]
}

export default function OrganizerEventsFiltersModal({
  isOpen,
  onClose,
  filters,
  onApplyFilters,
  availableCities,
  availableCategories
}: OrganizerEventsFiltersModalProps) {
  const { t } = useTranslation('organizer')
  const [localFilters, setLocalFilters] = useState<EventFilters>(filters)

  if (!isOpen) return null

  const handleApply = () => {
    onApplyFilters(localFilters)
    onClose()
  }

  const handleClearAll = () => {
    const clearedFilters: EventFilters = {
      dateRange: null,
      cities: [],
      categories: [],
      hasSales: null,
      sortBy: 'date',
      sortOrder: 'desc'
    }
    setLocalFilters(clearedFilters)
  }

  const toggleCity = (city: string) => {
    setLocalFilters((prev) => ({
      ...prev,
      cities: prev.cities.includes(city)
        ? prev.cities.filter((c) => c !== city)
        : [...prev.cities, city]
    }))
  }

  const toggleCategory = (category: string) => {
    setLocalFilters((prev) => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter((c) => c !== category)
        : [...prev.categories, category]
    }))
  }

  const activeFiltersCount =
    (localFilters.dateRange ? 1 : 0) +
    localFilters.cities.length +
    localFilters.categories.length +
    (localFilters.hasSales !== null ? 1 : 0)

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-2xl z-50 flex flex-col bg-[#111] md:rounded-2xl md:shadow-2xl md:max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-[22px] lowercase italic leading-none">filters</h2>
            {activeFiltersCount > 0 && (
              <span className="rounded bg-white/[0.12] px-2.5 py-1 font-mono text-[13px] font-semibold tabular-nums text-white/80">
                {activeFiltersCount} active
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded bg-white/[0.06] transition-colors hover:bg-white/[0.12]"
            aria-label={t('events_filters.close_filters')}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Date Range */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="w-5 h-5 text-brand-300" />
              <label className="text-sm font-semibold text-white">{t('events_filters.date_range')}</label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-mono uppercase block text-xs text-white/60 mb-1">{t('events_filters.start_date')}</label>
                <input
                  type="date"
                  value={localFilters.dateRange?.start || ''}
                  onChange={(e) =>
                    setLocalFilters((prev) => ({
                      ...prev,
                      dateRange: {
                        start: e.target.value,
                        end: prev.dateRange?.end || ''
                      }
                    }))
                  }
                  className="h-11 w-full rounded bg-white/[0.06] px-3 text-[16px] text-white focus:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/40"
                />
              </div>
              <div>
                <label className="label-mono uppercase block text-xs text-white/60 mb-1">{t('events_filters.end_date')}</label>
                <input
                  type="date"
                  value={localFilters.dateRange?.end || ''}
                  onChange={(e) =>
                    setLocalFilters((prev) => ({
                      ...prev,
                      dateRange: {
                        start: prev.dateRange?.start || '',
                        end: e.target.value
                      }
                    }))
                  }
                  className="h-11 w-full rounded bg-white/[0.06] px-3 text-[16px] text-white focus:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/40"
                />
              </div>
            </div>
            {localFilters.dateRange?.start && (
              <button
                onClick={() => setLocalFilters((prev) => ({ ...prev, dateRange: null }))}
                className="mt-2 text-xs text-brand-300 hover:text-brand-300 font-medium"
              >
                {t('events_filters.clear_date_range')}
              </button>
            )}
          </div>

          {/* Cities */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="w-5 h-5 text-brand-300" />
              <label className="text-sm font-semibold text-white">{t('events_filters.cities')}</label>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableCities.map((city) => {
                const isSelected = localFilters.cities.includes(city)
                return (
                  <button
                    key={city}
                    onClick={() => toggleCity(city)}
                    className={`relative inline-flex items-center rounded px-2.5 py-1.5 text-[13px] font-medium leading-[18px] transition-colors after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-[''] ${
                      isSelected
                        ? 'bg-white text-black'
                        : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
                    }`}
                  >
                    {city}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Categories */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Tag className="w-5 h-5 text-brand-300" />
              <label className="text-sm font-semibold text-white">{t('events_filters.categories')}</label>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableCategories.map((category) => {
                const isSelected = localFilters.categories.includes(category)
                return (
                  <button
                    key={category}
                    onClick={() => toggleCategory(category)}
                    className={`relative inline-flex items-center rounded px-2.5 py-1.5 text-[13px] font-medium leading-[18px] transition-colors after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-[''] ${
                      isSelected
                        ? 'bg-white text-black'
                        : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
                    }`}
                  >
                    {category}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Sales Filter */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-5 h-5 text-brand-300" />
              <label className="text-sm font-semibold text-white">{t('events_filters.sales_status')}</label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setLocalFilters((prev) => ({ ...prev, hasSales: null }))}
                className={`h-11 flex-1 rounded text-[13px] font-medium transition-colors ${
                  localFilters.hasSales === null
                    ? 'bg-white text-black'
                    : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
                }`}
              >
                {t('events_filters.all_events')}
              </button>
              <button
                onClick={() => setLocalFilters((prev) => ({ ...prev, hasSales: true }))}
                className={`h-11 flex-1 rounded text-[13px] font-medium transition-colors ${
                  localFilters.hasSales === true
                    ? 'bg-white text-black'
                    : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
                }`}
              >
                {t('events_filters.has_sales')}
              </button>
              <button
                onClick={() => setLocalFilters((prev) => ({ ...prev, hasSales: false }))}
                className={`h-11 flex-1 rounded text-[13px] font-medium transition-colors ${
                  localFilters.hasSales === false
                    ? 'bg-white text-black'
                    : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
                }`}
              >
                {t('events_filters.no_sales')}
              </button>
            </div>
          </div>

          {/* Sort By */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <ArrowUpDown className="w-5 h-5 text-brand-300" />
              <label className="text-sm font-semibold text-white">{t('events_filters.sort_by')}</label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={localFilters.sortBy}
                onChange={(e) =>
                  setLocalFilters((prev) => ({
                    ...prev,
                    sortBy: e.target.value as EventFilters['sortBy']
                  }))
                }
                className="h-11 rounded bg-white/[0.06] px-3 text-[16px] font-medium text-white focus:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/40"
              >
                <option value="date">{t('events_filters.event_date')}</option>
                <option value="sales">{t('events_filters.ticket_sales')}</option>
                <option value="created">{t('events_filters.date_created')}</option>
                <option value="alphabetical">{t('events_filters.alphabetical')}</option>
              </select>
              <select
                value={localFilters.sortOrder}
                onChange={(e) =>
                  setLocalFilters((prev) => ({
                    ...prev,
                    sortOrder: e.target.value as EventFilters['sortOrder']
                  }))
                }
                className="h-11 rounded bg-white/[0.06] px-3 text-[16px] font-medium text-white focus:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/40"
              >
                <option value="desc">{t('events_filters.descending')}</option>
                <option value="asc">{t('events_filters.ascending')}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-white/[0.04] px-6 py-4">
          <button
            onClick={handleClearAll}
            className="px-4 py-2 text-sm font-medium text-white/70 hover:text-white transition-colors"
          >
            {t('events_filters.clear_all')}
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="h-11 rounded bg-white/[0.08] px-5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.14] hover:text-white"
            >
              {t('actions.cancel')}
            </button>
            <button
              onClick={handleApply}
              className="h-11 rounded bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-white/90"
            >
              {t('events_filters.apply_filters')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
