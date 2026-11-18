'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertCircle, RefreshCw, Home } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function EventDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { t } = useTranslation('common')
  useEffect(() => {
    console.error('Event detail page error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-surface rounded-2xl p-8 text-center">
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 bg-danger-strong/15 rounded flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-danger" />
          </div>
        </div>
        
        <h1 className="font-display italic lowercase !text-headline !leading-tight text-fg mb-3">
          {t('checkout.error_page_title', { defaultValue: 'Oops! Something went wrong' })}
        </h1>

        <p className="text-fg-muted mb-6">
          {t('checkout.error_page_detail', {
            defaultValue:
              "We're having trouble loading this event. This might be due to a network issue or the event may no longer be available.",
          })}
        </p>

        {error.message && (
          <div className="mb-6 p-4 bg-surface rounded-xl text-left">
            <p className="text-xs text-fg-subtle mb-1">
              {t('checkout.error_details_label', { defaultValue: 'Error details:' })}
            </p>
            <p className="text-sm text-fg-muted font-mono break-all">
              {error.message}
            </p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={reset}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-inverse text-on-inverse font-semibold rounded hover:bg-inverse-hover transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {t('checkout.try_again', { defaultValue: 'Try Again' })}
          </button>

          <Link
            href="/"
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-surface-raised text-fg rounded hover:bg-surface-high transition-colors"
          >
            <Home className="w-4 h-4" />
            {t('checkout.go_home', { defaultValue: 'Go Home' })}
          </Link>
        </div>
      </div>
    </div>
  )
}
