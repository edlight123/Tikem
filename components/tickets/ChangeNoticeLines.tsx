'use client'

import { useTranslation } from 'react-i18next'
import { formatEventDateTime } from '@/lib/datetime/eventClock'

type Stamp = {
  at?: string
  kinds?: string[]
  before?: { start?: string | null; venue?: string; city?: string; online?: boolean }
}

/**
 * "Date and time changed · was Sat, May 1, 8:00 PM": shown on the holder's
 * tickets after the organizer moved a live event (events/{id}.change_notice,
 * written by lib/events/change-notices when the holders were told). A dot and a
 * quiet line, no card. Hidden once the event is over.
 */
export function ChangeNoticeLines({ event }: { event: Record<string, any> }) {
  const { t, i18n } = useTranslation('tickets')
  const stamp = (event?.change_notice || null) as Stamp | null
  if (!stamp || !Array.isArray(stamp.kinds) || !stamp.kinds.length) return null
  const ends = Date.parse(String(event.end_datetime || event.start_datetime || ''))
  if (Number.isFinite(ends) && ends < Date.now()) return null

  const before = stamp.before || {}
  const lines: Array<{ key: string; label: string; was: string }> = []
  if (stamp.kinds.includes('when')) {
    const was = before.start
      ? formatEventDateTime(before.start, event, i18n.language, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : ''
    lines.push({ key: 'when', label: t('event_tickets.changed_when'), was })
  }
  if (stamp.kinds.includes('where')) {
    const was = before.online
      ? t('event_tickets.changed_online')
      : [before.venue, before.city].filter(Boolean).join(', ')
    lines.push({ key: 'where', label: t('event_tickets.changed_where'), was })
  }
  if (stamp.kinds.includes('link') && !stamp.kinds.includes('where')) {
    lines.push({ key: 'link', label: t('event_tickets.changed_link'), was: '' })
  }
  if (!lines.length) return null

  return (
    <ul className="mt-3 space-y-1.5" aria-live="polite">
      {lines.map((l) => (
        <li key={l.key} className="flex items-start gap-2 text-caption text-fg-muted">
          <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
          <span className="min-w-0">
            <span className="font-semibold text-fg-soft">{l.label}</span>
            {l.was ? <span> · {t('event_tickets.changed_was', { value: l.was })}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}
