/**
 * Organizer → Settings → Profile loading skeleton.
 *
 * Renders inside app/organizer/layout.tsx (OrganizerChrome → OrganizerTopNav
 * h-14 → `<main class="pb-mobile-nav">`), so this is the page body only — no
 * navbar, no bottom reservation.
 *
 * Derived geometry (app/organizer/settings/profile/page.tsx):
 *   root    min-h-screen bg-canvas py-8
 *   inner   max-w-3xl px-4 sm:px-6 lg:px-8
 *   back    inline text-sm link + 16px chevron, mb-6
 *   header  PageHeader — eyebrow, h1 mt-1.5 clamp(26px,4vw,38px) leading 1.02,
 *           subtitle mt-1.5 at 14/15px  (the eyebrow was missing here)
 *   card    mt-8 overflow-hidden rounded-2xl bg-surface-low — ProfileForm:
 *           an avatar row then three fields and a submit
 *   note    mt-6 p-4 rounded-lg bg-surface-low
 *
 * `animate-pulse` and hand-set fills replaced by `.skeleton`, and the old
 * `w-96` bars are gone: 384px inside a 370px content box overflowed
 * horizontally at 402px.
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function ProfileLoading() {
  return (
    <div className="min-h-screen bg-canvas py-8">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <Bar className="mb-6 h-5 w-32" />

        <div>
          <Bar className="h-2.5 w-16" />
          <Bar className="mt-1.5 h-8 w-56 sm:h-9 sm:w-64" />
          <Bar className="mt-1.5 h-4 w-72 max-w-full" />
        </div>

        <div className="mt-8 overflow-hidden rounded-2xl bg-surface-low p-6">
          {/* Avatar row */}
          <div className="flex items-start gap-6">
            <div className="skeleton h-24 w-24 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Bar className="h-10 w-40 rounded-lg" />
              <Bar className="mt-2 h-4 w-32" />
            </div>
          </div>

          {/* Fields */}
          <div className="mt-6 space-y-6">
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <Bar className="mb-2 h-5 w-24" />
                <Bar className="h-11 w-full rounded-lg" />
              </div>
            ))}
            <div className="flex justify-end pt-4">
              <Bar className="h-11 w-32 rounded-lg" />
            </div>
          </div>
        </div>

        {/* Info notice */}
        <div className="mt-6 rounded-lg bg-surface-low p-4">
          <Bar className="h-4 w-full" />
          <Bar className="mt-2 h-4 w-2/3" />
        </div>
      </div>
    </div>
  )
}
