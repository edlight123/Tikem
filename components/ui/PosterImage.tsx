'use client'

import { useState } from 'react'
import Image from 'next/image'

/**
 * An event poster that never crops a flyer badly (same rule as the app's
 * mobile/components/PosterImage).
 *
 * Organizers upload flyers made for Instagram (square) or Stories (9:16);
 * every poster frame here is 4:5. `object-cover` cut the date or venue off
 * those flyers. A flyer close to the frame's shape still fills it; one that
 * isn't is shown whole, centred on a blurred, darkened copy of itself.
 *
 * Renders inside a `relative` frame that sets the size (it uses `fill`).
 */

// Relative shape difference that may still fill the frame: a sliver at the
// edges, never a line of text.
const FILL_TOLERANCE = 0.12

const knownRatios = new Map<string, number>()

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
        // The room: the same flyer, blurred and darkened. A tiny source is
        // enough, the blur discards the detail anyway.
        <div aria-hidden className="absolute inset-0 overflow-hidden">
          <Image src={src} alt="" fill sizes="64px" quality={40} className="scale-125 object-cover blur-2xl" />
          <div className="absolute inset-0 bg-black/40" />
        </div>
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
