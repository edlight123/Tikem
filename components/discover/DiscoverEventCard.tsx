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
import { useTranslation } from 'react-i18next'
import { useFriendsGoingCount } from './FriendsGoingContext'
import { eventZone } from '@/lib/home/feed'

type Event = Database['public']['Tables']['events']['Row']

interface DiscoverEventCardProps {
  event: Event
}

export function DiscoverEventCard({ event }: DiscoverEventCardProps) {
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
  const dateLabel =
    parsedDate && isValid(parsedDate)
      ? // The event's zone, as the event page prints it (and as the server did).
        formatEventDate(event.start_datetime, t, i18n.language, eventZone(event as any))
      : undefined

  // Poster overlay chips, stacked top-left: the status cue (Popular / Few tickets
  // left, else category) plus a friends-going social-proof chip when relevant.
  const badge = (
    <div className="flex flex-col items-start gap-1">
      <span
        // 9px with 0.1em tracking was below readable on a phone, where this
        // chip is often the only thing naming the event's type. 10px is still a
        // micro-label but it can actually be read.
        className={`eyebrow inline-flex rounded-md px-2 py-1 text-[10px] tracking-[0.1em] backdrop-blur-md ${
          cue
            ? cue.variant === 'warning'
              ? 'bg-amber-400/90 text-amber-950'
              : 'bg-white text-black'
            : 'bg-black/30 text-white'
        }`}
      >
        {cue ? cue.label : event.category}
      </span>
      {friendsGoing > 0 && (
        <span className="label-mono inline-flex items-center gap-1 rounded-md bg-black/40 px-2 py-1 text-[9px] uppercase tracking-[0.1em] text-white/90 backdrop-blur-md">
          <Users className="h-3 w-3" />
          {friendsGoing} {friendsGoing === 1 ? 'friend' : 'friends'}
        </span>
      )}
    </div>
  )

  return (
    <div className="relative h-full">
      <PosterCard
        imageUrl={event.banner_image_url ?? undefined}
        title={event.title}
        priceLabel={priceLabel}
        venue={venue}
        dateLabel={dateLabel}
        badge={badge}
        aspect="4/5"
        href={`/events/${event.id}`}
      />

      {/* Bookmark overlay — sits above the PosterCard link so its own click
          toggles the saved state instead of navigating. */}
      <button
        type="button"
        onClick={handleBookmarkToggle}
        aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
        // 44px on a phone, 32px above. The visible disc stays 32px either way
        // — the extra size is transparent padding around it, so save doesn't
        // become a thumb-sized black circle sitting on the poster art.
        className="absolute right-2.5 top-2.5 z-20 grid h-11 w-11 place-items-center rounded-full transition-transform duration-200 active:scale-90 sm:h-8 sm:w-8"
      >
        {/* The disc moved in here so the button's larger hit area stays
            invisible while the affordance keeps its original size. */}
        <span className="grid h-8 w-8 place-items-center rounded-full bg-black/30 backdrop-blur-md">
          <Bookmark className={`h-[15px] w-[15px] ${isBookmarked ? 'fill-white text-white' : 'text-white'}`} />
        </span>
      </button>
    </div>
  )
}
