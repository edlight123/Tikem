/**
 * Guest event composer loading skeleton — added because this route had none.
 *
 * /create had no boundary of its own, so it fell all the way through to
 * app/loading.tsx: opening the composer painted the HOMEPAGE — the SAK PASE?
 * hero, the film strip, a poster grid — and then replaced the whole screen
 * with a form. That is the most jarring fallback in the tree.
 *
 * Derived geometry (app/create/page.tsx → EventComposer):
 *   root     surface-dark min-h-screen pb-mobile-nav
 *   navbar   h-14 sm:h-16 · max-w-7xl px-4 sm:px-6 lg:px-8 · bottom hairline
 *   steps    a sticky bar at `top-[var(--chrome-h)]`, inner
 *            `mx-auto flex max-w-5xl gap-1.5 px-4 py-3 sm:px-6 lg:px-8` of
 *            `rounded px-2.5 py-1.5` step pills
 *   body     mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6 md:py-10
 *   toggle   mx-auto mb-8 grid max-w-md grid-cols-2 rounded
 *            bg-white/[0.05] p-1 (two py-2.5 halves)
 *   fields   `min-h-11 rounded-xl` inputs over `bg-white/[0.05]`, each under a
 *            small label
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-mobile-nav">
      {/* Navbar */}
      <div className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6 lg:px-8">
          <Bar className="h-7 w-24" />
          <Bar className="h-8 w-20 rounded" />
        </div>
      </div>

      {/* Step bar */}
      <div className="sticky top-[var(--chrome-h)] z-30 bg-[#0a0a0a]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl gap-1.5 overflow-hidden px-4 py-3 sm:px-6 lg:px-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <Bar key={i} className="h-8 w-24 shrink-0 rounded" />
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 md:py-10 lg:px-8">
        {/* mode toggle */}
        <div className="mx-auto mb-8 grid max-w-md grid-cols-2 gap-1 rounded bg-white/[0.05] p-1">
          <Bar className="h-10 rounded" />
          <Bar className="h-10 rounded" />
        </div>

        {/* form fields */}
        <div className="space-y-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <Bar className="mb-2 h-3.5 w-28" />
              <Bar className="h-12 w-full rounded-xl" />
            </div>
          ))}
          {/* the poster drop zone */}
          <div>
            <Bar className="mb-2 h-3.5 w-24" />
            <div className="skeleton aspect-[4/5] w-full max-w-xs rounded-xl" />
          </div>
          <Bar className="h-12 w-40 rounded-xl" />
        </div>
      </div>
    </div>
  )
}
