'use client'

/**
 * One date-and-time control: the calendar (DatePicker) and the time grid
 * (TimePicker) side by side, never split across lines, with an optional clear.
 * Used for the event's start and end in the composer and for an add-on's
 * sales window (lib/events/dateTimeDefaults has the rules both follow).
 *
 * Two shapes of value: separate `date` ('yyyy-MM-dd') and `time` ('HH:mm')
 * (DateTimeField), or one `datetime-local` string 'yyyy-MM-ddTHH:mm'
 * (DateTimeLocalField, what the add-on drafts store).
 */
import { X } from 'lucide-react'
import { DatePicker, TimePicker } from '@/components/ui/DateTimePickers'
import { toLocalParts } from '@/lib/events/dateTimeDefaults'

export interface DateTimeFieldProps {
  date: string
  time: string
  onChange: (date: string, time: string) => void
  /** Earliest pickable day ('yyyy-MM-dd'). */
  min?: string
  /** Offers "same day as …" in the calendar. */
  sameAs?: string
  invalid?: boolean
  /** The time filled in when a day is picked with no time yet ('HH:mm'); none = leave blank. */
  defaultTime?: string
  datePlaceholder?: string
  timePlaceholder?: string
  /** Shows a clear button when something is set. */
  clearLabel?: string
  /** Shown before the controls (a time-zone label). */
  prefix?: string
}

export function DateTimeField({
  date,
  time,
  onChange,
  min,
  sameAs,
  invalid = false,
  defaultTime,
  datePlaceholder,
  timePlaceholder,
  clearLabel,
  prefix,
}: DateTimeFieldProps) {
  return (
    <div className="flex flex-nowrap items-center gap-2">
      {prefix ? <span className="label-mono shrink-0 text-eyebrow uppercase text-fg-muted">{prefix}</span> : null}
      <DatePicker
        value={date}
        onChange={(d) => onChange(d, time || (d && defaultTime) || '')}
        min={min}
        invalid={invalid}
        sameAs={sameAs}
        placeholder={datePlaceholder}
      />
      <TimePicker value={time} onChange={(tm) => onChange(date, tm)} placeholder={timePlaceholder} />
      {clearLabel && (date || time) ? (
        <button
          type="button"
          onClick={() => onChange('', '')}
          aria-label={clearLabel}
          title={clearLabel}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-fg-faint transition-colors hover:bg-surface-high hover:text-fg"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

/** The same control over one `datetime-local` value ('yyyy-MM-ddTHH:mm', '' = unset). */
export function DateTimeLocalField({
  value,
  onChange,
  ...rest
}: Omit<DateTimeFieldProps, 'date' | 'time' | 'onChange'> & { value: string; onChange: (value: string) => void }) {
  const [date = '', time = ''] = String(value || '').split('T')
  return (
    <DateTimeField
      {...rest}
      date={date}
      time={time.slice(0, 5)}
      onChange={(d, tm) => {
        // A time picked before any day lands on today.
        const day = d || (tm ? toLocalParts(new Date()).date : '')
        onChange(day ? `${day}T${tm || rest.defaultTime || '00:00'}` : '')
      }}
    />
  )
}
