/**
 * Profile loading skeleton.
 *
 * Re-derived from the refactored page (2026-09-04). What changed: the page is no
 * longer six identical bordered cards. It is an editorial header, then an
 * IDENTITY block (avatar + name + member-since, over a two-row filled panel),
 * then five titled sections — a serif lowercase heading with an optional
 * description above one filled panel each.
 *
 * Derived geometry:
 *   navbar   h-14 sm:h-16 · max-w-7xl px-4 sm:px-6 lg:px-8 · bottom hairline
 *   body     max-w-4xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 md:py-10
 *   header   EditorialHeader — h1 clamp(28px,4vw,40px) with mt-1.5, subtitle
 *            below it, and a right-hand organizer pill for verified organizers
 *   stack    mt-7 space-y-9 · sm:mt-9 sm:space-y-12
 *   identity 72px (sm:96px) avatar + name + meta, then a panel of 2 rows
 *   section  heading (mb-4 sm:mb-5) over `rounded-2xl bg-white/[0.03]`
 *
 * The panel fill stays at white/[0.03] because that is the real panel's fill —
 * what has to be visible is the CONTENT, and every bar inside uses `.skeleton`.
 * Panels no longer carry a border, and neither does this.
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
      <div className="rounded-2xl bg-white/[0.03] p-4 sm:p-5">
        <div className="space-y-5">
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex items-start gap-3.5">
              <div className="skeleton h-10 w-10 shrink-0 rounded-lg" />
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

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 md:py-10 lg:px-8">
        {/* Editorial page header. Measured, not guessed: at 402px the real
            header is 82.5px tall (mt-1.5 6 + a 28px h1 on 28.6 + a 14px
            subtitle that takes TWO lines at 21 each); at 1280 it is 72.8 (6 +
            40.8 + a one-line 15px subtitle). Hence the mt-1.5 wrapper, the
            28/40 title bar, and a second subtitle bar that exists only on the
            phone — without it the skeleton was 24px short and the page jumped
            down the moment it landed. */}
        <div className="flex items-start justify-between gap-4">
          <div className="mt-1.5 min-w-0">
            <Bar className="h-7 w-48 sm:h-10 sm:w-64" />
            <Bar className="mt-2 h-4 w-56 max-w-full sm:w-72" />
            <Bar className="mt-2 h-4 w-40 sm:hidden" />
          </div>
          <Bar className="h-10 w-10 shrink-0 rounded-xl sm:w-40" />
        </div>

        <div className="mt-7 space-y-9 sm:mt-9 sm:space-y-12">
          {/* Identity: avatar + name, then a 2-row panel */}
          <div>
            <div className="flex items-start gap-4 sm:gap-5">
              <div className="skeleton h-[72px] w-[72px] shrink-0 rounded-full sm:h-24 sm:w-24" />
              {/* The name bar tracks the name: 22px on 1.15 (a 25.3px line box)
                  on a phone, 32px on 1.15 (36.8) from sm up — h-6 / sm:h-9. It
                  was h-7 when the name was 26px. */}
              <div className="min-w-0 flex-1">
                <Bar className="h-6 w-2/3 sm:h-9 sm:w-1/2" />
                <Bar className="mt-2 h-3.5 w-40" />
              </div>
              <Bar className="h-8 w-16 shrink-0 rounded-lg" />
            </div>
            {/* The real read-out panel is 148.2px at EVERY width (two rows of
                py-3.5 + an 11.2px eyebrow + mt-2 + a 15px value on 22.5). These
                paddings and gaps add up to exactly that at both px-4/py-5 and
                sm:p-5; at p-4/space-y-5 it was 124 and the panel grew 24px on
                arrival. `space-y-7`, not space-y-6 — .mobile-typography rewrites
                space-y-8/6/4 under 640px. */}
            <div className="mt-5 space-y-7 rounded-2xl bg-white/[0.03] px-4 py-5 sm:mt-6 sm:p-5">
              {[0, 1].map((r) => (
                <div key={r}>
                  <Bar className="h-3 w-16" />
                  <Bar className="mt-3 h-4 w-2/3" />
                </div>
              ))}
            </div>
          </div>

          {/* social & bio · privacy · preferences · notifications · account */}
          <Section rows={2} />
          <Section rows={3} />
          <Section rows={3} />
          <Section rows={3} />
          <Section rows={3} />
        </div>
      </div>
    </div>
  )
}
