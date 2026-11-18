/**
 * Organizer → Settings → Event Defaults loading skeleton.
 *
 * Page body only: the organizer layout already paints OrganizerTopNav and the
 * `pb-mobile-nav` main.
 *
 * Derived geometry (app/organizer/settings/defaults/page.tsx):
 *   root    min-h-screen bg-canvas py-8
 *   inner   max-w-3xl px-4 sm:px-6 lg:px-8
 *   back    inline text-sm link + 16px chevron, mb-6
 *   header  PageHeader — eyebrow, h1 mt-1.5 clamp(26px,4vw,38px), subtitle
 *           mt-1.5  (the eyebrow was missing here)
 *   card    mt-8 overflow-hidden rounded-2xl bg-surface-low — DefaultsForm:
 *           a two-up grid (city, country), two more fields (timezone,
 *           currency), then the default-categories chip grid
 *   note    mt-6 p-4 rounded-lg bg-surface-low  (this was missing here)
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function DefaultsLoading() {
  return (
    <div className="min-h-screen bg-canvas py-8">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <Bar className="mb-6 h-5 w-32" />

        <div>
          <Bar className="h-2.5 w-16" />
          <Bar className="mt-1.5 h-8 w-56 sm:h-9 sm:w-64" />
          <Bar className="mt-1.5 h-4 w-72 max-w-full" />
        </div>

        <div className="mt-8 space-y-6 overflow-hidden rounded-2xl bg-surface-low p-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i}>
                <Bar className="mb-2 h-5 w-28" />
                <Bar className="h-11 w-full rounded-lg" />
              </div>
            ))}
          </div>
          {[0, 1].map((i) => (
            <div key={i}>
              <Bar className="mb-2 h-5 w-32" />
              <Bar className="h-11 w-full rounded-lg" />
            </div>
          ))}
          <div>
            <Bar className="mb-3 h-5 w-40" />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Bar key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          </div>
        </div>

        {/* Info notice */}
        <div className="mt-6 rounded-lg bg-surface-low p-4">
          <Bar className="h-4 w-full" />
          <Bar className="mt-2 h-4 w-3/4" />
        </div>
      </div>
    </div>
  )
}
