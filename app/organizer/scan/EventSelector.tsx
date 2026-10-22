'use client'

import { useTranslation } from 'react-i18next'

import { format, isValid } from 'date-fns'
import Link from 'next/link'
import Image from 'next/image'
import { QrCode, Calendar, CalendarDays, MapPin } from 'lucide-react'
import { getPosterTheme } from '@/lib/posterGradient'

interface EventSelectorProps {
  events: any[]
  organizerId: string
}

/** Poster-led scan card — mirrors the home / discover / organizer event cards. */
function ScanEventCard({ event, badge }: { event: any; badge?: { label: string; tone: 'today' | 'past' } }) {
  const hasImage = Boolean(event.banner_image_url)
  const theme = getPosterTheme(event.id || event.title, event.category)
  const d = event.start_datetime ? new Date(event.start_datetime) : null
  const dateLabel = d && isValid(d) ? format(d, 'EEE, MMM d · h:mm a') : 'Date TBA'
  const location = [event.venue_name, event.city].filter(Boolean).join(', ')
  const ticketsSold = event.tickets_sold || 0

  return (
    <Link href={`/organizer/scan/${event.id}`} prefetch className="group block h-full">
      <article className="hover-lift h-full overflow-hidden rounded-2xl bg-white/[0.055] shadow-poster-sm transition-all duration-300 group-hover:bg-white/[0.08] group-hover:shadow-card-hover">
        {/* ---------- Poster ---------- */}
        <div
          className="poster-vignette relative flex aspect-[4/5] flex-col justify-between overflow-hidden p-3.5 text-white"
          style={hasImage ? undefined : { backgroundImage: theme.bg }}
        >
          {hasImage && (
            <>
              <Image
                src={event.banner_image_url as string}
                alt={event.title}
                fill
                quality={78}
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
                className="object-cover transition-transform duration-[1.1s] ease-out group-hover:scale-[1.06]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-black/30" />
            </>
          )}

          {/* Top: status badge + scan glyph */}
          <div className="relative z-10 flex items-start justify-between">
            {badge ? (
              <span
                className={`eyebrow inline-flex rounded-md px-2 py-1 text-[9px] tracking-[0.12em] backdrop-blur-md ${
                  badge.tone === 'today' ? 'bg-black/70 text-brand-300' : 'bg-white/85 text-black/70'
                }`}
              >
                {badge.label}
              </span>
            ) : (
              <span />
            )}
            <span className="grid h-8 w-8 place-items-center rounded bg-black/35 text-white backdrop-blur-md">
              <QrCode className="h-[15px] w-[15px]" />
            </span>
          </div>

          {/* Center title for image-less posters */}
          {!hasImage && (
            <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center px-5 text-center">
              <h3 className="font-display text-[24px] leading-[0.98] text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.45)] line-clamp-4">
                {event.title}
              </h3>
            </div>
          )}

          {/* Bottom: title + meta */}
          <div className="relative z-10 space-y-1.5">
            {hasImage && (
              <h3 className="font-display text-[22px] leading-[1.02] text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.5)] line-clamp-2">
                {event.title}
              </h3>
            )}
            <div className="eyebrow flex items-center gap-1.5 text-[10px] tracking-[0.06em] text-white/85">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{dateLabel}</span>
            </div>
            {location && (
              <div className="flex items-center gap-1.5 text-[11.5px] text-white/80">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{location}</span>
              </div>
            )}
          </div>
        </div>

        {/* ---------- Footer ---------- */}
        <div className="flex items-center justify-between gap-2 px-3.5 py-3">
          <span className="text-xs font-medium text-white/50">
            {ticketsSold} {ticketsSold === 1 ? 'ticket' : 'tickets'} sold
          </span>
          <span className="inline-flex items-center gap-1.5 rounded bg-white px-3 py-1.5 text-xs font-semibold text-black transition-colors group-hover:bg-white/90">
            <QrCode className="h-3.5 w-3.5" />
            Scan
          </span>
        </div>
      </article>
    </Link>
  )
}

export default function EventSelector({ events }: EventSelectorProps) {
  const { t } = useTranslation('organizer')

  // Separate today's events from others for display
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const todayEvents = events.filter((e) => {
    const eventDate = new Date(e.start_datetime)
    return eventDate >= today && eventDate < tomorrow
  })

  const otherEvents = events.filter((e) => {
    const eventDate = new Date(e.start_datetime)
    return eventDate < today || eventDate >= tomorrow
  })

  if (events.length === 0) {
    return (
      <div className="rounded-2xl bg-white/[0.055] p-6">
        <div className="py-12 text-center">
          <CalendarDays className="mx-auto mb-4 h-12 w-12 text-white/40" aria-hidden />
          <p className="mb-4 text-white/60">You don&apos;t have any events yet.</p>
          <Link
            href="/organizer/events/new"
            className="inline-block rounded bg-white px-6 py-3 font-semibold text-black hover:bg-white/90"
          >
            {t('scan_selector.create_first_event')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Today's Events */}
      {todayEvents.length > 0 && (
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-white/45">
            <MapPin className="h-4 w-4" aria-hidden />
            <span>{t('scan_selector.happening_today')}</span>
          </h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {todayEvents.map((event) => (
              <ScanEventCard key={event.id} event={event} badge={{ label: 'Today', tone: 'today' }} />
            ))}
          </div>
        </section>
      )}

      {/* Other Events */}
      {otherEvents.length > 0 && (
        <section>
          {todayEvents.length > 0 && (
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">{t('scan_selector.other_events')}</h3>
          )}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {otherEvents.map((event) => {
              const isPast = new Date(event.start_datetime) < new Date()
              return (
                <ScanEventCard
                  key={event.id}
                  event={event}
                  badge={isPast ? { label: 'Past', tone: 'past' } : undefined}
                />
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
