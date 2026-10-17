'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { MapPin } from 'lucide-react'

interface EmptyStateProps {
  hasFilters: boolean
  countryName?: string
}

export function EmptyState({ hasFilters, countryName = 'your area' }: EmptyStateProps) {
  const router = useRouter()
  const { t } = useTranslation('common')

  if (!hasFilters) {
    // No events in user's country at all
    return (
      <div className="rounded-3xl bg-white/[0.055] px-6 py-16 text-center sm:py-20">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center text-white/45">
          <MapPin className="h-9 w-9" strokeWidth={1.5} />
        </div>
        <h3 className="mb-3 font-display lowercase !text-[22px] !leading-tight text-white">
          No events in {countryName} yet
        </h3>
        <p className="text-white/55 mb-8 max-w-md mx-auto px-4">
          We don&apos;t have any upcoming events in {countryName} right now.
          Check back soon or explore events in a different location.
        </p>
        <Link
          href="/profile"
          className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90"
        >
          <MapPin className="h-4 w-4" />
          Change your location
        </Link>
      </div>
    )
  }

  const handleSuggestion = (action: 'any-date' | 'expand-location' | 'online') => {
    const params = new URLSearchParams(window.location.search)
    
    switch (action) {
      case 'any-date':
        params.delete('date')
        params.delete('pickedDate')
        break
      case 'expand-location':
        params.delete('commune')
        break
      case 'online':
        params.set('eventType', 'online')
        break
    }
    
    router.push(`?${params.toString()}`)
  }

  return (
    <div className="rounded-3xl bg-white/[0.055] px-6 py-20 text-center">
      <h3 className="mb-3 font-display lowercase !text-[22px] !leading-tight text-white">
        {t('events.no_events')}
      </h3>
      <p className="text-white/55 mb-8">{t('common.try_different_search')}</p>

      <div className="flex flex-wrap justify-center gap-3 max-w-md mx-auto">
        <button
          onClick={() => handleSuggestion('any-date')}
          className="rounded-full bg-white/[0.07] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.12]"
        >
          {t('common.show_any_date')}
        </button>
        <button
          onClick={() => handleSuggestion('expand-location')}
          className="rounded-full bg-white/[0.07] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.12]"
        >
          {t('common.expand_location')}
        </button>
        <button
          onClick={() => handleSuggestion('online')}
          className="rounded-full bg-white/[0.07] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.12]"
        >
          {t('common.show_online_events')}
        </button>
      </div>

      <button
        onClick={() => router.push('/discover')}
        className="mt-8 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90"
      >
        {t('common.clear_all_filters')}
      </button>
    </div>
  )
}
