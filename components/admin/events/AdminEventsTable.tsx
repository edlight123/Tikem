'use client'

import { format } from 'date-fns'
import { ConsoleState, consoleTone } from '@/components/admin/console'
import { EMPTY_VALUE } from '@/lib/format'

// Some legacy/seed events carry a missing or malformed start_datetime. Passing an
// Invalid Date to date-fns `format` throws "RangeError: Invalid time value" and
// crashes the whole moderation table, so format defensively.
function formatEventDate(value?: string): string {
  if (!value) return EMPTY_VALUE
  const d = new Date(value)
  return isNaN(d.getTime()) ? EMPTY_VALUE : format(d, 'MMM d, yyyy')
}

interface Event {
  id: string
  title: string
  start_datetime: string
  city: string
  is_published: boolean
  organizer_name: string
  organizer_email: string
  reports_count?: number
}

interface AdminEventsTableProps {
  events: Event[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onRowClick: (event: Event) => void
}

const HEADERS = ['Event', 'Date', 'City', 'Status', 'Organizer', 'Reports'] as const

function EventStatus({ event }: { event: Event }) {
  const status = event.is_published ? 'published' : 'draft'
  return (
    <ConsoleState tone={consoleTone(status)}>
      {event.is_published ? 'Published' : 'Draft'}
    </ConsoleState>
  )
}

function ReportsCell({ event }: { event: Event }) {
  return event.reports_count && event.reports_count > 0 ? (
    <span className="label-mono text-sm tabular-nums text-console-amber">{event.reports_count}</span>
  ) : (
    <span className="text-sm text-console-faint">{EMPTY_VALUE}</span>
  )
}

export function AdminEventsTable({
  events,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRowClick
}: AdminEventsTableProps) {
  const allSelected = events.length > 0 && events.every((e) => selectedIds.has(e.id))
  const someSelected = !allSelected && events.some((e) => selectedIds.has(e.id))

  const checkboxClass = 'w-4 h-4 rounded accent-console-text focus:outline-none focus:ring-2 focus:ring-console-mut'

  if (events.length === 0) {
    return (
      <div className="rounded-lg bg-console-panel p-8 text-center">
        <p className="text-sm text-console-mut">No events found</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg bg-console-panel">
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-console-panel">
            <tr>
              <th className="w-12 px-4 py-3 sm:px-6">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected
                  }}
                  onChange={onToggleSelectAll}
                  className={checkboxClass}
                />
              </th>
              {HEADERS.map((header) => (
                <th
                  key={header}
                  className="label-mono px-4 py-3 text-left text-[10px] uppercase tracking-wide text-console-faint sm:px-6"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-console-raise">
            {events.map((event) => (
              <tr
                key={event.id}
                onClick={() => onRowClick(event)}
                className="cursor-pointer transition-colors hover:bg-console-raise"
              >
                <td className="px-4 py-3 sm:px-6" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label="Select row"
                    checked={selectedIds.has(event.id)}
                    onChange={() => onToggleSelect(event.id)}
                    className={checkboxClass}
                  />
                </td>
                <td className="px-4 py-3 align-middle sm:px-6">
                  <div className="text-sm font-medium text-console-text line-clamp-1">{event.title}</div>
                </td>
                <td className="px-4 py-3 align-middle sm:px-6">
                  <span className="label-mono whitespace-nowrap text-sm tabular-nums text-console-mut">
                    {formatEventDate(event.start_datetime)}
                  </span>
                </td>
                <td className="px-4 py-3 align-middle sm:px-6">
                  <span className="label-mono whitespace-nowrap text-sm text-console-mut">{event.city}</span>
                </td>
                <td className="px-4 py-3 align-middle sm:px-6">
                  <EventStatus event={event} />
                </td>
                <td className="px-4 py-3 align-middle sm:px-6">
                  <div>
                    <div className="text-sm text-console-text">{event.organizer_name}</div>
                    <div className="text-xs text-console-mut">{event.organizer_email}</div>
                  </div>
                </td>
                <td className="px-4 py-3 align-middle sm:px-6">
                  <ReportsCell event={event} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="divide-y divide-console-raise md:hidden">
        {events.map((event) => (
          <div key={event.id} onClick={() => onRowClick(event)} className="cursor-pointer p-4">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selectedIds.has(event.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation()
                  onToggleSelect(event.id)
                }}
                className={`mt-1 ${checkboxClass}`}
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h4 className="font-medium text-console-text text-sm line-clamp-2">{event.title}</h4>
                  {event.reports_count && event.reports_count > 0 ? (
                    <span className="flex-shrink-0">
                      <ReportsCell event={event} />
                    </span>
                  ) : null}
                </div>

                <div className="space-y-1 text-xs text-console-mut">
                  <div className="label-mono tabular-nums">{formatEventDate(event.start_datetime)}</div>
                  <div className="label-mono">{event.city}</div>
                  <div>{event.organizer_name}</div>
                </div>

                <div className="mt-2">
                  <EventStatus event={event} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
