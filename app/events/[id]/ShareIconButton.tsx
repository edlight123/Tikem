'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Share2, Check } from 'lucide-react'

interface ShareIconButtonProps {
  eventId: string
  eventTitle: string
  /** Visual tone: 'light' for dark/hero backgrounds, 'dark' for light surfaces. */
  tone?: 'light' | 'dark'
  className?: string
}

/**
 * Subtle, icon-only share control. Uses the native share sheet when available
 * and falls back to copying the event link to the clipboard.
 */
export default function ShareIconButton({
  eventId,
  eventTitle,
  tone = 'light',
  className = '',
}: ShareIconButtonProps) {
  const { t } = useTranslation('common')
  const [copied, setCopied] = useState(false)

  const eventUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/events/${eventId}` : ''

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: eventTitle, url: eventUrl })
        return
      } catch (error) {
        if ((error as Error).name !== 'AbortError') console.error('Share failed:', error)
      }
    }
    try {
      await navigator.clipboard.writeText(eventUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const toneClasses =
    tone === 'light'
      ? 'text-white ring-1 ring-white/20 hover:bg-white/20 backdrop-blur-md'
      /* Was `bg-white/[0.04] ring-1 ring-gray-200`: a near-WHITE hairline
         around a 4%-opacity disc, sitting on the #0a0a0a sticky bar — so all
         you saw was a bright ring around nothing, the exact pattern the house
         rule forbids. Now a fill, matched to FavoriteButton beside it. */
      : 'bg-white/[0.06] text-white/65 hover:bg-white/[0.12]'

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-label={t('events.share_event')}
      title={copied ? t('events.link_copied') : t('events.share_event')}
      className={`grid h-10 w-10 place-items-center rounded transition-all duration-200 active:scale-90 ${toneClasses} ${className}`}
    >
      {copied ? <Check className="h-[18px] w-[18px]" /> : <Share2 className="h-[18px] w-[18px]" />}
    </button>
  )
}
