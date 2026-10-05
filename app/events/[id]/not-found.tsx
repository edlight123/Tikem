'use client'

import Link from 'next/link'
import { useTranslation } from 'react-i18next'

/**
 * Shown when page.tsx (or generateMetadata) calls notFound(): an unknown id,
 * or a draft viewed by someone other than its organizer. Replaces the framework
 * default so a dead share link still lands somewhere on brand with a way on.
 */
export default function EventNotFound() {
  const { t } = useTranslation('common')

  return (
    <div className="surface-dark flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-md rounded-2xl bg-white/[0.05] p-8 text-center">
        <p className="label-mono mb-3 text-[11px] uppercase tracking-[0.14em] text-white/50">404</p>
        <h1 className="mb-2 font-display !text-[32px] lowercase italic !leading-tight text-white">
          {t('events.not_found_title', { defaultValue: 'Event not found' })}
        </h1>
        <p className="mb-7 text-[15px] text-white/65">
          {t('events.not_found_detail', {
            defaultValue: 'This event may have been removed, or the link is incomplete.',
          })}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/discover"
            className="flex flex-1 items-center justify-center rounded-full bg-white px-6 py-3 text-[15px] font-semibold text-black transition-opacity hover:opacity-90"
          >
            {t('purchase.browse_events', { defaultValue: 'Browse events' })}
          </Link>
          <Link
            href="/"
            className="flex flex-1 items-center justify-center rounded-full bg-white/[0.08] px-6 py-3 text-[15px] font-medium text-white transition-colors hover:bg-white/[0.12]"
          >
            {t('checkout.go_home', { defaultValue: 'Go home' })}
          </Link>
        </div>
      </div>
    </div>
  )
}
