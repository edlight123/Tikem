import { color } from '@/lib/design/tokens'
/**
 * Loading boundary for the whole /admin subtree.
 *
 * It renders inside app/admin/layout.tsx, which has already painted the sticky
 * rail and the AdminCommandBar, so this stands in for the page body only —
 * that part was right and is unchanged.
 *
 * Deliberately NOT the `.skeleton` sweep used on the public site: that class
 * bakes in an rgba(255,255,255,0.06) fill tuned for the black canvas, and the
 * Control Room is its own world (`console-ground` ${color.console.ground} with elevation
 * steps). `console-panel` here is the exact colour of the row that arrives.
 *
 * Derived geometry (ConsolePage → ConsoleRow):
 *   container  mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8
 *   header     a 15px mono caps title in a `mb-1` row with a right-aligned
 *              mono figure, then `mt-4` before the body (this used mt-6)
 *   rows       flex flex-col gap-1.5 of ConsoleRow: `flex items-center gap-4
 *              rounded-r-md border-l-2 bg-console-panel px-4 py-3`, the 2px
 *              left edge carrying the age tier (faint until a real age lands)
 */

function Shimmer({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-console-panel ${className ?? ''}`} />
}

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <Shimmer className="h-5 w-44" />
        <Shimmer className="h-4 w-24" />
      </div>
      <div className="mt-4 flex flex-col gap-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-r-md border-l-2 border-console-faint bg-console-panel px-4 py-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Shimmer className="h-3.5 w-1/3 bg-console-raise" />
              <Shimmer className="h-3 w-1/4 bg-console-raise" />
            </div>
            <Shimmer className="h-3.5 w-10 bg-console-raise" />
          </div>
        ))}
      </div>
    </div>
  )
}
