'use client'

import { useTranslation } from 'react-i18next'

import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday } from 'date-fns'
import Link from 'next/link'

interface EventData {
  id: string
  title: string
  start_datetime: string
  category: string
  is_published: boolean
}

interface CalendarViewProps {
  events: EventData[]
  currentMonth: Date
  onMonthChange: (date: Date) => void
}

export default function CalendarView({
  events,
  currentMonth,
  onMonthChange
}: CalendarViewProps) {
  const { t } = useTranslation('organizer')

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd })

  // Group events by date
  const eventsByDate = events.reduce((acc, event) => {
    const dateKey = format(new Date(event.start_datetime), 'yyyy-MM-dd')
    if (!acc[dateKey]) {
      acc[dateKey] = []
    }
    acc[dateKey].push(event)
    return acc
  }, {} as Record<string, EventData[]>)

  const handlePreviousMonth = () => {
    const newDate = new Date(currentMonth)
    newDate.setMonth(currentMonth.getMonth() - 1)
    onMonthChange(newDate)
  }

  const handleNextMonth = () => {
    const newDate = new Date(currentMonth)
    newDate.setMonth(currentMonth.getMonth() + 1)
    onMonthChange(newDate)
  }

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  // Calculate the starting day of the week for the month
  const startDayOfWeek = monthStart.getDay()

  // Create array with empty slots for days before month starts
  const calendarDays = [
    ...Array(startDayOfWeek).fill(null),
    ...daysInMonth
  ]

  return (
    <div className="overflow-hidden rounded-xl bg-white/[0.03] shadow-sm">
      {/* Calendar Header */}
      <div className="flex items-center justify-between px-6 py-4 text-white">
        <button
          onClick={handlePreviousMonth}
          className="grid h-11 w-11 place-items-center rounded transition-colors hover:bg-white/[0.08]"
          aria-label={t('calendar.previous_month')}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <h2 className="text-xl font-bold font-mono tabular-nums">
          {format(currentMonth, 'MMMM yyyy')}
        </h2>

        <button
          onClick={handleNextMonth}
          className="grid h-11 w-11 place-items-center rounded transition-colors hover:bg-white/[0.08]"
          aria-label={t('calendar.next_month')}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Week Days Header */}
      <div className="grid grid-cols-7 border-b border-white/10 bg-white/[0.06]">
        {weekDays.map((day) => (
          <div
            key={day}
            className="py-3 text-center text-sm font-semibold text-white/70"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7">
        {calendarDays.map((day, index) => {
          if (!day) {
            return <div key={`empty-${index}`} className="h-28 border-b border-r border-white/[0.06] bg-black/20" />
          }

          const dateKey = format(day, 'yyyy-MM-dd')
          const dayEvents = eventsByDate[dateKey] || []
          const isCurrentMonth = isSameMonth(day, currentMonth)
          const isTodayDate = isToday(day)

          return (
            <div
              key={dateKey}
              className={`min-h-28 border-b border-r border-white/[0.06] p-2 transition-colors ${
                isCurrentMonth ? 'hover:bg-white/[0.07]' : 'bg-black/20'
              }`}
            >
              {/* Day Number */}
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`text-sm font-semibold font-mono tabular-nums ${
                    isTodayDate
                      ? 'w-7 h-7 rounded bg-white text-black flex items-center justify-center'
                      : isCurrentMonth
                      ? 'text-white'
                      : 'text-white/40'
                  }`}
                >
                  {format(day, 'd')}
                </span>
                {dayEvents.length > 0 && (
                  <span className="rounded bg-white/[0.10] px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-white/80">
                    {dayEvents.length}
                  </span>
                )}
              </div>

              {/* Events List */}
              <div className="space-y-1 max-h-20 overflow-y-auto">
                {dayEvents.slice(0, 3).map((event) => (
                  <Link
                    key={event.id}
                    href={`/organizer/events/${event.id}`}
                    className={`block px-2 py-1 rounded text-xs font-medium truncate transition-colors ${
                      event.is_published
                        ? 'bg-white/[0.10] text-brand-200 hover:bg-white/[0.16]'
                        : 'bg-white/[0.08] text-white/70 hover:bg-white/[0.14]'
                    }`}
                    title={event.title}
                  >
                    {format(new Date(event.start_datetime), 'h:mm a')} - {event.title}
                  </Link>
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-xs text-white/50 px-2 font-mono tabular-nums">
                    +{dayEvents.length - 3} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
