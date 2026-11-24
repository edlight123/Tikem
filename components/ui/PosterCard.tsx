'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import PosterImage from '@/components/ui/PosterImage'
import { usePosterAccent } from '@/components/ui/usePosterAccent'

interface PosterCardProps {
  /** Above-the-fold card: fetch its poster with the page instead of lazily (speed pass 2026-11-17). */
  priority?: boolean
  /** Portrait poster image. When absent, a teal→black gradient carries the title. */
  imageUrl?: string
  title: string
  /** e.g. "From 500 HTG" or "Free". Rendered in the muted caption line. */
  priceLabel?: string
  venue?: string
  dateLabel?: string
  /**
   * Quiet status after the price (dot + label: "Few tickets left", "3
   * friends"). Nothing sits ON the poster: an overlay chip covered the date
   * or title organizers set in the top corner of their flyer.
   */
  status?: React.ReactNode
  /**
   * Leaves room at the right of the title for an action the caller overlays
   * there (DiscoverEventCard's bookmark).
   */
  reserveAction?: boolean
  /** Poster ratio. Default 4/5 (Tikèm's editorial portrait). */
  /** The house poster format is 4:5 and is the only shape offered — a
   *  second option here just let a caller drift off-format. */
  aspect?: '4/5'
  /** When set, the whole card becomes a keyboard-accessible link. */
  href?: string
  onClick?: () => void
  className?: string
  /**
   * The poster-glow — the design system's signature. Each poster radiates its
   * own dominant color into the black canvas (teal-neutral until extracted).
   * On by default for public surfaces; pass false in dense admin lists.
   */
  glow?: boolean
  /** The poster's alt text (lib/posterAlt.ts); defaults to the title. */
  imageAlt?: string
}

/**
 * Presentational, poster-forward event card. Portrait image with a graceful
 * text-only fallback, then a three-tier caption (title / price·venue / date).
 * No fixed widths — drop it into a grid cell or a horizontal rail.
 *
 * @example
 * <PosterCard
 *   imageUrl={event.banner_image_url ?? undefined}
 *   title={event.title}
 *   priceLabel={getPriceLabel(event.ticket_price, event.currency)}
 *   venue={event.venue_name}
 *   dateLabel={formatEventDate(event.start_datetime)}
 *   href={`/events/${event.id}`}
 * />
 */
export function PosterCard({
  priority,
  imageUrl,
  title,
  priceLabel,
  venue,
  dateLabel,
  status,
  reserveAction = false,
  aspect = '4/5',
  href,
  onClick,
  className = '',
  glow = true,
  imageAlt,
}: PosterCardProps) {
  // Fall back to the gradient title-card not just when the URL is absent, but
  // also when the image fails to load (broken/missing banner) — otherwise a dead
  // URL leaves an empty black poster instead of the intended fallback.
  const [imgError, setImgError] = useState(false)
  const hasImage = Boolean(imageUrl) && !imgError
  const aspectClass = 'aspect-[4/5]'
  // The artwork's dominant color, as an "r,g,b" triple for the glow.
  const accent = usePosterAccent(glow && hasImage ? imageUrl : undefined)

  const inner = (
    <article
      className="group flex h-full max-w-full flex-col [container-type:inline-size] transition-transform duration-200 ease-out hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      style={glow ? ({ ['--pg' as any]: accent } as React.CSSProperties) : undefined}
    >
      {/* ---------- Poster (4px corners: artwork, not chrome) ---------- */}
      <div
        className={`relative ${aspectClass} w-full max-w-full overflow-hidden rounded ${
          hasImage ? 'bg-surface-low' : 'bg-gradient-to-br from-brand-700 via-brand-900 to-black'
        } ${
          glow
            ? '[box-shadow:0_0_30px_-2px_rgba(var(--pg),0.20)] transition-shadow duration-200 group-hover:[box-shadow:0_0_48px_2px_rgba(var(--pg),0.32)]'
            : ''
        }`}
      >
        {hasImage ? (
          <PosterImage
            src={imageUrl as string}
            alt={imageAlt || title}
            className="transition-transform duration-200 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            quality={78}
            priority={priority}
            onError={() => setImgError(true)}
          />
        ) : (
          // Text-only events still read as premium: the title in the event-name voice.
          <div className="absolute inset-0 flex items-center justify-center p-5 text-center">
            <span className="font-display text-headline italic leading-[1.05] text-fg line-clamp-4">
              {title}
            </span>
          </div>
        )}
      </div>

      {/* ---------- Caption: title / venue·date / price ----------
          Event names are the serif italic, as in the app (owner: event names
          stay serif), sized to the card (cqw): ~21px in a rail, 28px on a
          full-width phone card, as the app sets it. The price is caption grey, not teal: on a grid every
          card carried a teal line, and teal is for state. */}
      <div className="pt-2.5">
        <h3
          className={`truncate font-display text-[clamp(20px,8.5cqw,28px)] italic leading-[1.15] text-fg ${
            reserveAction ? 'pr-9' : ''
          }`}
        >
          {title}
        </h3>
        {(venue || dateLabel) && (
          // suppressHydrationWarning: the date label is formatted in the
          // runtime's timezone, so the server (UTC) and the visitor's browser
          // can legitimately disagree — React should adopt the client text
          // instead of logging a recoverable hydration mismatch (#425).
          <p className="mt-1 truncate text-meta text-fg-muted" suppressHydrationWarning>
            {venue}
            {venue && dateLabel && <span className="text-fg-faint"> · </span>}
            {dateLabel}
          </p>
        )}
        {(priceLabel || status) && (
          <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-meta">
            {priceLabel && <span className="shrink-0 font-semibold text-fg-soft">{priceLabel}</span>}
            {priceLabel && status && <span className="text-fg-faint">·</span>}
            {status && <span className="flex min-w-0 items-center gap-1.5 truncate text-fg-muted">{status}</span>}
          </p>
        )}
      </div>
    </article>
  )

  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className={`block h-full rounded outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${className}`}
      >
        {inner}
      </Link>
    )
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`block h-full w-full max-w-full rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${className}`}
      >
        {inner}
      </button>
    )
  }

  return <div className={`h-full max-w-full ${className}`}>{inner}</div>
}
