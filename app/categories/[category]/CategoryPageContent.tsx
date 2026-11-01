'use client'

import { DiscoverEventCard } from '@/components/discover/DiscoverEventCard'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Inbox } from 'lucide-react'

interface CategoryPageContentProps {
  category: string
  events: any[]
}

export default function CategoryPageContent({ category, events }: CategoryPageContentProps) {
  const { t } = useTranslation('common')
  const label = t(`categories.${category}`, { defaultValue: category })

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-10">
      {/* Back link */}
      <Link
        href="/"
        className="group mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-white/50 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
        {t('common.back', { defaultValue: 'Back' })}
      </Link>

      {/* Header */}
      <header className="mb-7 md:mb-9">
        <p className="eyebrow text-brand-400">{t('events.eyebrow_browse')}</p>
        <h1 className="mt-1.5 font-display italic text-[clamp(28px,5vw,44px)] leading-[1.02] text-white">
          {label}
        </h1>
        <p className="mt-1.5 text-sm text-white/55 sm:text-[15px]">
          {events.length === 1
            ? t('events.event_found', { count: events.length })
            : t('events.events_found', { count: events.length })}
        </p>
      </header>

      {events.length > 0 ? (
        // One poster grid at every width — a wall of flyers, phone included.
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
          {events.map((event) => (
            <DiscoverEventCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center rounded-3xl  px-6 py-16 text-center shadow-poster-sm sm:py-20">
          <div className="grid h-16 w-16 place-items-center rounded-2xl text-brand-400">
            <Inbox className="h-8 w-8" />
          </div>
          <h3 className="mt-5 font-display italic text-2xl text-white">
            {t('events.no_category_events', { category: label })}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-white/55">
            {t('events.check_back_or_explore')}
          </p>
          <Link
            href="/"
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-700"
          >
            {t('events.all_events')}
          </Link>
        </div>
      )}
    </div>
  )
}
