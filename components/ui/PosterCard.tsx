'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import PosterImage from '@/components/ui/PosterImage'
import { usePosterAccent } from '@/components/ui/usePosterAccent'

interface PosterCardProps {
  /** Portrait poster image. When absent, a teal→black gradient carries the title. */
  imageUrl?: string
  title: string
  /** e.g. "From 500 HTG" or "Free". Rendered in the muted caption line. */
  priceLabel?: string
  venue?: string
  dateLabel?: string
  /** Floating overlay node on the image (status pill, category, etc.). */
  badge?: React.ReactNode
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
  imageUrl,
  title,
  priceLabel,
  venue,
  dateLabel,
  badge,
  aspect = '4/5',
  href,
  onClick,
  className = '',
  glow = true,
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
      className="group flex h-full max-w-full flex-col transition-transform duration-200 ease-out hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      style={glow ? ({ ['--pg' as any]: accent } as React.CSSProperties) : undefined}
    >
      {/* ---------- Poster (4px corners: artwork, not chrome) ---------- */}
      <div
        className={`relative ${aspectClass} w-full max-w-full overflow-hidden rounded ${
          hasImage ? 'bg-white/[0.02]' : 'bg-gradient-to-br from-brand-700 via-brand-900 to-black'
        } ${
          glow
            ? '[box-shadow:0_0_30px_-2px_rgba(var(--pg),0.20)] transition-shadow duration-200 group-hover:[box-shadow:0_0_48px_2px_rgba(var(--pg),0.32)]'
            : ''
        }`}
      >
        {hasImage ? (
          <PosterImage
            src={imageUrl as string}
            alt={title}
            className="transition-transform duration-200 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            quality={78}
            onError={() => setImgError(true)}
          />
        ) : (
          // Text-only events still read as premium: title set large in bold grotesk.
          <div className="absolute inset-0 flex items-center justify-center p-5 text-center">
            <span className="font-grotesk text-2xl font-bold leading-[1.05] text-white line-clamp-4">
              {title}
            </span>
          </div>
        )}

        {badge && <div className="absolute left-2.5 top-2.5 z-10">{badge}</div>}
      </div>

      {/* ---------- Caption: title / venue·date / price (teal = semantic) ---------- */}
      <div className="px-0.5 pt-2.5">
        <h3 className="truncate font-grotesk text-[15px] font-bold leading-tight text-white">
          {title}
        </h3>
        {(venue || dateLabel) && (
          // suppressHydrationWarning: the date label is formatted in the
          // runtime's timezone, so the server (UTC) and the visitor's browser
          // can legitimately disagree — React should adopt the client text
          // instead of logging a recoverable hydration mismatch (#425).
          <p className="mt-1 truncate text-[13px] text-white/55" suppressHydrationWarning>
            {venue}
            {venue && dateLabel && <span className="text-white/30"> · </span>}
            {dateLabel}
          </p>
        )}
        {priceLabel && (
          <p className="mt-1 truncate text-[13px] font-semibold text-brand-400">{priceLabel}</p>
        )}
      </div>
    </article>
  )

  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className={`block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${className}`}
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
        className={`block h-full w-full max-w-full rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${className}`}
      >
        {inner}
      </button>
    )
  }

  return <div className={`h-full max-w-full ${className}`}>{inner}</div>
}
