/**
 * Organizer → My Events loading skeleton.
 *
 * The old one painted `bg-gradient-to-br from-surface to-surface-raised` across the
 * whole main area — a grey wash over a black portal, the same family of
 * mistake as the white band this codebase used to strobe on navigation — and
 * it drew the wrong body: a filter row of three pills over
 * `LoadingSkeleton rows={6}`, whose square thumbnails are not the 58×72 poster
 * rows this page lists. It also re-applied `pb-mobile-nav`, which the
 * organizer shell's `<main>` already carries.
 *
 * What it stands in for is the page's OWN first paint (app/organizer/events/
 * page.tsx, the `authLoading || (loading && !events.length)` branch), so the
 * two skeletons are now the same picture and nothing moves between them:
 *
 *   min-h-screen bg-canvas
 *     max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-10
 *       PageHeader — eyebrow, h1 mt-1.5 clamp(26px,4vw,38px), subtitle mt-1.5
 *                    (no action button in the loading branch)
 *       mt-8 space-y-3 — six EventCardSkeleton rows
 */

import EventCardSkeleton from '@/components/organizer/events-manager/EventCardSkeleton'

function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {/* PageHeader */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Bar className="h-2.5 w-20" />
            <Bar className="mt-1.5 h-8 w-48 sm:h-9 sm:w-56" />
            <Bar className="mt-1.5 h-4 w-72 max-w-full" />
          </div>
        </div>

        <div className="mt-8 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <EventCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
