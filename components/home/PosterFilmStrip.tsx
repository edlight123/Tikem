'use client'

// Act 1 of the homepage cinema (posh calibration, 2026-08-29): a slow film
// strip of real posters running under the hero. Pure CSS marquee — two copies
// of the track translating -50% — so it costs no JS per frame, pauses on
// hover, and degrades to a plain swipeable row under reduced motion. Every
// poster is a real link into its event.

import Link from 'next/link'
import Image from 'next/image'

interface StripEvent {
  id: string
  title: string
  banner_image_url?: string | null
}

/**
 * The marquee repeats its track, so it needs enough posters that one copy
 * spans the widest screen (11 × 191px ≈ 2100px); with fewer, the copy shows
 * up on screen beside the original and the same poster appears twice. Below
 * this the strip is a still row instead.
 */
const MARQUEE_MIN = 11

export default function PosterFilmStrip({ events }: { events: StripEvent[] }) {
  const posters = (events || []).filter((e) => e?.banner_image_url).slice(0, 14)
  if (posters.length < 4) return null

  const moving = posters.length >= MARQUEE_MIN
  // Duplicate the track so the -50% loop is seamless.
  const track = moving ? [...posters, ...posters] : posters

  return (
    <section
      aria-label="Event posters"
      className="film-strip group relative isolate overflow-hidden bg-white/[0.03] py-6"
    >
      <div
        className={
          moving
            ? 'film-strip-track flex w-max gap-3 motion-reduce:w-auto motion-reduce:overflow-x-auto'
            : 'mx-auto flex w-max max-w-full gap-3 overflow-x-auto px-4 [scrollbar-width:none] sm:px-6 lg:px-8 [&::-webkit-scrollbar]:hidden'
        }
      >
        {track.map((ev, i) => (
          <Link
            key={`${ev.id}-${i}`}
            href={`/events/${ev.id}`}
            prefetch={false}
            // The duplicate half is presentation only — keep it out of the tab
            // order and the accessibility tree.
            aria-hidden={i >= posters.length || undefined}
            tabIndex={i >= posters.length ? -1 : undefined}
            className="relative block h-44 w-[141px] shrink-0 overflow-hidden rounded transition-opacity duration-200 hover:opacity-80 sm:h-56 sm:w-[179px]"
          >
            <Image
              src={ev.banner_image_url as string}
              alt={ev.title}
              fill
              sizes="180px"
              quality={55}
              /**
               * Eager for the first row, lazy after.
               *
               * This is a marquee: a poster enters the viewport ALREADY MOVING,
               * so lazy loading means the reader watches an empty frame slide
               * in and fill. `eager` (not `priority`) drops the deferral
               * without adding six more preload links competing with the
               * hero's — every image on this page was lazy, and the first
               * request on production did not fire until 1279ms.
               */
              loading={i < 8 ? 'eager' : 'lazy'}
              className="object-cover"
            />
          </Link>
        ))}
      </div>
    </section>
  )
}
