'use client'

import { useEffect } from 'react'
import { TikemWordmark } from '@/components/ui/TikemLogo'
import StoreBadges from '@/components/ui/StoreBadges'

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
        {/* The wordmark IS the heading: a lone teal dot over a small "get
            tikèm" read as an image that failed to load, and the phone type
            rules flattened the text-5xl heading to body size. */}
        <h1 aria-label="Get Tikèm" className="flex justify-center">
          <TikemWordmark className="text-white" style={{ fontSize: 88 }} />
        </h1>
        <p className="mt-6 text-base text-white/60">
          Discover events, buy tickets, and check in at the door, all from your phone.
        </p>

        <StoreBadges size="lg" className="mt-10" />

        <p className="mt-10 text-sm text-white/40">tikem.co</p>
      </div>
    </main>
  )
}
