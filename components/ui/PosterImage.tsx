'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'

/**
 * An event poster that never crops a flyer badly (same rule as the app's
 * mobile/components/PosterImage).
 *
 * Organizers upload flyers made for Instagram (square) or Stories (9:16);
 * every poster frame here is 4:5. `object-cover` cut the date or venue off
 * those flyers. A flyer close to the frame's shape still fills it; one that
 * isn't is shown whole, on one even, deep tone taken from the flyer
 * (/api/posters/tone). A blurred copy left uneven patches above and below
 * the art; a single tone reads as a deliberate mount.
 *
 * Renders inside a `relative` frame that sets the size (it uses `fill`).
 */

// Relative shape difference that may still fill the frame: a sliver at the
// edges, never a line of text.
const FILL_TOLERANCE = 0.12

const knownRatios = new Map<string, number>()
const knownTones = new Map<string, Promise<string>>()

// Neutral mount while the tone loads (and if it can't be read).
const MOUNT = '#141414'

function toneFor(src: string): Promise<string> {
  let p = knownTones.get(src)
  if (!p) {
    p = fetch(`/api/posters/tone?url=${encodeURIComponent(src)}`)
      .then((r) => r.json())
      .then((j) => (typeof j?.tone === 'string' ? j.tone : MOUNT))
      .catch(() => MOUNT)
    knownTones.set(src, p)
  }
  return p
}

interface Props {
  src: string
  alt: string
  sizes: string
  /** Frame width / height. Every poster frame is 4:5. */
  frameRatio?: number
  priority?: boolean
  quality?: number
  /** Extra classes for the poster itself (hover zoom etc.). */
  className?: string
  onError?: () => void
}

export default function PosterImage({
  src,
  alt,
  sizes,
  frameRatio = 4 / 5,
  priority,
  quality,
  className = '',
  onError,
}: Props) {
  const [ratio, setRatio] = useState<number | undefined>(knownRatios.get(src))
  const fits = ratio === undefined || Math.abs(ratio - frameRatio) / frameRatio <= FILL_TOLERANCE
  const [tone, setTone] = useState(MOUNT)

  useEffect(() => {
    if (fits) return
    let live = true
    toneFor(src).then((t) => live && setTone(t))
    return () => {
      live = false
    }
  }, [fits, src])

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (!img.naturalWidth || !img.naturalHeight) return
    const r = img.naturalWidth / img.naturalHeight
    knownRatios.set(src, r)
    if (r !== ratio) setRatio(r)
  }

  return (
    <>
      {!fits && (
        <div
          aria-hidden
          className="absolute inset-0 transition-colors duration-300"
          style={{ backgroundColor: tone }}
        />
      )}
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        quality={quality}
        priority={priority}
        className={`${fits ? 'object-cover' : 'object-contain'} ${className}`}
        onLoad={onLoad}
        onError={onError}
      />
    </>
  )
}
