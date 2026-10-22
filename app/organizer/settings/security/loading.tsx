/**
 * Organizer → Settings → Security loading skeleton.
 *
 * Page body only: the organizer layout already paints OrganizerTopNav and the
 * `pb-mobile-nav` main.
 *
 * Derived geometry (app/organizer/settings/security/page.tsx → SecurityForm):
 *   root    min-h-screen bg-[#0a0a0a] py-8
 *   inner   max-w-5xl px-4 sm:px-6 lg:px-8
 *   back    inline text-sm link + 16px chevron, mb-6
 *   header  PageHeader — eyebrow, h1 mt-1.5 clamp(26px,4vw,38px), subtitle
 *           mt-1.5  (the eyebrow was missing here). SecurityForm follows with
 *           NO top margin, so nothing sits between them.
 *   cards   space-y-6 of three `rounded-xl bg-white/[0.03] p-6`:
 *             1. Change Password — a 20px serif heading, then three
 *                `py-3 rounded` fields in a max-w-md column and a submit
 *             2. Two-Factor — heading + copy with a small status pill right
 *             3. Recent Login Activity — a p-6 head over `divide-y` p-4 rows
 *
 * The old `w-96` subtitle bar is gone: 384px inside a 370px content box
 * overflowed horizontally at 402px, and every fill now uses `.skeleton`.
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function SecurityLoading() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] py-8">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <Bar className="mb-6 h-5 w-32" />

        {/* No bottom margin: SecurityForm below has no top margin either, so
            on the real page the first card butts straight against the header. */}
        <div>
          <Bar className="h-2.5 w-16" />
          <Bar className="mt-1.5 h-8 w-44 sm:h-9 sm:w-52" />
          <Bar className="mt-1.5 h-4 w-72 max-w-full" />
        </div>

        <div className="space-y-6">
          {/* Change Password */}
          <div className="rounded-xl bg-white/[0.03] p-6">
            <Bar className="mb-6 h-5 w-48" />
            <div className="max-w-md space-y-4">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <Bar className="mb-2 h-5 w-32" />
                  <Bar className="h-12 w-full rounded" />
                </div>
              ))}
              <Bar className="h-11 w-36 rounded-lg" />
            </div>
          </div>

          {/* Two-Factor */}
          <div className="rounded-xl bg-white/[0.03] p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Bar className="h-5 w-56 max-w-full" />
                <Bar className="mt-2 h-4 w-72 max-w-full" />
              </div>
              <Bar className="h-6 w-24 shrink-0 rounded" />
            </div>
          </div>

          {/* Recent Login Activity */}
          <div className="overflow-hidden rounded-xl bg-white/[0.03]">
            <div className="p-6">
              <Bar className="h-5 w-52" />
              <Bar className="mt-2 h-4 w-64 max-w-full" />
            </div>
            <div className="divide-y divide-white/10">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Bar className="h-5 w-40" />
                      <Bar className="h-4 w-56 max-w-full" />
                    </div>
                    <Bar className="h-4 w-24 shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
