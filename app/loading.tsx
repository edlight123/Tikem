/**
 * Homepage loading skeleton — drawn to the layout that actually arrives, so
 * navigating home doesn't flash one page and then replace it with another:
 * nav, the city row, the featured hero (4:5 poster first on a phone, on the
 * right from lg), the film strip, then the "this week" strip.
 *
 * The live ticker is left out on purpose: it only renders when there is
 * something true to say, so a skeleton bar for it would usually be a lie.
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-black pb-mobile-nav">
      {/* Navbar. `flush` on the real homepage means no bottom rule here. */}
      <div className="sticky top-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between sm:h-16">
            <div className="flex items-center gap-8">
              <Bar className="h-7 w-24" />
              <div className="hidden gap-6 md:flex">
                <Bar className="h-4 w-16" />
                <Bar className="h-4 w-16" />
                <Bar className="h-4 w-24" />
              </div>
            </div>
            <Bar className="h-9 w-20 rounded-xl" />
          </div>
        </div>
      </div>

      {/* City row */}
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-4 sm:px-6 lg:px-8">
        {Array.from({ length: 5 }).map((_, i) => (
          <Bar key={i} className="h-4 w-20 shrink-0" />
        ))}
      </div>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 pb-12 pt-6 sm:px-6 sm:pt-10 lg:grid-cols-12 lg:items-center lg:gap-12 lg:px-8 lg:pb-20 lg:pt-14">
        <div className="lg:order-2 lg:col-span-5">
          <div className="skeleton aspect-[4/5] w-[78%] max-w-[340px] rounded sm:w-[60%] lg:ml-auto lg:w-full lg:max-w-[460px]" />
        </div>
        <div className="lg:order-1 lg:col-span-7">
          <Bar className="h-3 w-24" />
          <Bar className="mt-5 h-[44px] w-[80%] max-w-[520px] lg:h-[100px]" />
          <Bar className="mt-2 h-[44px] w-[60%] max-w-[420px] lg:h-[100px]" />
          <Bar className="mt-6 h-6 w-4/5 max-w-xl" />
          <Bar className="mt-6 h-3 w-3/5 max-w-md" />
          <div className="skeleton mt-8 h-12 w-36 rounded-xl" />
        </div>
      </section>

      {/* ── FILM STRIP ───────────────────────────────────────────────────── */}
      <section aria-hidden className="overflow-hidden bg-white/[0.03] py-6">
        <div className="flex gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-44 w-[141px] shrink-0 rounded sm:h-56 sm:w-[179px]" />
          ))}
        </div>
      </section>

      {/* ── THIS WEEK ────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-7xl px-4 pt-16 sm:px-6 sm:pt-20 lg:px-8">
        <Bar className="h-8 w-40" />
        <div className="mt-6 flex gap-2 overflow-hidden lg:grid lg:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="skeleton h-56 w-[42vw] max-w-[180px] shrink-0 rounded-lg lg:w-auto lg:max-w-none" />
          ))}
        </div>
      </div>
    </div>
  )
}
