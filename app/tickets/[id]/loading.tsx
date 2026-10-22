/**
 * Single ticket loading skeleton — added because this segment had none.
 *
 * Without it /tickets/[id] fell through to app/tickets/loading.tsx, which
 * draws My Tickets: a serif page title and two rows of 4:5 posters. Opening
 * one ticket therefore painted a wall of other people's posters and then
 * replaced it with a two-column QR page.
 *
 * Derived geometry:
 *   root     min-h-screen bg-[#0a0a0a] pb-20 sm:pb-24  (NOT `pb-mobile-nav` —
 *            this page sets its own bottom reservation)
 *   navbar   h-14 sm:h-16 · max-w-7xl px-4 sm:px-6 lg:px-8 · bottom hairline
 *   body     max-w-5xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8
 *   back     inline text link, mb-6
 *   split    TicketDetailContent — grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6
 *              left:  the QR card — `rounded-2xl border border-white/10
 *                     bg-white/[0.03] p-4 sm:p-6 lg:p-8`, centred, with a
 *                     status row, a caption, the code square, and a stack of
 *                     detail rows
 *              right: the event card — `rounded-none border border-white/10
 *                     bg-white/[0.03]` with an h-40 sm:h-48 banner over its
 *                     text
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-20 sm:pb-24">
      {/* Navbar */}
      <div className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6 lg:px-8">
          <Bar className="h-7 w-24" />
          <Bar className="h-8 w-20 rounded" />
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        {/* back link */}
        <Bar className="mb-6 h-6 w-32" />

        <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
          {/* QR card */}
          <div className="space-y-4 sm:space-y-6">
            <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6 lg:p-8">
              <div className="mb-4 flex w-full items-center justify-between">
                <Bar className="h-5 w-24" />
                <Bar className="h-9 w-28 rounded" />
              </div>
              <div className="mb-6 w-full text-center">
                <Bar className="mx-auto mb-2 h-3 w-28" />
                <div className="skeleton mx-auto aspect-square w-48 max-w-full rounded-lg" />
              </div>
              <div className="w-full space-y-3">
                {[0, 1, 2].map((i) => (
                  <Bar key={i} className="h-11 w-full rounded-lg" />
                ))}
              </div>
            </div>
          </div>

          {/* Event card */}
          <div className="space-y-4 sm:space-y-6">
            <div className="overflow-hidden rounded-none border border-white/10 bg-white/[0.03]">
              <div className="skeleton h-40 w-full sm:h-48" />
              <div className="space-y-2 p-4 sm:p-6">
                <Bar className="h-6 w-3/4" />
                <Bar className="h-4 w-1/2" />
                <Bar className="h-4 w-2/3" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
