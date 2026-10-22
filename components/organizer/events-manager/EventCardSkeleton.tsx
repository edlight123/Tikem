/**
 * Placeholder for one OrganizerEventCard row.
 *
 * Measured against the real card (components/organizer/events-manager/
 * OrganizerEventCard): `flex items-center gap-4 rounded-2xl bg-white/[0.03]
 * p-3` with a 58×72 `rounded-none` poster thumb, a status pill over a 15px
 * serif title over a 12.5px meta line, two right-aligned stat columns from sm,
 * and a 20px chevron closing the row — that chevron was missing here, so the
 * row shortened by ~36px on the right the moment the real card landed.
 *
 * Fill comes from `.skeleton` (app/globals.css) rather than `animate-pulse`:
 * a sweep instead of a whole-block fade, and a base that cannot be tuned down
 * to invisible.
 */
export default function EventCardSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-white/[0.03] p-3">
      {/* Poster thumbnail */}
      <div className="skeleton h-[72px] w-[58px] shrink-0 rounded-none" />

      {/* Title + meta */}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="skeleton h-4 w-20 rounded" />
        <div className="skeleton h-4 w-2/3 rounded" />
        <div className="skeleton h-3 w-1/2 rounded" />
      </div>

      {/* Stats */}
      <div className="hidden shrink-0 items-center gap-6 pr-1 sm:flex">
        <div className="skeleton h-8 w-12 rounded" />
        <div className="skeleton h-8 w-16 rounded" />
      </div>

      {/* Chevron */}
      <div className="skeleton h-5 w-5 shrink-0 rounded" />
    </div>
  )
}
