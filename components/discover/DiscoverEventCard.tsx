'use client'

import React, { useState, useEffect } from 'react'
import { Bookmark, Users } from 'lucide-react'
import { isValid, parseISO } from 'date-fns'
import type { Database } from '@/types/database'
import {
  formatEventDate,
  getEventPriceLabel,
  getLocationSummary,
  getEventCue,
  isEventBookmarked,
  toggleBookmark as toggleBookmarkHelper,
} from '@/lib/discover/helpers'
import { PosterCard } from '@/components/ui/PosterCard'
import PosterImage from '@/components/ui/PosterImage'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useFriendsGoingCount } from './FriendsGoingContext'
import { eventZone } from '@/lib/home/feed'

type Event = Database['public']['Tables']['events']['Row']

interface DiscoverEventCardProps {
  event: Event
  /**
   * Below 420px, a plain row (small poster, title, date, price) instead of a
   * full-width poster. For long lists — an organizer with 40 events was a
   * 27,000px scroll of one poster per screen. The feed keeps its posters.
   */
  rowOnPhone?: boolean
  /** First cards of the feed: load the poster with the page. */
  priority?: boolean
}

export function DiscoverEventCard({ event, rowOnPhone = false, priority = false }: DiscoverEventCardProps) {
  const [isBookmarked, setIsBookmarked] = useState(false)

  useEffect(() => {
    setIsBookmarked(isEventBookmarked(event.id))
  }, [event.id])

  const handleBookmarkToggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsBookmarked(toggleBookmarkHelper(event.id))
  }

  const { t, i18n } = useTranslation('common')
  const cue = getEventCue(event, t)
  const friendsGoing = useFriendsGoingCount(event.id)
  // Not `getPriceLabel(event.ticket_price, …)`: `ticket_price` is the lowest tier
  // price, so an event with a free tier next to paid ones would read "Free".
  const priceLabel = getEventPriceLabel(event as any, t)
  // Venue-first: the venue name adds variety and is rarely redundant; fall back
  // to the city/commune summary only when there's no venue (e.g. online events).
  const venue = (event.venue_name || '').trim() || getLocationSummary(event.city, event.commune)

  // Guard the date: parseISO on a missing/invalid string yields an Invalid Date,
  // and date-fns `format` throws on that. Only format when the date is valid.
  const parsedDate = event.start_datetime ? parseISO(event.start_datetime) : null
  const baseDate =
    parsedDate && isValid(parsedDate)
      ? // The event's zone, as the event page prints it (and as the server did).
        formatEventDate(event.start_datetime, t, i18n.language, eventZone(event as any))
      : undefined
  // A recurring series shows once (lib/events/series); its other dates are
  // counted here instead of filling the row with the same poster.
  const moreDates = Number((event as any).more_dates) || 0
  const dateLabel =
    baseDate && moreDates > 0
      ? `${baseDate} · ${t('events.more_dates', { count: moreDates, defaultValue: '+{{count}} more dates' })}`
      : baseDate

  // A status cue (Popular / Few tickets left) and friends going, as a dot +
  // label after the price. The bare category is left out: it said "Other" on
  // half the grid and, as a chip on the poster, covered the flyer's own date.
  const status =
    cue || friendsGoing > 0 ? (
      <>
        {cue && (
          <>
            <span
              aria-hidden
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                cue.variant === 'warning' ? 'bg-amber-400' : 'bg-white/70'
              }`}
            />
            <span className="truncate">{cue.label}</span>
          </>
        )}
        {cue && friendsGoing > 0 && <span className="text-white/30">·</span>}
        {friendsGoing > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1">
            <Users aria-hidden className="h-3 w-3" />
            {friendsGoing} {friendsGoing === 1 ? 'friend' : 'friends'}
          </span>
        )}
      </>
    ) : null

  const card = (
    <div className={`relative h-full ${rowOnPhone ? 'hidden min-[420px]:block' : ''}`}>
      <PosterCard
        imageUrl={event.banner_image_url ?? undefined}
        priority={priority}
        title={event.title}
        priceLabel={priceLabel}
        venue={venue}
        dateLabel={dateLabel}
        status={status}
        reserveAction
        aspect="4/5"
        href={`/events/${event.id}`}
      />

      {/* Bookmark — beside the title, under the poster's right edge (as in
          the app), not on the art. The frame mirrors the poster's 4:5 box so
          the button lands just below it at any card width; it sits above the
          PosterCard link so its click toggles instead of navigating. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 aspect-[4/5]">
        <button
          type="button"
          onClick={handleBookmarkToggle}
          aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
          aria-pressed={isBookmarked}
          className="pointer-events-auto absolute -right-2 top-full z-20 mt-1 grid h-10 w-10 place-items-center rounded text-white/55 transition-colors hover:text-white active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <Bookmark className={`h-[17px] w-[17px] ${isBookmarked ? 'fill-white text-white' : ''}`} />
        </button>
      </div>
    </div>
  )

  if (!rowOnPhone) return card

  return (
    <>
      <Link
        href={`/events/${event.id}`}
        className="flex items-center gap-3.5 py-2.5 transition-opacity active:opacity-70 min-[420px]:hidden"
      >
        <div className="relative aspect-[4/5] w-[72px] shrink-0 overflow-hidden rounded bg-white/[0.06]">
          {event.banner_image_url && (
            <PosterImage src={event.banner_image_url} alt={event.title} sizes="72px" frameRatio={4 / 5} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[17px] italic leading-tight text-white">{event.title}</p>
          {dateLabel && <p className="mt-1 truncate text-[13px] text-white/60">{dateLabel}</p>}
          {venue && <p className="mt-0.5 truncate text-[13px] text-white/45">{venue}</p>}
          {/* Its own line: beside a long venue name it was the part cut off. */}
          {priceLabel && <p className="mt-1 text-[13px] font-medium text-white/85">{priceLabel}</p>}
        </div>
      </Link>
      {card}
    </>
  )
}
