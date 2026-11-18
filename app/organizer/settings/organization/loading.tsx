/**
 * Organizer → Settings → Organization & Brand loading skeleton.
 *
 * Page body only: app/organizer/layout.tsx already paints OrganizerTopNav and
 * the `pb-mobile-nav` main.
 *
 * Derived geometry (app/organizer/settings/organization/page.tsx):
 *   root    min-h-screen bg-canvas py-8
 *   inner   max-w-3xl px-4 sm:px-6 lg:px-8
 *   back    inline text-sm link + 16px chevron, mb-6
 *   header  PageHeader — eyebrow, h1 mt-1.5 clamp(26px,4vw,38px), subtitle
 *           mt-1.5  (the eyebrow was missing here)
 *   card    mt-8 overflow-hidden rounded-2xl bg-surface-low — OrganizationForm:
 *           a logo tile then eight fields (name, type, description, website and
 *           four social handles)
 *
 * The old title bar was `w-96` — 384px inside a 370px content box, so it
 * overflowed horizontally at 402px. Fills now come from `.skeleton`.
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function OrganizationLoading() {
  return (
    <div className="min-h-screen bg-canvas py-8">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <Bar className="mb-6 h-5 w-32" />

        <div>
          <Bar className="h-2.5 w-16" />
          <Bar className="mt-1.5 h-8 w-64 max-w-full sm:h-9 sm:w-80" />
          <Bar className="mt-1.5 h-4 w-72 max-w-full" />
        </div>

        <div className="mt-8 overflow-hidden rounded-2xl bg-surface-low p-6">
          {/* Logo row */}
          <div className="flex items-start gap-6">
            <div className="skeleton h-24 w-24 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <Bar className="h-10 w-32 rounded-lg" />
              <Bar className="mt-2 h-4 w-40" />
            </div>
          </div>

          <div className="mt-6 space-y-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i}>
                <Bar className="mb-2 h-5 w-32" />
                <Bar className="h-11 w-full rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
