import type { MouseEvent } from 'react'

/**
 * Tikèm's Instagram, and a click handler that opens it in the Instagram APP
 * on a phone instead of instagram.com in the browser (where people are not
 * signed in, so "Follow" asks them to log in first and most give up).
 *
 * - Android: an intent: URL aimed at the Instagram package. Chrome opens the
 *   app when it is installed and the `browser_fallback_url` when it is not, so
 *   there is no timer guessing.
 * - iPhone: instagram.com is a universal link Instagram claims. It only opens
 *   the app on a same-tab, user-started navigation, and the default
 *   target="_blank" is what sends it to Safari instead. A custom
 *   `instagram://` scheme is avoided on purpose: without the app installed,
 *   Safari shows an "address is invalid" error.
 * - Desktop: untouched, a new tab.
 *
 * Mirrored in mobile/lib/instagram.ts for the app.
 */
export const INSTAGRAM_URL = 'https://www.instagram.com/tikem.co/'
export const INSTAGRAM_HANDLE = '@tikem.co'

const ANDROID_INTENT =
  'intent://instagram.com/_u/tikem.co/#Intent;package=com.instagram.android;scheme=https;' +
  `S.browser_fallback_url=${encodeURIComponent(INSTAGRAM_URL)};end`

export function instagramPlatform(ua: string): 'android' | 'ios' | 'other' {
  if (/android/i.test(ua)) return 'android'
  // iPadOS reports a Mac user agent; touch points tell them apart.
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  return 'other'
}

export function openInstagram(e: MouseEvent<HTMLAnchorElement>): void {
  if (typeof navigator === 'undefined') return
  const platform = instagramPlatform(navigator.userAgent)
  const ipadOs = platform === 'other' && /macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1
  if (platform === 'other' && !ipadOs) return
  e.preventDefault()
  window.location.href = platform === 'android' ? ANDROID_INTENT : INSTAGRAM_URL
}
