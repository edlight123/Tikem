/**
 * Organizer → event management tab body loading skeleton — added because this
 * segment had none.
 *
 * Fourteen routes live under /organizer/events/[id] (overview, attendees,
 * orders, tickets, comps, guest-list, staff, promoters, check-in, marketing,
 * messages, tracking, analytics, earnings, edit) and every one of them fell
 * through to app/organizer/loading.tsx, which paints the DASHBOARD. Opening
 * the attendees tab flashed a sales snapshot and a list of other events first.
 *
 * This renders inside app/organizer/events/[id]/layout.tsx, which has already
 * painted EventHeader and the sticky EventTabs bar, so it stands in for the
 * `<main>` body only.
 *
 * Derived geometry — the container every tab body shares:
 *   mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 md:py-8
 * then, generically, a section heading, a row of summary tiles and a list.
 * Kept deliberately neutral: fourteen different tabs share this one boundary,
 * so it draws the shape they have in common rather than any single tab's.
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:py-8 lg:px-8">
      {/* Section heading */}
      <div className="mb-5 flex items-end justify-between gap-4 sm:mb-6">
        <div className="min-w-0">
          <Bar className="h-2.5 w-20" />
          <Bar className="mt-1.5 h-7 w-48" />
        </div>
        <Bar className="h-10 w-28 shrink-0 rounded-lg" />
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-white/[0.03] px-3.5 py-3">
            <Bar className="h-3 w-16" />
            <Bar className="mt-2 h-6 w-20" />
          </div>
        ))}
      </div>

      {/* List body */}
      <div className="mt-6 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-xl bg-white/[0.03] px-4 py-3.5"
          >
            <div className="skeleton h-9 w-9 shrink-0 rounded" />
            <div className="min-w-0 flex-1 space-y-2">
              <Bar className="h-4 w-2/5" />
              <Bar className="h-3 w-1/4" />
            </div>
            <Bar className="hidden h-4 w-24 shrink-0 sm:block" />
            <Bar className="h-4 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
