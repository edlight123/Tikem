import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import DownloadLanding from './DownloadLanding'
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/storeLinks'

export const metadata = {
  title: 'Download Tikèm',
  description: 'Get the Tikèm app, discover events, buy tickets, and check in at the door. Available on iPhone and Android.',
  openGraph: {
    title: 'Download Tikèm',
    description: 'Discover events, buy tickets, and check in at the door. Get the app on iPhone and Android.',
    url: 'https://tikem.co/download',
    siteName: 'Tikèm',
  },
}

// Depends on the request User-Agent, so it must never be statically cached —
// otherwise one visitor's device redirect could be served to another.
export const dynamic = 'force-dynamic'

export default async function DownloadPage() {
  const ua = (await headers()).get('user-agent') || ''

  // Phones get sent straight to their store — no interstitial. iPadOS in
  // desktop mode reports a Mac UA and can't be told apart server-side, so it
  // falls through to the landing page (which re-checks on the client).
  if (/iphone|ipod/i.test(ua)) redirect(APP_STORE_URL)
  if (/android/i.test(ua)) redirect(PLAY_STORE_URL)
  if (/ipad/i.test(ua)) redirect(APP_STORE_URL)

  return <DownloadLanding appStoreUrl={APP_STORE_URL} playStoreUrl={PLAY_STORE_URL} />
}
