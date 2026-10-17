'use client'

import Link from 'next/link'
import Image from 'next/image'
import { format, isValid } from 'date-fns'
import { CalendarDays, MapPin, Ticket as TicketIcon } from 'lucide-react'
import { getPosterTheme } from '@/lib/posterGradient'

interface TicketCardProps {
  eventId: string
  title: string
  bannerImageUrl?: string
  startDatetime?: string
  venueName?: string
  city?: string
  ticketCount: number
}

export default function TicketCard({
  eventId,
  title,
  bannerImageUrl,
  startDatetime,
  venueName,
  city,
  ticketCount,
}: TicketCardProps) {
  const cleanTitle = title.replace(/^\[[^\]]*\]\s*/, '')
  const hasImage = Boolean(bannerImageUrl)
  const theme = getPosterTheme(eventId || title)
  const d = startDatetime ? new Date(startDatetime) : null
  const dateLabel = d && isValid(d) ? format(d, 'EEE, MMM d · h:mm a') : 'Date TBA'
  const locationLabel = [venueName, city].filter(Boolean).join(', ') || 'Location TBA'

  return (
    <Link href={`/tickets/event/${eventId}`} prefetch className="group block h-full">
      <article className="hover-lift h-full overflow-hidden rounded-none bg-white/[0.055] shadow-poster-sm transition-all duration-300 group-hover:bg-white/[0.12] group-hover:shadow-card-hover">
        <div
          className="poster-vignette relative flex aspect-[4/5] flex-col justify-between overflow-hidden p-3.5 text-white"
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
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-black/30" />
            </>
          )}

          {/* Top: ticket count */}
          <div className="relative z-10 flex items-start justify-between">
            <span className="eyebrow inline-flex items-center gap-1.5 rounded-lg bg-black/35 px-2.5 py-1.5 text-[10px] tracking-[0.12em] text-white backdrop-blur-md">
              <TicketIcon className="h-3.5 w-3.5" />
              {ticketCount} {ticketCount === 1 ? 'Ticket' : 'Tickets'}
            </span>
          </div>

          {/* Center title for image-less posters */}
          {!hasImage && (
            <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center px-5 text-center">
              <h3 className="font-display italic text-[24px] leading-[0.98] text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.45)] line-clamp-4">
                {cleanTitle}
              </h3>
            </div>
          )}

          {/* Bottom: title + meta */}
          <div className="relative z-10 space-y-1.5">
            {hasImage && (
              <h3 className="font-display italic text-[22px] leading-[1.02] text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.5)] line-clamp-2">
                {cleanTitle}
              </h3>
            )}
            <div className="label-mono flex items-center gap-1.5 text-[10px] uppercase text-white/85">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{dateLabel}</span>
            </div>
            <div className="label-mono flex items-center gap-1.5 text-[10.5px] uppercase text-white/80">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{locationLabel}</span>
            </div>
          </div>
        </div>
      </article>
    </Link>
  )
}
