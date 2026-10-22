/**
 * Event detail loading skeleton.
 *
 * A skeleton is only worth having if it is the SHAPE of what arrives — its
 * whole job is that nothing moves when the real page lands. So this one is
 * built from measurements of the live page rather than from memory, at both
 * widths (numbers in the comments below), and it was re-measured after the
 * page changed. The previous version had drifted: it drew a full-bleed mobile
 * poster while the real one is inset with margins, and a two-column body grid
 * that mobile no longer renders at all.
 *
 * Measured, 402px: navbar 57 · hero block 611 (inset 4:5 poster + title +
 * organizer) · sticky buy bar 68 · key facts 123 · flat sections 715.
 * Measured, 1280px: navbar 65 · hero 553 · body 780.
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-mobile-nav md:pb-8">
      {/* Navbar — h-14 / sm:h-16, matching components/Navbar. */}
      <div className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6 lg:px-8">
          <Bar className="h-7 w-24" />
          <Bar className="h-8 w-20 rounded" />
        </div>
      </div>

      {/* ── MOBILE ────────────────────────────────────────────────────────
          The poster is INSET (mx-4) — it used to be full-bleed here while the
          real one had margins, so the whole page jumped sideways the moment it
          painted. `mt-4` and `rounded` (4px) track MobileHero: it gained a gap
          below the navbar and dropped from `rounded-2xl` to the house
          PosterCard radius, and a skeleton that keeps the old numbers is just
          a differently-wrong page. */}
      <div className="md:hidden">
        <div className="skeleton mx-4 mt-4 aspect-[4/5] rounded" />
        <div className="px-4 py-4">
          <Bar className="h-6 w-24 rounded-lg" />
          {/* Two lines, not one. The real h1 is 26px `break-words` and most
              event names wrap on a 370px column, so a single-line bar meant
              the organizer row and everything under it jumped down by ~27px
              on nearly every event. */}
          <Bar className="mt-3 h-[27px] w-full" />
          <Bar className="mt-1 h-[27px] w-3/5" />
          <div className="mt-3 flex items-center gap-2.5">
            <div className="skeleton h-10 w-10 shrink-0 rounded-full" />
            <Bar className="h-4 w-32" />
          </div>
        </div>

        {/* The sticky buy bar: one button plus the share square. */}
        <div className="flex items-center gap-3 px-4 py-3">
          <Bar className="h-11 flex-1 rounded-xl" />
          <div className="skeleton h-11 w-11 shrink-0 rounded-xl" />
        </div>

        {/* Key facts — date, venue, price. Traced off MobileKeyFacts rather
            than eyeballed: `border-b border-white/10 px-4 py-5`, then a 15px
            date line, a 14px venue line at mt-1.5, and a 15px price at mt-3.
            The old version used a flat `space-y-2` and no bottom rule, so the
            rule appeared out of nowhere when the real strip landed. */}
        <div className="border-b border-white/10 px-4 py-5">
          <Bar className="h-5 w-2/3" />
          <Bar className="mt-1.5 h-[18px] w-1/2" />
          <Bar className="mt-3 h-5 w-28" />
        </div>

        {/* The flat sections: MobileSections renders exactly five — about,
            date & time, venue & directions, organizer, share — in a
            `divide-y divide-white/[0.06] px-4` stack, each `py-6` with a
            22px Instrument Serif heading at `mb-3`. The heading bar is
            h-[22px], not h-5: at 20px every heading down the page sat two
            pixels high, which compounds into a visible jump by the fifth. */}
        <div className="divide-y divide-white/[0.06] px-4">
          {[3, 2, 3, 1, 1].map((lines, i) => (
            <div key={i} className="py-6">
              <Bar className="h-[22px] w-36" />
              <div className="mt-3 space-y-2">
                {Array.from({ length: lines }).map((_, l) => (
                  <Bar key={l} className={`h-4 ${l === lines - 1 ? 'w-2/3' : 'w-full'}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── DESKTOP ───────────────────────────────────────────────────────
          Poster left, details right, then the two-column body. */}
      <div className="hidden md:block">
        <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-12">
            {/* Square, matching the desktop hero's framed-print treatment
                (`rounded-none shadow-poster ring-1`) — this was rounded-2xl. */}
            <div className="skeleton aspect-[4/5] w-full rounded-none ring-1 ring-white/10" />
            <div>
              <Bar className="h-3 w-40" />
              <Bar className="mt-4 h-12 w-4/5" />
              <div className="mt-5 flex items-center gap-3">
                <div className="skeleton h-11 w-11 shrink-0 rounded-full" />
                <Bar className="h-4 w-36" />
              </div>
              {/* The facts row: date, venue, availability. */}
              <div className="mt-8 flex flex-wrap gap-x-12 gap-y-6 border-t border-white/10 pt-6">
                {[0, 1, 2].map((i) => (
                  <div key={i}>
                    <Bar className="h-2.5 w-16" />
                    <Bar className="mt-2 h-5 w-32" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            <div className="space-y-8 lg:col-span-2">
              {[3, 2, 2].map((lines, i) => (
                <div key={i} className="border-b border-white/10 pb-8">
                  <Bar className="h-6 w-40" />
                  <div className="mt-4 space-y-2">
                    {Array.from({ length: lines }).map((_, l) => (
                      <Bar key={l} className={`h-4 ${l === lines - 1 ? 'w-1/2' : 'w-full'}`} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* The sticky ticket panel. */}
            <div className="skeleton hidden h-72 w-full rounded-2xl lg:block" />
          </div>
        </div>
      </div>
    </div>
  )
}
