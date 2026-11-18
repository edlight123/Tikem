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
      <div className="w-full max-w-md rounded-2xl bg-surface p-8 text-center">
        <p className="label-mono mb-3 text-eyebrow uppercase tracking-[0.14em] text-fg-subtle">404</p>
        <h1 className="mb-2 font-display !text-display lowercase italic !leading-tight text-fg">
          {t('events.not_found_title', { defaultValue: 'Event not found' })}
        </h1>
        <p className="mb-7 text-body text-fg-muted">
          {t('events.not_found_detail', {
            defaultValue: 'This event may have been removed, or the link is incomplete.',
          })}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/discover"
            className="flex flex-1 items-center justify-center rounded bg-inverse px-6 py-3 text-body font-semibold text-on-inverse transition-opacity hover:opacity-90"
          >
            {t('purchase.browse_events', { defaultValue: 'Browse events' })}
          </Link>
          <Link
            href="/"
            className="flex flex-1 items-center justify-center rounded bg-surface-raised px-6 py-3 text-body font-medium text-fg transition-colors hover:bg-surface-high"
          >
            {t('checkout.go_home', { defaultValue: 'Go home' })}
          </Link>
        </div>
      </div>
    </div>
  )
}
