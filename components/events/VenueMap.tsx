'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildStaticMapUrl, resolveVenueTarget, TILE_HEIGHT, TILE_WIDTH } from '@/lib/staticMap'

interface VenueMapProps {
  /** The raw event doc — the position is dug out of it, see `resolveVenueTarget`. */
  event: unknown
  /**
   * Where clicking goes. Pass the SAME expression the section's "Google Maps"
   * text link uses, so the tile and the link can never drift apart.
   */
  href: string
  /** Venue name for the accessible label — the thing the map is *of*. */
  venueName?: string
  className?: string
}

/**
 * A clickable static map of the venue: the mobile app's `VenueStaticMap`, ported.
 *
 * A plain `<img>`, not `next/image`, and that is deliberate:
 *   - the tile arrives already sized and already compressed by the provider, so
 *     Next's optimizer would re-fetch and re-encode it on our own server for no
 *     gain, and bill us for the transform;
 *   - a failing optimizer request surfaces as a broken `/_next/image` response
 *     with its own retry/error semantics, which is precisely the thing the
 *     "render nothing" rule below needs to intercept — a bare `<img>` gives us
 *     a clean `onError`;
 *   - it also keeps `images.remotePatterns` free of a host we never optimize.
 *
 * Renders NOTHING — not a placeholder, not an error state, not an empty box —
 * when the event has neither a coordinate nor an address specific enough to
 * draw, when no provider key is configured (the situation today), or when the
 * tile fails to load. The address sits in text immediately above this in both
 * placements, so the section degrades to exactly what it looks like now. A grey
 * "enable billing" tile, or a broken-image icon, would be strictly worse than
 * the empty space.
 */
export default function VenueMap({ event, href, venueName, className = '' }: VenueMapProps) {
  const { t } = useTranslation('common')
  const imgRef = useRef<HTMLImageElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  // Exact coordinates when the doc has them, otherwise a geocodable text
  // address assembled from venue / street / commune / city / department.
  const target = useMemo(() => resolveVenueTarget(event), [event])

  // No layout measurement: the builder asks for one fixed max-size tile and CSS
  // fits it to the box. So the URL is known at first render, server and client
  // alike — no hydration gap, no post-layout request.
  const src = useMemo(
    () => buildStaticMapUrl({ coords: target.coords, address: target.address }),
    [target]
  )

  // The tile is in the server-rendered HTML, so the browser can finish fetching
  // it — successfully OR not — BEFORE React hydrates, in which case neither
  // `onLoad` nor `onError` ever fires and the component would be frozen in its
  // initial state. Verified: with a bad key the tile 403s during the initial
  // paint and `onError` is simply never called. So ask the element itself once
  // on mount. `complete` is true for both outcomes; `naturalWidth === 0` is
  // what distinguishes "finished by failing" from "finished by decoding".
  useEffect(() => {
    const img = imgRef.current
    if (!img || !img.complete) return
    if (img.naturalWidth === 0) setFailed(true)
    else setLoaded(true)
  }, [src])

  // Hooks above, bail-outs below — hook order stays stable across renders.

  // `src` is null for: no key configured; a Mapbox-only setup on an event with
  // no coordinates; or no locator specific enough to be worth drawing.
  if (!src) return null
  // The provider refused: absent/bad key, quota, referrer restriction, or an
  // address Google could not geocode at all (that answers HTTP 400).
  if (failed) return null

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // Deliberately no card: no border, no shadow, no fill — just the rounded
      // tile on the black canvas, matching mobile. `rounded-xl` (12px) for the
      // same reason: the map is a block of content, not a pill.
      className={`group relative block aspect-[3/2] w-full overflow-hidden rounded-xl ${className}`}
      // The image is decorative *relative to this link* — alt="" plus one real
      // label here means a screen reader announces the destination once,
      // naming the venue, instead of reading a URL or a duplicated name.
      aria-label={t('events.venue_map_open', {
        defaultValue: 'Open {{venue}} on Google Maps',
        venue: venueName?.trim() || t('events.venue_information', { defaultValue: 'Venue Information' }),
      })}
    >
      {/* Shimmer sits BEHIND the tile, not over it: once the opaque image
          paints it is covered regardless of whether `loaded` ever flipped, so
          there is no way to get stuck showing a placeholder over a good map. */}
      {!loaded && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse bg-surface"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt=""
        width={TILE_WIDTH}
        height={TILE_HEIGHT}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className="relative h-full w-full object-cover transition-opacity duration-200 group-hover:opacity-90"
      />
    </a>
  )
}
