'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { MapPin, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { getCitiesForCountry, getSubdivisions, getLocationTypeLabel, hasSubdivisions } from '@/lib/filters/config'
import { countActiveFilters } from '@/lib/filters/utils'
import type { EventFilters } from '@/lib/filters/types'
import { SearchSuggest } from '@/components/discover/SearchSuggest'

interface DiscoverTopBarProps {
  filters: EventFilters
  onOpenFilters: () => void
  userCountry?: string
}

export function DiscoverTopBar({ filters, onOpenFilters, userCountry = 'HT' }: DiscoverTopBarProps) {
  const { t } = useTranslation('common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showCityDropdown, setShowCityDropdown] = useState(false)
  const [showSubareaDropdown, setShowSubareaDropdown] = useState(false)

  // Click-outside for the two location menus.
  //
  // These used to be closed by a `fixed inset-0` catcher rendered behind each
  // panel, which has never actually covered the screen here: the sticky
  // discover header carries `backdrop-blur-xl`, and a backdrop-filtered element
  // is a containing block for `position: fixed`, so "inset-0" resolves to the
  // header's own ~116px box — a catcher that misses every click below the bar.
  // The header now also translates on scroll, which would confine it the same
  // way. A document listener depends on neither, and matches how SearchSuggest
  // beside it already closes.
  const cityWrapRef = useRef<HTMLDivElement>(null)
  const subareaWrapRef = useRef<HTMLDivElement>(null)
  const anyDropdownOpen = showCityDropdown || showSubareaDropdown

  useEffect(() => {
    if (!anyDropdownOpen) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (!cityWrapRef.current?.contains(target)) setShowCityDropdown(false)
      if (!subareaWrapRef.current?.contains(target)) setShowSubareaDropdown(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setShowCityDropdown(false)
      setShowSubareaDropdown(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [anyDropdownOpen])

  // Get country-specific cities
  const cities = getCitiesForCountry(userCountry)

  const activeFiltersCount = countActiveFilters(filters)
  const subdivisions = filters.city ? getSubdivisions(filters.city, userCountry) : []
  const locationLabel = filters.city ? getLocationTypeLabel(filters.city, userCountry) : ''
  const hasLocation = hasSubdivisions(filters.city, userCountry)

  // Plain Enter with nothing highlighted in the suggestions — search all.
  // Unchanged behaviour: `?search=` on /discover.
  const handleSearchSubmit = (query: string) => {
    const params = new URLSearchParams(searchParams)
    if (query.trim()) {
      params.set('search', query.trim())
    } else {
      params.delete('search')
    }
    router.push(`/discover?${params.toString()}`, { scroll: false })
  }

  // Field emptied — drop the search param, as before.
  const handleSearchCleared = () => {
    const params = new URLSearchParams(searchParams)
    if (!params.has('search')) return
    params.delete('search')
    router.push(`/discover?${params.toString()}`, { scroll: false })
  }

  const handleCitySelect = (city: string) => {
    const params = new URLSearchParams(searchParams)
    if (city) {
      params.set('city', city)
      params.delete('commune')
    } else {
      params.delete('city')
      params.delete('commune')
    }
    router.push(`?${params.toString()}`)
    setShowCityDropdown(false)
  }

  const handleSubareaSelect = (subarea: string) => {
    const params = new URLSearchParams(searchParams)
    if (subarea) {
      params.set('commune', subarea)
    } else {
      params.delete('commune')
    }
    router.push(`?${params.toString()}`)
    setShowSubareaDropdown(false)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3 pb-2">
      <div className="flex items-center gap-3">
          {/* Search field + autosuggest (events › organizers › people › cities) */}
          <SearchSuggest
            initialQuery={searchParams.get('search') || ''}
            userCountry={userCountry}
            onSubmit={handleSearchSubmit}
            onClear={handleSearchCleared}
            onCitySelect={handleCitySelect}
          />

          {/* Location Pills */}
          <div className="hidden md:flex items-center gap-2">
            {/* City Selector */}
            <div ref={cityWrapRef} className="relative">
              <button
                onClick={() => {
                  setShowSubareaDropdown(false)
                  setShowCityDropdown(!showCityDropdown)
                }}
                className="flex items-center gap-1.5 px-4 py-2 hover:bg-white/15 rounded text-sm font-medium text-white/80 transition-colors"
              >
                <MapPin className="w-4 h-4" />
                {filters.city || t('filters.all_cities')}
                <ChevronDown className="w-4 h-4" />
              </button>

              {showCityDropdown && (
                <div className="absolute top-full mt-2 right-0 bg-[#1a1a1a] rounded-lg shadow-xl py-1 min-w-[180px] z-20">
                  <button
                    onClick={() => handleCitySelect('')}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-white/10 text-white/80"
                  >
                    {t('filters.all_cities')}
                  </button>
                  {cities.map(city => (
                    <button
                      key={city}
                      onClick={() => handleCitySelect(city)}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-white/10 ${
                        filters.city === city ? 'font-medium text-brand-300' : 'text-white/80'
                      }`}
                    >
                      {city}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Subarea Selector */}
            {hasLocation && (
              <div ref={subareaWrapRef} className="relative">
                <button
                  onClick={() => {
                    setShowCityDropdown(false)
                    setShowSubareaDropdown(!showSubareaDropdown)
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 hover:bg-white/15 rounded text-sm font-medium text-white/80 transition-colors"
                >
                  {filters.commune || `${t('filters.all_areas')} ${locationLabel.toLowerCase()}s`}
                  <ChevronDown className="w-4 h-4" />
                </button>

                {showSubareaDropdown && (
                  <div className="absolute top-full mt-2 right-0 bg-[#1a1a1a] rounded-lg shadow-xl py-1 min-w-[180px] z-20">
                    <button
                      onClick={() => handleSubareaSelect('')}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-white/10 text-white/80"
                    >
                      {t('filters.all_areas')} {locationLabel.toLowerCase()}s
                    </button>
                    {subdivisions.map(subarea => (
                      <button
                        key={subarea}
                        onClick={() => handleSubareaSelect(subarea)}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-white/10 ${
                          filters.commune === subarea ? 'font-medium text-brand-300' : 'text-white/80'
                        }`}
                      >
                        {subarea}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Filter Button */}
          {/* Quiet button: a hairline ghost — the active-count badge carries
              the signal, not a teal fill. */}
          <button
            onClick={onOpenFilters}
            // On a phone the label is hidden, leaving a bare icon — so the box
            // has to carry the target: min-h-11 (44px) there, natural above.
            className="flex min-h-11 items-center gap-2 whitespace-nowrap rounded bg-white/[0.07] px-4 py-2.5 text-sm font-normal text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white sm:min-h-0"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="hidden sm:inline">{t('filters.filters')}</span>
            {activeFiltersCount > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-semibold text-black">
                {activeFiltersCount}
              </span>
            )}
          </button>
        </div>
      </div>
  )
}
