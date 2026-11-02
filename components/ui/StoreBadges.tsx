'use client'

import { useTranslation } from 'react-i18next'
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/storeLinks'

/**
 * App Store + Google Play buttons. Android is listed first: most of Haiti is
 * on Android, and the site used to link Google Play almost nowhere, which is
 * why the Play listing saw a handful of visitors a month.
 *
 * `lg` is the /download page; `sm` sits in the footer, on event pages and
 * after a purchase. White fills on the dark page, 4px corners (house rule).
 */
export default function StoreBadges({
  size = 'sm',
  className = '',
}: {
  size?: 'sm' | 'lg'
  className?: string
}) {
  const { t } = useTranslation('common')
  const lg = size === 'lg'
  const box = lg
    ? 'flex items-center justify-center gap-3 rounded bg-white px-6 py-4 text-black'
    : 'inline-flex items-center gap-2 rounded bg-white px-3.5 py-2 text-black'
  const icon = lg ? 22 : 18
  const small = lg ? 'text-[10px]' : 'text-[9px]'
  const big = lg ? 'text-lg' : 'text-[14px]'

  const play = (
    <a
      key="play"
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`${box} transition-opacity hover:opacity-90`}
      aria-label={t('store_badges.play_aria', { defaultValue: 'Get it on Google Play' })}
    >
      <svg width={icon} height={icon} viewBox="0 0 24 24" aria-hidden>
        <path d="M3.6 2.3c-.3.2-.5.6-.5 1.1v17.2c0 .5.2.9.5 1.1l.1.1L13 12.6v-.2L3.7 2.2l-.1.1z" fill="#00D3FF" />
        <path d="M16.4 15.8L13 12.6v-.2l3.4-3.2 3.9 2.2c1.1.6 1.1 1.6 0 2.3l-3.9 2.1z" fill="#FFCE00" />
        <path d="M16.4 15.8L13 12.5 3.6 22c.4.3 1 .4 1.6 0l11.2-6.2z" fill="#FF3D44" />
        <path d="M16.4 9.2L5.2 3C4.6 2.6 4 2.7 3.6 3l9.4 9.4 3.4-3.2z" fill="#00F076" />
      </svg>
      <span className="text-left leading-none">
        <span className={`block uppercase tracking-wide text-black/60 ${small}`}>
          {t('store_badges.play_small', { defaultValue: 'Get it on' })}
        </span>
        <span className={`block font-semibold ${big}`}>Google Play</span>
      </span>
    </a>
  )

  const apple = (
    <a
      key="apple"
      href={APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`${box} transition-opacity hover:opacity-90`}
      aria-label={t('store_badges.apple_aria', { defaultValue: 'Download on the App Store' })}
    >
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M17.05 12.54c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.71-3.19-1.73-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.62 1.11 8.79.73 1.06 1.6 2.25 2.74 2.21 1.1-.05 1.52-.71 2.85-.71 1.33 0 1.71.71 2.88.69 1.19-.02 1.94-1.08 2.67-2.15.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.32-.89-2.34-3.53zM14.88 5.72c.61-.74 1.02-1.77.91-2.8-.88.04-1.94.59-2.57 1.33-.56.65-1.06 1.7-.93 2.7.98.08 1.98-.5 2.59-1.23z" />
      </svg>
      <span className="text-left leading-none">
        <span className={`block uppercase tracking-wide text-black/60 ${small}`}>
          {t('store_badges.apple_small', { defaultValue: 'Download on the' })}
        </span>
        <span className={`block font-semibold ${big}`}>App Store</span>
      </span>
    </a>
  )

  return <div className={`${lg ? 'flex flex-col gap-3' : 'flex flex-wrap gap-2'} ${className}`}>{[play, apple]}</div>
}
