/**
 * Organizer → Settings hub loading skeleton — added because this segment had
 * none.
 *
 * Without it /organizer/settings (and /organizer/settings/payouts and its two
 * children, which have no boundary either) fell through to
 * app/organizer/loading.tsx, so a settings navigation painted the DASHBOARD —
 * a sales snapshot, an action centre and a list of event rows — before
 * replacing the whole thing with a narrow column of grouped links.
 *
 * Page body only: the organizer layout already paints OrganizerTopNav and the
 * `pb-mobile-nav` main.
 *
 * Derived geometry (app/organizer/settings/page.tsx → SettingsContent):
 *   root    bg-canvas
 *   inner   max-w-4xl px-4 sm:px-6 lg:px-8 py-6 md:py-8
 *   header  PageHeader — eyebrow, h1 mt-1.5 clamp(26px,4vw,38px), subtitle
 *   groups  mt-8 space-y-8; each is a SectionHeader (`mb-3`) over an
 *           `overflow-hidden rounded-2xl bg-surface-low divide-y
 *           divide-line-soft` list whose rows carry a 36px rounded-lg
 *           icon tile beside a title and a description
 *   danger  mt-8 — one `rounded-2xl bg-danger-strong/[0.04] px-4 py-4 ring-1
 *           ring-danger-strong/20` row (the red is a ring, never a fill)
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

function LinkRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
      <div className="skeleton h-9 w-9 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <Bar className="h-4 w-40" />
        <Bar className="mt-2 h-3.5 w-56 max-w-full" />
      </div>
      <Bar className="h-4 w-4 shrink-0" />
    </div>
  )
}

export default function SettingsLoading() {
  return (
    <div className="bg-canvas">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 md:py-8 lg:px-8">
        {/* PageHeader */}
        <div>
          <Bar className="h-2.5 w-16" />
          <Bar className="mt-1.5 h-8 w-44 sm:h-9 sm:w-52" />
          <Bar className="mt-1.5 h-4 w-72 max-w-full" />
        </div>

        {/* Grouped link lists */}
        <div className="mt-8 space-y-8">
          {[3, 2, 3].map((rows, group) => (
            <div key={group}>
              <div className="mb-3">
                <Bar className="h-6 w-40" />
              </div>
              <div className="overflow-hidden rounded-2xl bg-surface-low divide-y divide-line-soft">
                {Array.from({ length: rows }).map((_, i) => (
                  <LinkRow key={i} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Danger row */}
        <div className="mt-8 flex items-center gap-4 rounded-2xl bg-danger-strong/[0.04] px-4 py-4 ring-1 ring-danger-strong/20 sm:px-5">
          <div className="skeleton h-9 w-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <Bar className="h-4 w-36" />
            <Bar className="mt-2 h-3.5 w-52 max-w-full" />
          </div>
          <Bar className="h-4 w-4 shrink-0" />
        </div>
      </div>
    </div>
  )
}
