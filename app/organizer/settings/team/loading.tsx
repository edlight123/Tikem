/**
 * Organizer → Settings → Team & Permissions loading skeleton.
 *
 * This had drifted onto a layout the page does not have: a five-column table
 * with a header row and three body rows. The real page shows a three-cell
 * stats strip and then a two-column split (staff manager beside a guidelines
 * sidebar) — no table anywhere. Its container was `max-w-5xl` against a real
 * `max-w-6xl`, and its `py-8` sat on the wrong element.
 *
 * Page body only: the organizer layout already paints OrganizerTopNav and the
 * `pb-mobile-nav` main.
 *
 * Derived geometry (app/organizer/settings/team/page.tsx):
 *   root    min-h-screen bg-canvas   (no padding here)
 *   inner   max-w-6xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10
 *   back    inline text-sm link + 16px chevron, mb-6
 *   header  PageHeader — eyebrow, h1 mt-1.5 clamp(26px,4vw,38px), subtitle
 *           mt-1.5
 *   stats   grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10 of
 *           `rounded-xl bg-surface-low p-4`, each a 48px icon tile beside an
 *           11px caps label over a value
 *   split   grid-cols-1 xl:grid-cols-3 gap-8 — main column xl:col-span-2, then
 *           a `space-y-6` sidebar whose first card is `rounded-xl p-5`
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function TeamLoading() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Bar className="mb-6 h-5 w-32" />

        <div>
          <Bar className="h-2.5 w-16" />
          <Bar className="mt-1.5 h-8 w-64 max-w-full sm:h-9 sm:w-80" />
          <Bar className="mt-1.5 h-4 w-72 max-w-full" />
        </div>

        {/* Stats strip. `mb-10` and no top margin — the real grid butts
            straight against the header, as PageHeader carries none. */}
        <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl bg-surface-low p-4">
              <div className="flex items-center gap-3">
                <div className="skeleton h-12 w-12 shrink-0 rounded-lg" />
                <div className="min-w-0">
                  <Bar className="h-3 w-28" />
                  <Bar className="mt-2 h-6 w-16" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Staff manager + guidelines sidebar */}
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <div className="rounded-xl bg-surface-low p-5">
              <Bar className="h-6 w-40" />
              <div className="mt-4 space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <Bar key={i} className="h-14 w-full rounded-lg" />
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-6">
            <div className="rounded-xl bg-surface-low p-5">
              <Bar className="mb-3 h-6 w-32" />
              <div className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <Bar key={i} className={`h-4 ${i === 3 ? 'w-2/3' : 'w-full'}`} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
