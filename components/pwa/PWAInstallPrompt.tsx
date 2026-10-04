"use client"
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'

// Where the "Get the app" button sends people. This points at our internal
// /download route, which sniffs the device and forwards iPhone/Android users
// straight to the right store (App Store / Play Store) and shows a landing
// page everywhere else. The actual store URLs live in app/download/page.tsx
// and are env-overridable (NEXT_PUBLIC_APP_STORE_URL / NEXT_PUBLIC_PLAY_STORE_URL)
// so they can point at a TestFlight/beta page while the public listings roll out.
// TODO: if you ever want this button to skip the interstitial and deep-link
// directly to TestFlight or a store, swap this constant for that URL.
const APP_LINK = '/download'

const DISMISS_KEY = 'tikem-app-cta-dismissed'

export function PWAInstallPrompt() {
  const { t } = useTranslation('common')
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Respect a previous dismissal.
    if (localStorage.getItem(DISMISS_KEY)) return

    // Don't nudge people who are already inside the installed/standalone app.
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    if (isStandalone) return

    // The native app only exists for iPhone/Android, so only nudge those
    // visitors — a "get the mobile app" bar makes no sense on desktop.
    const isMobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent)
    if (!isMobile) return

    setShow(true)
  }, [])

  const dismiss = () => {
    setShow(false)
    localStorage.setItem(DISMISS_KEY, 'true')
  }

  if (!show) return null

  return (
    // Pinned above whatever owns the bottom edge: the signed-in mobile nav
    // stamps --mobile-nav-h (which already includes the home-indicator inset),
    // and with no nav we still clear the inset itself. A filled, blurred
    // surface rather than a hairline box, compact enough to stay one row so
    // it never climbs over the event title on the homepage hero.
    <div
      className="fixed inset-x-3 z-50 mx-auto max-w-md rounded-[22px] bg-[#1c1c1c]/90 backdrop-blur-xl backdrop-saturate-150 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.7)] py-2.5 pl-2.5 pr-1.5 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2"
      style={{ bottom: 'calc(max(var(--mobile-nav-h, 0px), env(safe-area-inset-bottom)) + 10px)' }}
      role="region"
      aria-label={t('app_cta.title')}
    >
      <Image
        src="/app-icon.png"
        alt=""
        width={44}
        height={44}
        className="h-11 w-11 shrink-0 rounded-[10px] ring-1 ring-inset ring-white/10"
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <p className="truncate text-[15px] font-bold leading-tight tracking-[-0.01em] text-white">
          {t('app_cta.title')}
        </p>
        <p className="truncate text-[12px] leading-tight text-white/55 mt-0.5">{t('app_cta.subtitle')}</p>
      </div>
      <a
        href={APP_LINK}
        className="shrink-0 rounded-full bg-white px-4 py-1.5 text-[13px] font-bold text-black hover:opacity-90 transition-opacity"
      >
        {t('app_cta.get')}
      </a>
      <button
        onClick={dismiss}
        aria-label={t('app_cta.dismiss')}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/35 hover:text-white/70 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

export default PWAInstallPrompt
