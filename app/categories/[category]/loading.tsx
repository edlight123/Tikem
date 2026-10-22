/**
 * Category detail loading skeleton — added because this route had none.
 *
 * Without it /categories/[category] fell through to app/categories/loading.tsx,
 * which draws the hub's 8-cell world grid, and then replaced it with a back
 * link, a big serif title and a wall of posters: a different page.
 *
 * Derived geometry (CategoryPageContent):
 *   navbar   h-14 sm:h-16 · max-w-7xl px-4 sm:px-6 lg:px-8 · bottom hairline
 *   body     max-w-7xl px-4 sm:px-6 lg:px-8 py-6 md:py-10
 *   back     inline text-sm link, mb-5
 *   header   mb-7 md:mb-9 — eyebrow, h1 mt-1.5 clamp(28px,5vw,44px)
 *            leading 1.02, p mt-1.5 at 14/15px
 *   grid     grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6 of
 *            DiscoverEventCard: aspect-[4/5] poster + px-0.5 pt-2.5 lines
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-mobile-nav">
      <div className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6 lg:px-8">
          <Bar className="h-7 w-24" />
          <Bar className="h-8 w-20 rounded" />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:py-10 lg:px-8">
        {/* back link */}
        <Bar className="mb-5 h-5 w-28" />

        <header className="mb-7 md:mb-9">
          <Bar className="h-2.5 w-20" />
          <Bar className="mt-1.5 h-8 w-56 sm:h-10 sm:w-72" />
          <Bar className="mt-1.5 h-4 w-64 max-w-full" />
        </header>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
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
