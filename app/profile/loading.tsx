/**
 * Profile loading skeleton, re-derived from the dashboard (2026-10-22).
 *
 * Geometry it tracks:
 *   body     max-w-6xl px-4 sm:px-6 lg:px-8 py-7 sm:py-10 lg:py-12
 *   identity 84px (sm:112px) avatar + name + meta; the stat strip stacks under
 *            it on a phone and sits on its right from lg
 *   grid     mt-9 sm:mt-12 · one column, lg: main + a 360px side column
 *   main     find-your-people card, then a poster grid (2 up, sm:3 up)
 *   side     settings rows, help rows, account rows
 *
 * Every bar uses `.skeleton`; panels are fills, never borders.
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

/** A section: heading lines, then a filled panel of `rows` row-height bars. */
function Section({ rows }: { rows: number }) {
  return (
    <div>
      <div className="mb-4 sm:mb-5">
        <Bar className="h-6 w-40 sm:h-7 sm:w-52" />
        <Bar className="mt-2 h-4 w-64 max-w-full" />
      </div>
      <div className="rounded bg-white/[0.03] p-4 sm:p-5">
        <div className="space-y-5">
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex items-start gap-3.5">
              <div className="skeleton h-9 w-9 shrink-0 rounded" />
              <div className="min-w-0 flex-1">
                <Bar className="h-4 w-1/2" />
                <Bar className="mt-2 h-3.5 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
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

      <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        {/* Identity band */}
        <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="skeleton h-[84px] w-[84px] shrink-0 rounded-full sm:h-28 sm:w-28" />
            <div className="min-w-0 flex-1">
              <Bar className="h-8 w-48 sm:h-11 sm:w-72" />
              <Bar className="mt-3 h-3.5 w-40" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded bg-white/[0.03] px-2 py-4 lg:w-[340px] lg:bg-transparent lg:p-0">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col items-center lg:items-start">
                <Bar className="h-7 w-10" />
                <Bar className="mt-2 h-3 w-16" />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-9 grid grid-cols-1 gap-x-12 gap-y-9 sm:mt-12 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-9 sm:space-y-12">
            <div className="rounded bg-white/[0.055] p-5 sm:p-6">
              <Bar className="h-8 w-40" />
              <Bar className="mt-4 h-6 w-56" />
              <Bar className="mt-2 h-4 w-4/5" />
              <Bar className="mt-4 h-10 w-36" />
            </div>
            <div>
              <Bar className="mb-5 h-7 w-44" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton aspect-[4/5] rounded" />
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-9 sm:space-y-12">
            <Section rows={5} />
            <Section rows={3} />
          </div>
        </div>
      </div>
    </div>
  )
}
