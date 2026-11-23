'use client'

import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isPublicHttpsUrl } from '@/lib/import/url'

/**
 * The ticket link of an event kept in sync from Eventbrite
 * (lib/import/eventbrite-sync): tickets stay on Eventbrite, so the event page
 * links out instead of selling. `external_url` is written by the server only
 * (firestore.rules) and re-checked here as a public https link.
 */
export function externalTicketsUrl(event: Record<string, any> | null | undefined): string | null {
  const url = event?.external_url
  if (event?.imported?.source !== 'eventbrite' || typeof url !== 'string' || !isPublicHttpsUrl(url)) return null
  return url
}

export default function ExternalTicketsLink({ url, compact = false }: { url: string; compact?: boolean }) {
  const { t } = useTranslation('common')
  return (
    <div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="flex w-full items-center justify-center gap-2 rounded bg-inverse py-3 font-semibold text-on-inverse transition-colors hover:bg-inverse-hover"
      >
        {t('events.tickets_on_eventbrite')}
        <ArrowUpRight className="h-4 w-4" aria-hidden />
      </a>
      {!compact && <p className="mt-3 text-center text-xs text-fg-subtle">{t('events.tickets_on_eventbrite_note')}</p>}
    </div>
  )
}
