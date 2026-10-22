/**
 * Organizer public profile loading skeleton.
 *
 * The old one drew a page that does not exist: a circular 64px avatar (the real
 * one is a 80/96px `rounded-2xl` tile), a six-cell stats grid the page has no
 * trace of, and a six-card block — and BOTH grids were filled with
 * `bg-[#0a0a0a]`, which is the page's own colour, so they rendered as nothing
 * at all. Its navbar was `py-3` (56px at every width) against a real
 * `h-14 sm:h-16`.
 *
 * Derived geometry (OrganizerProfileClient):
 *   navbar   h-14 sm:h-16 · max-w-7xl px-4 sm:px-6 lg:px-8 · bottom hairline
 *   hero     max-w-7xl px-4 py-8 sm:px-6 md:py-12 lg:px-8, then
 *            `flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6`:
 *              avatar h-20 w-20 rounded-2xl → sm:h-24 sm:w-24
 *              h1 clamp(30px,5.5vw,46px) leading 0.98
 *              meta row mt-2 (13px) · stats row mt-4 (gap-x-5 gap-y-2)
 *              bio mt-4 (max-w-[60ch], 15px) · actions mt-5 with a follow
 *              button and 44px round social buttons
 *   body     max-w-7xl px-4 pb-12 sm:px-6 lg:px-8; one section per state,
 *            `border-t border-white/10 pt-8 md:pt-10`, a serif heading in a
 *            mb-5 block, then grid-cols-1 gap-4 md:grid-cols-2 md:gap-6
 *            lg:grid-cols-3 of DiscoverEventCard (aspect-[4/5] + text below)
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

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <header className="mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-12 lg:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
          <div className="skeleton h-20 w-20 shrink-0 rounded-2xl sm:h-24 sm:w-24" />
          <div className="min-w-0 flex-1">
            {/* the big uppercase name */}
            <Bar className="h-8 w-3/4 max-w-md sm:h-10 lg:h-11" />
            {/* verified · location · joined */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Bar className="h-3.5 w-20" />
              <Bar className="h-3.5 w-24" />
              <Bar className="h-3.5 w-28" />
            </div>
            {/* followers · events · tickets */}
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              <Bar className="h-4 w-28" />
              <Bar className="h-4 w-24" />
              <Bar className="h-4 w-32" />
            </div>
            {/* bio */}
            <div className="mt-4 max-w-[60ch] space-y-2">
              <Bar className="h-4 w-full" />
              <Bar className="h-4 w-4/5" />
            </div>
            {/* follow + social buttons */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Bar className="h-11 w-32 rounded" />
              <div className="skeleton h-11 w-11 rounded" />
              <div className="skeleton h-11 w-11 rounded" />
            </div>
          </div>
        </div>
      </header>

      {/* ── UPCOMING ─────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
        <section className="border-t border-white/10 pt-8 md:pt-10">
          <div className="mb-5">
            <Bar className="h-7 w-48 sm:h-8 sm:w-56" />
            <Bar className="mt-1 h-3.5 w-64 max-w-full" />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
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
        </section>
      </div>
    </div>
  )
}
