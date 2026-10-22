/**
 * Favorites loading skeleton.
 *
 * The old one drew eight `h-24 bg-white/[0.03] border border-white/10` list
 * rows. Two things wrong with that: /favorites renders a POSTER GRID, and
 * `bg-white/[0.03]` on a `#0a0a0a` page paints nothing — the skeleton was
 * eight invisible outlines. Its navbar was also `py-3` (56px at every width)
 * against a real `h-14 sm:h-16`, so the page lifted 8px from sm up.
 *
 * Derived geometry:
 *   navbar   h-14 sm:h-16 · max-w-7xl px-4 sm:px-6 lg:px-8 · bottom hairline
 *   body     FavoritesContent — max-w-7xl px-4 sm:px-6 lg:px-8 py-8
 *   header   EditorialHeader title + subtitle, mb-8:
 *            h1 mt-1.5 clamp(28px,4vw,40px) · p mt-1.5 14/15px
 *   grid     grid-cols-2 gap-4 md:grid-cols-3 lg:gap-6 of DiscoverEventCard —
 *            aspect-[4/5] poster, then px-0.5 pt-2.5 title/meta/price
 *
 * No `pb-mobile-nav`: the real page's root is `surface-dark min-h-screen` with
 * no bottom reservation. (That looks like a page bug — the mobile nav strip
 * covers the last poster row — but the skeleton mirrors what arrives.)
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Navbar — h-14 / sm:h-16, with this page's bottom rule. */}
      <div className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6 lg:px-8">
          <Bar className="h-7 w-24" />
          <Bar className="h-8 w-20 rounded" />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <Bar className="mt-1.5 h-8 w-40 sm:h-10 sm:w-52" />
          <Bar className="mt-1.5 h-4 w-64 max-w-full" />
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton aspect-[4/5] w-full rounded" />
              <div className="px-0.5 pt-2.5">
                <Bar className="h-[15px] w-3/4" />
                <Bar className="mt-1 h-[13px] w-1/2" />
                <Bar className="mt-1 h-[13px] w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
