'use client'

/**
 * Poster-grid loading placeholder.
 *
 * This used to draw a list of 64px square thumbnails with two text lines
 * beside them, and every remaining caller renders a POSTER GRID underneath it:
 *
 *   app/tickets/page.tsx            grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4
 *   app/favorites/FavoritesContent  grid-cols-2 gap-4 md:grid-cols-3 lg:gap-6
 *   app/categories/CategoriesContent grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3
 *
 * so the placeholder was a different page from the one arriving. The grid below
 * is the common shape of those three (2 → 3 → 4), and each cell is the house
 * poster: `aspect-[4/5]` with the title/meta/price lines under it, exactly as
 * DiscoverEventCard → PosterCard lays them out (px-0.5 pt-2.5, 15px title,
 * mt-1 13px meta, mt-1 13px price).
 *
 * It was also INVISIBLE in two of the three: `tone="dark"` resolved the bar
 * class to the empty string, so nothing was painted at all on a #0a0a0a page.
 * The fill now comes from the `.skeleton` class in app/globals.css — a sweep
 * over a baked-in rgba(255,255,255,0.06) base that cannot be tuned away, and a
 * still block under prefers-reduced-motion.
 *
 * `rows` is the number of cards. `tone` is kept for call-site compatibility and
 * has no effect: there is one canvas colour in this app, and a skeleton has to
 * be visible on it.
 */

interface LoadingSkeletonProps {
  /** Number of poster cards to draw. */
  rows?: number
  className?: string
  /** Set false for a still placeholder (no sweep). */
  animated?: boolean
  /** @deprecated No effect — retained so existing call sites keep compiling. */
  tone?: 'light' | 'dark'
}

export default function LoadingSkeleton({
  rows = 6,
  className = '',
  animated = true,
}: LoadingSkeletonProps) {
  // `.skeleton` carries both the fill and the sweep; a still placeholder needs
  // the same fill without the animation.
  const fill = animated ? 'skeleton' : 'bg-surface'

  return (
    <div className={`grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 lg:gap-6 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i}>
          <div className={`${fill} aspect-[4/5] w-full rounded`} />
          <div className="px-0.5 pt-2.5">
            <div className={`${fill} h-[15px] w-3/4 rounded`} />
            <div className={`${fill} mt-1 h-[13px] w-1/2 rounded`} />
            <div className={`${fill} mt-1 h-[13px] w-16 rounded`} />
          </div>
        </div>
      ))}
    </div>
  )
}
