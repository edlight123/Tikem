'use client'

import { useTranslation } from 'react-i18next'
import EmptyState from '@/components/EmptyState'
import TicketCard from '../TicketCard'
import { Ticket, TrendingUp, Calendar, Clock } from 'lucide-react'

interface TicketsListClientProps {
  upcomingEvents: Array<{
    event: any
    ticketCount: number
  }>
  pastEvents: Array<{
    event: any
    ticketCount: number
  }>
}

export default function TicketsListClient({ upcomingEvents, pastEvents }: TicketsListClientProps) {
  const { t } = useTranslation('tickets')

  if (!upcomingEvents.length && !pastEvents.length) {
    return (
      <EmptyState
        icon={Ticket}
        title={t('empty.title')}
        description={t('empty.description')}
        actionLabel={t('empty.action')}
        actionHref="/"
        actionIcon={TrendingUp}
      />
    )
  }

  return (
    <div className="space-y-8">
      {/* Upcoming Events */}
      {upcomingEvents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center">
              <Calendar className="w-5 h-5 text-brand-300" />
            </div>
            <div>
              <h2 className="font-display italic text-2xl text-white">{t('upcoming.title')}</h2>
              <p className="text-sm text-white/60">
                {t('upcoming.count', { count: upcomingEvents.length })}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {upcomingEvents.map((item) => {
              const event = item.event
              if (!event || !event.id) return null
              return (
                <TicketCard
                  key={event.id}
                  eventId={event.id}
                  title={event.title}
                  bannerImageUrl={event.banner_image_url}
                  startDatetime={event.start_datetime}
                  venueName={event.venue_name}
                  city={event.city}
                  ticketCount={item.ticketCount}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Past Events */}
      {pastEvents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center">
              <Clock className="w-5 h-5 text-white/60" />
            </div>
            <div>
              <h2 className="font-display italic text-2xl text-white">{t('past.title')}</h2>
              <p className="text-sm text-white/60">
                {t('past.count', { count: pastEvents.length })}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 opacity-75 sm:grid-cols-3 lg:grid-cols-4">
            {pastEvents.map((item) => {
              const event = item.event
              if (!event || !event.id) return null
              return (
                <TicketCard
                  key={event.id}
                  eventId={event.id}
                  title={event.title}
                  bannerImageUrl={event.banner_image_url}
                  startDatetime={event.start_datetime}
                  venueName={event.venue_name}
                  city={event.city}
                  ticketCount={item.ticketCount}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
