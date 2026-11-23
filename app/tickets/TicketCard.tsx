'use client'

import Link from 'next/link'
import Image from 'next/image'
import { isValid } from 'date-fns'
import { CalendarDays, MapPin, Ticket as TicketIcon } from 'lucide-react'
import { getPosterTheme } from '@/lib/posterGradient'
import { eventZone } from '@/lib/home/feed'
import { formatInZone } from '@/lib/home/format'

interface TicketCardProps {
  eventId: string
  title: string
  bannerImageUrl?: string
  startDatetime?: string
  venueName?: string
  city?: string
  country?: string
  timezone?: string
  ticketCount: number
}

/**
 * The ticket card's date on the EVENT's clock (its stored zone, else its
 * city/country), so a reader abroad sees the time the event is actually on,
 * and the server render matches the browser's.
 */
export function ticketCardDateLabel(
  startDatetime: string | undefined,
  place: { timezone?: string; city?: string; country?: string }
): string {
  const d = startDatetime ? new Date(startDatetime) : null
  if (!d || !isValid(d)) return 'Date TBA'
  return formatInZone(d, eventZone(place), 'EEE, MMM d · h:mm a')
}

export default function TicketCard({
  eventId,
  title,
  bannerImageUrl,
  startDatetime,
  venueName,
  city,
  country,
  timezone,
  ticketCount,
}: TicketCardProps) {
  const cleanTitle = title.replace(/^\[[^\]]*\]\s*/, '')
  const hasImage = Boolean(bannerImageUrl)
  const theme = getPosterTheme(eventId || title)
  const dateLabel = ticketCardDateLabel(startDatetime, { timezone, city, country })
  const locationLabel = [venueName, city].filter(Boolean).join(', ') || 'Location TBA'

  return (
    <Link href={`/tickets/event/${eventId}`} prefetch className="group block h-full">
      <article className="hover-lift h-full overflow-hidden rounded-none bg-surface shadow-poster-sm transition-all duration-300 group-hover:bg-surface-high group-hover:shadow-card-hover">
        <div
          className="poster-vignette relative flex aspect-[4/5] flex-col justify-between overflow-hidden p-3.5 text-fg"
          style={hasImage ? undefined : { backgroundImage: theme.bg }}
        >
          {hasImage && (
            <>
              <Image
                src={bannerImageUrl as string}
                alt={cleanTitle}
                fill
                quality={78}
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
                className="object-cover transition-transform duration-[1.1s] ease-out group-hover:scale-[1.06]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-scrim-strong via-shade/15 to-scrim-light" />
            </>
          )}

          {/* Top: ticket count */}
          <div className="relative z-10 flex items-start justify-between">
            <span className="eyebrow inline-flex items-center gap-1.5 rounded-lg bg-scrim-light px-2.5 py-1.5 text-eyebrow tracking-[0.12em] text-fg backdrop-blur-md">
              <TicketIcon className="h-3.5 w-3.5" />
              {ticketCount} {ticketCount === 1 ? 'Ticket' : 'Tickets'}
            </span>
          </div>

          {/* Center title for image-less posters */}
          {!hasImage && (
            <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center px-5 text-center">
              <h3 className="font-display italic text-section leading-[0.98] text-fg drop-shadow-[0_2px_18px_rgba(0,0,0,0.45)] line-clamp-4">
                {cleanTitle}
              </h3>
            </div>
          )}

          {/* Bottom: title + meta */}
          <div className="relative z-10 space-y-1.5">
            {hasImage && (
              <h3 className="font-display italic text-section leading-[1.02] text-fg drop-shadow-[0_2px_14px_rgba(0,0,0,0.5)] line-clamp-2">
                {cleanTitle}
              </h3>
            )}
            <div className="label-mono flex items-center gap-1.5 text-eyebrow uppercase text-fg-soft">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{dateLabel}</span>
            </div>
            <div className="label-mono flex items-center gap-1.5 text-eyebrow uppercase text-fg-soft">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{locationLabel}</span>
            </div>
          </div>
        </div>
      </article>
    </Link>
  )
}
