'use client'

/**
 * The organizer's promo video, as a link out.
 *
 * This field has existed in the composer since the beginning and has never
 * appeared on the web event page: `video_url` was missing from the explicit
 * whitelist in lib/data/events.ts, so it reached the mobile app (which reads
 * Firestore directly) and nowhere else. An organizer typed a trailer link and
 * it vanished, unless they happened to look at their own event in the app.
 *
 * A LINK, not an embed, matching mobile's `promoVideoRow`. An iframe would
 * mean allowing YouTube and Vimeo frame sources in an enforcing CSP for the
 * sake of an optional field, and would let an arbitrary organizer-supplied
 * origin render inside the event page. Opening it in a new tab costs one tap
 * and keeps the page's frame ancestry ours.
 */

import { useTranslation } from 'react-i18next'
import { PlayCircle, ExternalLink } from 'lucide-react'
import { safeExternalUrl, externalUrlLabel } from '@/lib/safeUrl'

export default function PromoVideoLink({
  url,
  className = '',
}: {
  url?: string | null
  className?: string
}) {
  const { t } = useTranslation('common')
  // Renders NOTHING for a missing or unsafe link. The value is arbitrary text
  // typed by an organizer, so `javascript:`, `data:` and app deep-links are
  // rejected outright rather than shown as a dead or dangerous anchor.
  const href = safeExternalUrl(url)
  if (!href) return null

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={`flex min-h-11 items-center gap-3 text-body text-brand-400 transition-colors hover:text-brand-300 ${className}`}
    >
      <PlayCircle className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {t('events.watchTrailer', { defaultValue: 'Watch the trailer' })}
        <span className="ml-2 text-fg-subtle">{externalUrlLabel(href)}</span>
      </span>
      <ExternalLink className="h-[15px] w-[15px] shrink-0 text-fg-subtle" aria-hidden />
    </a>
  )
}
