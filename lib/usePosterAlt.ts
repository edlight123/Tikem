'use client'

/**
 * The poster's alt text in the reader's language (lib/posterAlt.ts). Events
 * without a stored timezone (home feed cards) are read in the zone the event
 * happens in (eventZone), the same clock the card's date uses.
 */
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { posterAltText, type PosterAltEvent } from '@/lib/posterAlt'
import { eventZone } from '@/lib/home/feed'

type AltEvent = PosterAltEvent & { country?: unknown }

export function usePosterAlt(): (e: AltEvent | null | undefined) => string {
  const { i18n } = useTranslation()
  const lang = i18n?.language || 'en'
  return useCallback(
    (e) => {
      if (!e) return ''
      const timezone = e.timezone || eventZone(e as { timezone?: unknown; city?: unknown; country?: unknown })
      return posterAltText({ ...e, timezone }, lang)
    },
    [lang]
  )
}
