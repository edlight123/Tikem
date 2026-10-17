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
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white/[0.055] rounded-2xl p-8 text-center">
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 bg-red-500/15 rounded-full flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
        </div>
        
        <h1 className="font-display lowercase !text-[26px] !leading-tight text-white mb-3">
          {t('checkout.error_page_title', { defaultValue: 'Oops! Something went wrong' })}
        </h1>

        <p className="text-white/65 mb-6">
          {t('checkout.error_page_detail', {
            defaultValue:
              "We're having trouble loading this event. This might be due to a network issue or the event may no longer be available.",
          })}
        </p>

        {error.message && (
          <div className="mb-6 p-4 bg-white/[0.055] rounded-xl text-left">
            <p className="text-xs text-white/50 mb-1">
              {t('checkout.error_details_label', { defaultValue: 'Error details:' })}
            </p>
            <p className="text-sm text-white/70 font-mono break-all">
              {error.message}
            </p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={reset}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-white text-black font-semibold rounded-full hover:bg-white/90 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {t('checkout.try_again', { defaultValue: 'Try Again' })}
          </button>

          <Link
            href="/"
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-white/[0.07] text-white rounded-full hover:bg-white/[0.12] transition-colors"
          >
            <Home className="w-4 h-4" />
            {t('checkout.go_home', { defaultValue: 'Go Home' })}
          </Link>
        </div>
      </div>
    </div>
  )
}
