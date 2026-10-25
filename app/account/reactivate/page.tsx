'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { safeSameOriginPath } from '@/lib/safeUrl'

/**
 * Shown after sign-in when the organizer account is deactivated
 * (lib/account/deactivation.ts). Reactivating republishes exactly the events
 * deactivation took down. "Not now" leaves the account deactivated.
 */
export default function ReactivatePage() {
  const { t } = useTranslation('auth')
  const [state, setState] = useState<'loading' | 'ready' | 'working' | 'error'>('loading')
  const [eventCount, setEventCount] = useState(0)
  const [target, setTarget] = useState('/')

  useEffect(() => {
    const next = safeSameOriginPath(new URLSearchParams(window.location.search).get('redirect'), window.location.origin) || '/'
    setTarget(next)
    fetch('/api/organizer/settings/danger-zone/reactivate', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.deactivated) {
          window.location.replace(next)
          return
        }
        setEventCount(Number(data.eventCount) || 0)
        setState('ready')
      })
      .catch(() => window.location.replace(next))
  }, [])

  async function reactivate() {
    setState('working')
    try {
      const res = await fetch('/api/organizer/settings/danger-zone/reactivate', { method: 'POST' })
      if (!res.ok) throw new Error('failed')
      window.location.href = target === '/' ? '/organizer' : target
    } catch {
      setState('error')
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded bg-white/[0.055] p-6 sm:p-8">
        {state === 'loading' ? (
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-white/50" />
        ) : (
          <>
            <h1 className="font-display lowercase !text-[30px] !leading-none text-white mb-4">{t('reactivate.title')}</h1>
            <p className="text-white/70 mb-3">{t('reactivate.body')}</p>
            <p className="text-white/70 mb-6">
              {eventCount > 0 ? t('reactivate.events_count', { count: eventCount }) : t('reactivate.events_none')}
            </p>
            {state === 'error' && (
              <div role="alert" className="mb-4 rounded bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
                {t('reactivate.failed')}
              </div>
            )}
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={reactivate}
                disabled={state === 'working'}
                className="flex items-center justify-center gap-2 rounded bg-white px-6 py-3 font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50"
              >
                {state === 'working' && <Loader2 className="h-4 w-4 animate-spin" />}
                {state === 'working' ? t('reactivate.submitting') : t('reactivate.submit')}
              </button>
              <a
                href={target}
                className="rounded bg-white/[0.08] px-6 py-3 text-center font-semibold text-white transition-colors hover:bg-white/[0.14]"
              >
                {t('reactivate.later')}
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
