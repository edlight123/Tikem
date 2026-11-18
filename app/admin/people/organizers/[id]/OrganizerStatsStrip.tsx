'use client'

/**
 * The three figures that say how much this organizer has actually done.
 *
 * Same shape as the strip on the user detail screen, deliberately — the two
 * pages are read one after the other and a figure that moves between them costs
 * a second look every time.
 */
export default function OrganizerStatsStrip({
  stats,
}: {
  stats: { totalEvents: number; publishedEvents: number; ticketsSold: number }
}) {
  const figures = [
    { label: 'Total Events', value: stats.totalEvents },
    { label: 'Published Events', value: stats.publishedEvents },
    { label: 'Tickets Sold', value: stats.ticketsSold },
  ]

  return (
    <div className="mb-6 grid grid-cols-3 divide-x divide-console-raise overflow-hidden rounded-lg bg-console-panel">
      {figures.map((f) => (
        <div key={f.label} className="p-4">
          <div className="label-mono text-eyebrow uppercase tracking-wide text-console-mut">{f.label}</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-console-text">{f.value}</div>
        </div>
      ))}
    </div>
  )
}
