'use client'

import { useState } from 'react'
import Image from 'next/image'

/**
 * An event poster in its 4:5 frame (same rule as the app's
 * mobile/lib/posterFit + components/PosterImage).
 *
 * - Every poster fills the frame (zoomed to cover): photos, square flyers,
 *   2:3 portraits (owner, 2026-11-23: "zoom the images so they fill the 4:5").
 * - Only a very tall Stories flyer (9:16), which would lose about a third of
 *   its height (usually the date), shows whole over a blurred, cover-filled
 *   copy of itself, never an empty band.
 *
 * Renders inside a `relative` frame that sets the size (it uses `fill`).
 */

// Narrower than this (width / height) is a Stories flyer: show it whole.
// 9:16 = 0.5625; a 2:3 portrait (0.667) still fills.
const STORIES_MAX_RATIO = 0.6

const knownRatios = new Map<string, number>()

export function posterFit(ratio: number | undefined, frameRatio: number): 'cover' | 'contain' {
  if (ratio === undefined) return 'cover'
  if (ratio < STORIES_MAX_RATIO && frameRatio >= STORIES_MAX_RATIO) return 'contain'
  return 'cover'
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
  const fits = posterFit(ratio, frameRatio) === 'cover'

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
        // The same flyer, filled, blurred and dimmed, behind the whole one.
        <Image
          src={src}
          alt=""
          aria-hidden
          fill
          sizes={sizes}
          quality={40}
          className="scale-110 object-cover blur-2xl brightness-75"
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
