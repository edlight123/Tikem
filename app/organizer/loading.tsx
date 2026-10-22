/**
 * Organizer portal loading skeleton.
 *
 * The old one drew its OWN navbar — a `border-b` bar with a logo and a pill —
 * plus `min-h-screen` and `pb-mobile-nav`. All three are already on screen:
 * this file renders INSIDE app/organizer/layout.tsx, which paints
 * OrganizerChrome (`surface-dark min-h-screen chrome-56`) → OrganizerTopNav
 * (h-14 at every width) → `<main class="pb-mobile-nav">`. So every navigation
 * inside the portal flashed a SECOND navbar under the real one and doubled the
 * bottom reservation. It is the page body only now.
 *
 * This boundary is also the fallback for every organizer route without one of
 * its own — marketing, orders, finance, team, analytics, earnings, payouts,
 * scan, promo-codes, verify — so it is built as the portal's common page shape
 * rather than as anything only the dashboard has:
 *
 *   container  max-w-7xl px-4 sm:px-6 lg:px-8 py-6 md:py-8,
 *              space-y-6 md:space-y-8   (OrganizerDashboardClient)
 *   header     PageHeader — eyebrow, h1 mt-1.5 clamp(26px,4vw,38px)
 *              leading 1.02, subtitle mt-1.5, plus a right-hand action button
 *              (px-5 py-2.5 rounded-lg ≈ 42px)
 *   panel      SalesSnapshot — rounded-2xl bg-white/[0.03] p-4 sm:p-5: a title
 *              row (mb-3.5) with a segmented control, then
 *              grid-cols-2 gap-2.5 lg:grid-cols-4 of rounded-xl bg-white/[0.06]
 *              tiles at ~80px
 *   split      grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 — ActionCenter
 *              (rounded-2xl bg-white/[0.03] p-6) beside the payouts widget
 *   list       SectionHeader (mb-5) then space-y-3 of OrganizerEventCard rows:
 *              rounded-2xl bg-white/[0.03] p-3 with a 58×72 poster thumb
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 md:space-y-8 md:py-8 lg:px-8">
      {/* PageHeader */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Bar className="h-2.5 w-20" />
          <Bar className="mt-1.5 h-8 w-48 sm:h-9 sm:w-56" />
          <Bar className="mt-1.5 h-4 w-72 max-w-full" />
        </div>
        <Bar className="h-[42px] w-36 shrink-0 rounded-lg" />
      </div>

      {/* Sales snapshot */}
      <div className="rounded-2xl bg-white/[0.03] p-4 shadow-soft sm:p-5">
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <Bar className="h-5 w-40 sm:h-6" />
          <Bar className="h-9 w-40 shrink-0 rounded" />
        </div>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-white/[0.06] px-3.5 py-3">
              <Bar className="mb-1 h-3 w-16" />
              <Bar className="h-6 w-20" />
              <Bar className="mt-1 h-3 w-14" />
            </div>
          ))}
        </div>
      </div>

      {/* Action centre + payouts */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
        <div className="rounded-2xl bg-white/[0.03] p-6 lg:col-span-2">
          <Bar className="h-6 w-44" />
          <div className="mt-4 space-y-3">
            <Bar className="h-14 w-full rounded-xl" />
            <Bar className="h-14 w-full rounded-xl" />
          </div>
        </div>
        <div className="rounded-2xl bg-white/[0.03] p-6">
          <Bar className="h-6 w-32" />
          <Bar className="mt-4 h-9 w-28" />
          <Bar className="mt-4 h-10 w-full rounded-lg" />
        </div>
      </div>

      {/* Your events */}
      <div>
        <div className="mb-5 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <Bar className="h-2.5 w-20" />
            <Bar className="mt-1.5 h-7 w-44" />
          </div>
          <Bar className="h-3 w-24 shrink-0" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-2xl bg-white/[0.03] p-3"
            >
              <div className="skeleton h-[72px] w-[58px] shrink-0 rounded-none" />
              <div className="min-w-0 flex-1 space-y-2">
                <Bar className="h-4 w-20 rounded" />
                <Bar className="h-4 w-2/3" />
                <Bar className="h-3 w-1/2" />
              </div>
              <div className="hidden shrink-0 items-center gap-6 pr-1 sm:flex">
                <Bar className="h-8 w-12" />
                <Bar className="h-8 w-16" />
              </div>
              <Bar className="h-5 w-5 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
