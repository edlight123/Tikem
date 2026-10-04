/**
 * Notifications loading skeleton: a list, not the homepage poster rails the
 * root app/loading.tsx would otherwise render here.
 *
 * Derived from NotificationsClient (POSH refresh, 2026-10):
 *   navbar   h-14 sm:h-16 · max-w-7xl px-4 sm:px-6 lg:px-8
 *   body     mx-auto max-w-3xl px-4 pt-8 sm:px-6 sm:pt-14 lg:px-8, on bg-black
 *   header   mono eyebrow · grotesk h1 clamp(40px,7vw,64px) · status line
 *            with quiet text actions on the right
 *   chips    mt-8 sm:mt-10, rounded-lg filled chips
 *   list     mt-8 sm:mt-10; a serif section header, then filled rounded-2xl
 *            rows (-mx-3 sm:-mx-4) with a 48/56px rounded-xl thumbnail
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-black pb-mobile-nav">
      {/* Navbar */}
      <div className="sticky top-0 z-50 bg-black/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6 lg:px-8">
          <Bar className="h-7 w-28" />
          <Bar className="h-8 w-24 rounded-full" />
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6 sm:pt-14 lg:px-8">
        <Bar className="h-2.5 w-20" />
        <Bar className="mt-3 h-10 w-64 max-w-full sm:h-14 sm:w-96" />
        <div className="mt-4 flex items-center justify-between gap-4">
          <Bar className="h-4 w-48" />
          <Bar className="h-4 w-24" />
        </div>

        <div className="mt-8 flex gap-2 sm:mt-10">
          {[12, 16, 16, 18].map((w, i) => (
            <div key={i} className="skeleton h-8 rounded-lg" style={{ width: `${w * 4}px` }} />
          ))}
        </div>

        <div className="mt-8 sm:mt-10">
          <Bar className="mb-5 h-7 w-24 sm:mb-6" />
          <div className="-mx-3 space-y-1 sm:-mx-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`flex items-start gap-3.5 rounded-2xl px-3 py-3 sm:gap-4 sm:px-4 sm:py-3.5 ${
                  i < 2 ? 'bg-white/[0.045]' : ''
                }`}
              >
                <div className="skeleton h-12 w-12 shrink-0 rounded-xl sm:h-14 sm:w-14" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <Bar className="h-4 w-3/5" />
                    <Bar className="h-3 w-10" />
                  </div>
                  <Bar className="mt-2.5 h-3.5 w-11/12 max-w-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
