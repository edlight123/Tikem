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
      <div className="rounded-3xl bg-surface px-6 py-16 text-center sm:py-20">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center text-fg-subtle">
          <MapPin className="h-9 w-9" strokeWidth={1.5} />
        </div>
        <h3 className="mb-3 font-display italic lowercase !text-section !leading-tight text-fg">
          No events in {countryName} yet
        </h3>
        <p className="text-fg-muted mb-8 max-w-md mx-auto px-4">
          We don&apos;t have any upcoming events in {countryName} right now.
          Check back soon or explore events in a different location.
        </p>
        <Link
          href="/profile"
          className="inline-flex items-center gap-2 rounded bg-inverse px-6 py-3 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover"
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
    <div className="rounded-3xl bg-surface px-6 py-20 text-center">
      <h3 className="mb-3 font-display italic lowercase !text-section !leading-tight text-fg">
        {t('events.no_events')}
      </h3>
      <p className="text-fg-muted mb-8">{t('common.try_different_search')}</p>

      <div className="flex flex-wrap justify-center gap-3 max-w-md mx-auto">
        <button
          onClick={() => handleSuggestion('any-date')}
          className="rounded bg-surface-raised px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-high"
        >
          {t('common.show_any_date')}
        </button>
        <button
          onClick={() => handleSuggestion('expand-location')}
          className="rounded bg-surface-raised px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-high"
        >
          {t('common.expand_location')}
        </button>
        <button
          onClick={() => handleSuggestion('online')}
          className="rounded bg-surface-raised px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-high"
        >
          {t('common.show_online_events')}
        </button>
      </div>

      <button
        onClick={() => router.push('/discover')}
        className="mt-8 rounded bg-inverse px-6 py-3 text-sm font-semibold text-on-inverse transition-colors hover:bg-inverse-hover"
      >
        {t('common.clear_all_filters')}
      </button>
    </div>
  )
}
