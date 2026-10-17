'use client'

import { useTranslation } from 'react-i18next'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CalendarDays, Users } from 'lucide-react'
import EventStaffManager from '../../events/[id]/staff/EventStaffManager'

type OrganizerEvent = {
  id: string
  title?: string
  start_datetime?: string
  city?: string
  is_published?: boolean
  is_cancelled?: boolean
}

function formatEventLabel(event: OrganizerEvent) {
  const title = event.title || 'Untitled event'
  const date = event.start_datetime ? new Date(event.start_datetime).toLocaleString() : ''
  const city = event.city ? ` • ${event.city}` : ''
  return `${title}${date ? `, ${date}` : ''}${city}`
}

export default function EventStaffHub({
  events,
  initialEventId,
}: {
  events: OrganizerEvent[]
  initialEventId?: string
}) {
  const { t } = useTranslation('organizer')

  const router = useRouter()

  const defaultEventId = useMemo(() => {
    if (initialEventId && events.some((e) => e.id === initialEventId)) return initialEventId
    return events[0]?.id
  }, [events, initialEventId])

  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(defaultEventId)

  useEffect(() => {
    setSelectedEventId(defaultEventId)
  }, [defaultEventId])

  const selectedEvent = useMemo(
    () => (selectedEventId ? events.find((e) => e.id === selectedEventId) : undefined),
    [events, selectedEventId]
  )

  const handleChange = (nextId: string) => {
    setSelectedEventId(nextId)
    router.replace(`/organizer/settings/team?eventId=${encodeURIComponent(nextId)}`)
  }

  if (events.length === 0) {
    return (
      <div className="bg-white/[0.03] rounded-xl  p-10 text-center">
        <CalendarDays className="w-14 h-14 text-white/50 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-white mb-2">{t('actions.no_events_yet')}</h3>
        <p className="text-white/60 mb-6">{t('staff_hub.create_event_to_invite')}</p>
        <Link
          href="/organizer/events/new"
          className="inline-flex items-center gap-2 px-6 py-3 bg-white hover:bg-white/90 text-black font-semibold rounded-full transition-colors"
        >
          {t('actions.create_event')}
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white/[0.03]  rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg text-brand-300 flex items-center justify-center flex-shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="font-display lowercase italic !text-[22px] !leading-snug text-white">{t('staff_hub.select_an_event')}</h2>
                <p className="text-sm text-white/60">{t('staff_hub.staff_per_event')}</p>
              </div>
              <div className="min-w-0">
                <select
                  value={selectedEventId}
                  onChange={(e) => handleChange(e.target.value)}
                  className="w-full sm:w-[420px] px-4 py-3 rounded-[10px] focus:ring-2 focus:ring-brand-500 bg-white/[0.06] text-[16px] text-white placeholder:text-white/35 focus:outline-none"
                >
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {formatEventLabel(e)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedEventId && (
              <div className="mt-3">
                <Link
                  href={`/organizer/events/${selectedEventId}`}
                  className="text-sm font-medium text-brand-300 hover:text-brand-300"
                >
                  View event details →
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedEventId ? (
        <div className="space-y-6">
          <div className="bg-white/[0.03]  rounded-xl p-5">
            <h3 className="text-base font-semibold text-white">{t('staff_hub.managing_staff_for')}</h3>
            <p className="text-sm text-white/60 mt-1">{selectedEvent ? formatEventLabel(selectedEvent) : selectedEventId}</p>
          </div>
          <EventStaffManager eventId={selectedEventId} />
        </div>
      ) : null}
    </div>
  )
}
