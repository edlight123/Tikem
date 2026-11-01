'use client'

import { useEffect } from 'react'

interface Props {
  appStoreUrl: string
  playStoreUrl: string
}

/**
 * Desktop / unknown-device landing for /download. Phones are already redirected
 * server-side; this covers laptops (show both badges) and the one case the
 * server can't detect — iPadOS in desktop mode, which reports a Mac UA but has
 * a touch screen — where we redirect to the App Store on the client.
 */
export default function DownloadLanding({ appStoreUrl, playStoreUrl }: Props) {
  useEffect(() => {
    const isIpadOS =
      typeof navigator !== 'undefined' &&
      /Macintosh/.test(navigator.userAgent) &&
      navigator.maxTouchPoints > 1
    if (isIpadOS) window.location.replace(appStoreUrl)
  }, [appStoreUrl])

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex justify-center">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: '#14B8A6' }}
            aria-hidden
          />
        </div>

        <h1
          className="font-display italic lowercase text-5xl leading-tight text-white"
        >
          Get Tikèm
        </h1>
        <p className="mt-4 text-base text-white/60">
          Discover events, buy tickets, and check in at the door, all from your phone.
        </p>

        <div className="mt-10 flex flex-col gap-3">
          <a
            href={appStoreUrl}
            className="flex items-center justify-center gap-3 rounded-2xl bg-white px-6 py-4 text-black transition-opacity hover:opacity-90"
            aria-label="Download on the App Store"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M17.05 12.54c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.71-3.19-1.73-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.62 1.11 8.79.73 1.06 1.6 2.25 2.74 2.21 1.1-.05 1.52-.71 2.85-.71 1.33 0 1.71.71 2.88.69 1.19-.02 1.94-1.08 2.67-2.15.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.32-.89-2.34-3.53zM14.88 5.72c.61-.74 1.02-1.77.91-2.8-.88.04-1.94.59-2.57 1.33-.56.65-1.06 1.7-.93 2.7.98.08 1.98-.5 2.59-1.23z" />
            </svg>
            <span className="text-left leading-none">
              <span className="block text-[10px] uppercase tracking-wide text-black/60">Download on the</span>
              <span className="block text-lg font-semibold">App Store</span>
            </span>
          </a>

          <a
            href={playStoreUrl}
            className="flex items-center justify-center gap-3 rounded-2xl bg-white px-6 py-4 text-black transition-opacity hover:opacity-90"
            aria-label="Get it on Google Play"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
              <path d="M3.6 2.3c-.3.2-.5.6-.5 1.1v17.2c0 .5.2.9.5 1.1l.1.1L13 12.6v-.2L3.7 2.2l-.1.1z" fill="#00D3FF" />
              <path d="M16.4 15.8L13 12.6v-.2l3.4-3.2 3.9 2.2c1.1.6 1.1 1.6 0 2.3l-3.9 2.1z" fill="#FFCE00" />
              <path d="M16.4 15.8L13 12.5 3.6 22c.4.3 1 .4 1.6 0l11.2-6.2z" fill="#FF3D44" />
              <path d="M16.4 9.2L5.2 3C4.6 2.6 4 2.7 3.6 3l9.4 9.4 3.4-3.2z" fill="#00F076" />
            </svg>
            <span className="text-left leading-none">
              <span className="block text-[10px] uppercase tracking-wide text-black/60">Get it on</span>
              <span className="block text-lg font-semibold">Google Play</span>
            </span>
          </a>
        </div>

        <p className="mt-10 text-sm text-white/40">tikem.co</p>
      </div>
    </main>
  )
}
