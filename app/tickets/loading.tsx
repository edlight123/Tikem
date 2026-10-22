/**
 * My Tickets loading skeleton.
 *
 * The old one was the wrong page twice over: it had no navbar (so everything
 * jumped down 56/64px on paint) and its body was `LoadingSkeleton rows={5}`,
 * a list of square thumbnails, while /tickets renders a POSTER GRID.
 *
 * Derived geometry:
 *   navbar    h-14 sm:h-16 · max-w-7xl px-4 sm:px-6 lg:px-8 · bottom hairline
 *             (this page does NOT pass `flush`)
 *   body      TicketsPageClient — max-w-4xl px-4 sm:px-6 lg:px-8 py-8 md:py-12
 *   header    EditorialHeader, title only: h1 mt-1.5 clamp(28px,4vw,40px),
 *             wrapper mb-6
 *   sections  space-y-8; each is a `flex items-center gap-2 mb-4` head — a
 *             40px icon box beside a 24px serif h2 over a 14px count — then
 *             grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 of TicketCard:
 *             aspect-[4/5], rounded-none, 1px hairline, text baked into the art
 *
 * Two sections are drawn (Upcoming + Past) because that is what a reader with
 * tickets sees; an empty account gets an EmptyState instead, and a skeleton
 * cannot know which — the populated shape is the one worth not moving.
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

function PosterGrid() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="skeleton aspect-[4/5] w-full rounded-none border border-white/10"
        />
      ))}
    </div>
  )
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-mobile-nav">
      {/* Navbar — h-14 / sm:h-16, with the bottom rule this page keeps. */}
      <div className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6 lg:px-8">
          <Bar className="h-7 w-24" />
          <Bar className="h-8 w-20 rounded" />
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 md:py-12 lg:px-8">
        {/* EditorialHeader: serif title, mb-6 wrapper. */}
        <div className="mb-6">
          <Bar className="mt-1.5 h-8 w-44 sm:h-10 sm:w-56" />
        </div>

        <div className="space-y-8">
          {[0, 1].map((i) => (
            <div key={i}>
              <div className="mb-4 flex items-center gap-2">
                <div className="skeleton h-10 w-10 shrink-0 rounded-xl" />
                <div>
                  <Bar className="h-7 w-40" />
                  <Bar className="mt-1 h-4 w-24" />
                </div>
              </div>
              <PosterGrid />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
