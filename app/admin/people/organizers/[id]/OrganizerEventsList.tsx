'use client'

import Link from 'next/link'
import { ConsolePanel, ConsoleState, consoleTone } from '@/components/admin/console'
import { EMPTY_VALUE } from '@/lib/format'

export type OrganizerEventRow = {
  id: string
  title: string
  city: string
  country: string
  category: string
  start_datetime: string | null
  created_at: string | null
  is_published: boolean
  rejected: boolean
  reports_count: number
  tickets_sold: number
  total_tickets: number
  currency: string | null
}

/** ISO-sliced so the server and client agree — same approach as the rest of this page. */
function formatDay(dateStr: string | null): string {
  if (!dateStr) return EMPTY_VALUE
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return EMPTY_VALUE
  return date.toISOString().slice(0, 10)
}

export default function OrganizerEventsList({
  events,
  totalEvents,
  truncated,
}: {
  events: OrganizerEventRow[]
  totalEvents: number
  truncated: boolean
}) {
  return (
    <ConsolePanel className="p-4 sm:p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="label-mono text-[10px] uppercase tracking-[0.18em] text-console-faint">Events</h2>
        {truncated && (
          <span className="label-mono text-[11px] tabular-nums text-console-faint">
            Showing {events.length} of {totalEvents}
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <p className="py-6 text-center text-sm text-console-faint">This organizer hasn&rsquo;t created any events.</p>
      ) : (
        <ul className="divide-y divide-console-raise">
          {events.map((event) => {
            const place = [event.city, event.country].filter(Boolean).join(', ')
            const stateLabel = event.rejected ? 'Unpublished' : event.is_published ? 'Published' : 'Pending'
            return (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="-mx-2 flex items-center gap-4 rounded px-2 py-3 transition-colors hover:bg-console-raise"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-console-text">{event.title}</p>
                    <p className="mt-0.5 truncate text-xs text-console-mut">
                      {formatDay(event.start_datetime)}
                      {place && ` · ${place}`}
                      {event.category && ` · ${event.category}`}
                    </p>
                  </div>

                  <div className="hidden shrink-0 text-right sm:block">
                    <div className="font-mono text-sm tabular-nums text-console-text">
                      {event.tickets_sold}
                      {event.total_tickets > 0 && (
                        <span className="text-console-faint">/{event.total_tickets}</span>
                      )}
                    </div>
                    <div className="label-mono text-[10px] uppercase tracking-wide text-console-faint">Sold</div>
                  </div>

                  <ConsoleState tone={consoleTone(stateLabel)}>
                    <span className="hidden sm:inline">{stateLabel}</span>
                  </ConsoleState>

                  {event.reports_count > 0 && (
                    <span className="label-mono shrink-0 text-xs font-semibold tabular-nums text-console-amber" title={`${event.reports_count} report(s)`}>
                      ⚑ {event.reports_count}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {truncated && (
        <div className="mt-4 border-t border-console-raise pt-3">
          <Link href="/admin/events" className="text-sm font-medium text-console-mut hover:text-console-text">
            Open the events console →
          </Link>
        </div>
      )}
    </ConsolePanel>
  )
}
