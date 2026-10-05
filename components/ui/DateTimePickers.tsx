'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Clock, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react'
import {
  format,
  addDays,
  addMonths,
  subMonths,
  setMonth,
  setYear,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  isBefore,
  startOfDay,
} from 'date-fns'
import { enUS, fr, ht, type Locale } from 'date-fns/locale'

const LOCALES: Record<string, Locale> = { en: enUS, fr, ht }

function useDateLocale(): Locale {
  const { i18n } = useTranslation()
  const lang = (i18n?.language || 'en').slice(0, 2)
  return LOCALES[lang] || enUS
}

/** Parse a 'yyyy-MM-dd' string into a local Date (no timezone drift). */
function parseDateValue(value?: string): Date | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

/** The one place a Date becomes the 'yyyy-MM-dd' contract callers store. */
function toDateValue(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** The one place hour+minute become the 'HH:mm' contract callers store. */
function toTimeValue(h: number, m: number): string {
  return `${pad2(h)}:${pad2(m)}`
}

// ---------------------------------------------------------------------------
// Escape: one press closes exactly one layer
// ---------------------------------------------------------------------------

/**
 * Two listeners on `document` cannot stop each other — `stopPropagation` does
 * nothing between siblings on the same node, which is why the guest sheet
 * already resolves Escape by asking which `[role=dialog][aria-modal]` is LAST
 * in the document (components/organizer/GuestEditorSheet.tsx). PickerModal
 * plays by that same rule below.
 *
 * The rule cannot see layers that are not dialogs, though — the calendar's
 * month/year panel lives *inside* the dialog. So a layer inside the modal
 * registers here, and PickerModal offers Escape to the innermost registrant
 * before closing itself. One press, one layer, no document listeners racing.
 */
const escapeInterceptors: Array<() => void> = []

function useEscapeInterceptor(active: boolean, handler: () => void) {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    if (!active) return
    const fn = () => latest.current()
    escapeInterceptors.push(fn)
    return () => {
      const i = escapeInterceptors.indexOf(fn)
      if (i >= 0) escapeInterceptors.splice(i, 1)
    }
  }, [active])
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/**
 * A real filled control, not a hairline around nothing.
 *
 * This was `border` + `bg-white/[0.03]` — a visible ring over a fill so faint
 * it read as empty, which is the exact pattern the owner rejected across the
 * composer's left column ("not every box needs to be a border w empty fill")
 * and then again for these two ("i dont like the light border and no fill. see
 * how you can make it more premium"). So the ring is gone and the fill does the
 * work: `bg-white/[0.07]` is the composer's own field surface, lifting to
 * `.12` on hover so the control still answers the cursor. Focus keeps a real
 * ring — that one is not decoration, it is how a keyboard user finds it.
 *
 * min-h-11 on phones: at 34px these were under the 44px touch floor, and they
 * are how every date and time in the app gets set. Desktop keeps the tighter
 * height via sm:.
 *
 * `tabular-nums` is load-bearing, not typography: it makes every digit the same
 * width, so "1:05 PM" and "12:45 PM" differ by a known number of glyphs rather
 * than by whatever the font feels like — which is what lets <StableWidth> below
 * reserve an exact width.
 */
const triggerBase =
  'inline-flex min-h-11 items-center gap-2 rounded-lg bg-white/[0.07] px-3 py-1.5 text-sm font-semibold tabular-nums text-white transition-colors hover:bg-white/[0.12] focus:outline-none focus:ring-2 focus:ring-brand-400/40 sm:min-h-0'

/**
 * THE REFLOW FIX.
 *
 * The owner: *"when i select a date, it shows two lines. start on top and a
 * second line… i dont want it to be moving position."* The trigger was the
 * culprit. Empty it says "Pick a date"; filled it said `EEE, PP` —
 * "Tue, Jan 20, 2026", and "mar., 20 janv. 2026" in fr/ht. That is ~60px wider,
 * and the composer's Dates row is a wrapping flex, so the first tap grew the
 * button, overflowed the row and threw the Time button onto a second line —
 * the layout moved out from under the finger that had just tapped it.
 *
 * A `min-w-[Npx]` does not fix it: the filled label still exceeds the floor and
 * still grows. A fixed `w-[Npx]` does, but only if the magic number is right in
 * three locales, at whatever the font actually measures — and it silently
 * truncates the day it is wrong.
 *
 * So the width is reserved by the browser instead of by me. Every label the
 * control can ever show is rendered into the SAME grid cell; all but the real
 * one are `invisible`. A grid cell is as wide as its widest occupant, so the
 * button is permanently the width of its own worst case, measured in the real
 * font, in the real locale — and choosing a value cannot change it by a pixel.
 * Nothing truncates, because nothing can be wider than the reservation.
 */
function StableWidth({ label, candidates }: { label: string; candidates: string[] }) {
  return (
    <span className="grid text-left">
      {candidates.map((c, i) => (
        <span key={i} aria-hidden="true" className="invisible col-start-1 row-start-1 whitespace-nowrap">
          {c}
        </span>
      ))}
      <span className="col-start-1 row-start-1 flex items-center whitespace-nowrap">{label}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// PickerModal
// ---------------------------------------------------------------------------

/**
 * Bottom sheet on phones, centred from sm. Portaled to <body> so it can never
 * be clipped — or, worse, re-anchored — by an ancestor with `overflow-hidden`,
 * `transform`, `filter` or `backdrop-blur`, each of which makes itself the
 * containing block for `position: fixed` and has broken sheets here twice.
 *
 * `svh` not `vh` for the height cap: on iOS `100vh` is the chrome-less height,
 * so a `vh` cap overshoots the visible area and pushes a sheet header up under
 * the navbar.
 */
function PickerModal({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-sm',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  maxWidth?: string
}) {
  const { t } = useTranslation('common')
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // A layer inside this modal (the month/year panel) gets it first.
      const inner = escapeInterceptors[escapeInterceptors.length - 1]
      if (inner) {
        e.stopPropagation()
        inner()
        return
      }
      // Otherwise only the topmost dialog in the document answers.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      if (dialogs.length && dialogs[dialogs.length - 1] !== dialogRef.current) return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        className={`relative z-[101] max-h-[88svh] w-full ${maxWidth} overflow-y-auto overscroll-contain rounded-t-2xl border border-white/10 bg-[#111] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl sm:pb-4`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            className="grid h-9 w-9 place-items-center rounded-lg text-white/50 hover:bg-white/[0.12] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// Shared chip — the app-wide spec, so a shortcut here is the same object as a
// filter chip on discover: rounded-[10px], 30px of ink, 13px type, and a 44px
// touch target contributed by an ::after that is bigger than the paint.
// ---------------------------------------------------------------------------

function quickChipCls(on: boolean, disabled = false) {
  return [
    'relative rounded-[10px] px-2.5 py-1.5 text-[13px] leading-[18px] font-semibold transition-colors',
    "after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-['']",
    disabled
      ? 'cursor-not-allowed bg-white/[0.03] text-white/25'
      : on
      ? 'bg-white text-black'
      : 'bg-white/[0.07] text-white/80 hover:bg-white/[0.12] hover:text-white',
  ].join(' ')
}

// ---------------------------------------------------------------------------
// InlineCalendar — the month grid, controlled. Reused by DatePicker + discover.
// ---------------------------------------------------------------------------

export function InlineCalendar({
  value,
  onChange,
  min,
  sameAs,
  sameAsLabel,
  autoFocus = false,
}: {
  value: string // 'yyyy-MM-dd'
  onChange: (value: string) => void
  min?: string // 'yyyy-MM-dd'
  /**
   * A one-tap shortcut to a date the caller already knows about. This exists
   * for the composer's END field: 25 of 27 production events have no end date
   * at all, and "same day as the start" is the answer virtually every one of
   * them wants. Pass the start date here and it becomes a chip.
   */
  sameAs?: string // 'yyyy-MM-dd'
  sameAsLabel?: string
  /** Move keyboard focus onto the selected day on mount (the modal case). */
  autoFocus?: boolean
}) {
  const { t } = useTranslation('common')
  const locale = useDateLocale()
  const selected = parseDateValue(value)
  const minDate = parseDateValue(min)
  const today = useMemo(() => startOfDay(new Date()), [])

  const [view, setView] = useState<Date>(() => selected || minDate || today)
  const [mode, setMode] = useState<'days' | 'months'>('days')
  const [focused, setFocused] = useState<Date>(() => selected || minDate || today)

  const gridRef = useRef<HTMLDivElement>(null)
  const wantFocus = useRef(autoFocus)

  const isDisabled = useCallback(
    (d: Date) => (minDate ? isBefore(startOfDay(d), startOfDay(minDate)) : false),
    [minDate]
  )

  // Escape leaves the month/year panel rather than throwing the whole modal
  // away — the innermost layer answers first (see useEscapeInterceptor).
  useEscapeInterceptor(mode === 'months', () => setMode('days'))

  const weeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(view), { locale })
    const end = endOfWeek(endOfMonth(view), { locale })
    const days = eachDayOfInterval({ start, end })
    const out: Date[][] = []
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7))
    return out
  }, [view, locale])

  const weekdayLabels = useMemo(
    () => weeks[0]?.map((d) => format(d, 'EEEEEE', { locale })) ?? [],
    [weeks, locale]
  )

  const focusedKey = toDateValue(focused)

  // Roving focus: only the focused cell is tabbable, and after an arrow key we
  // put the caret where the user just moved it.
  useEffect(() => {
    if (!wantFocus.current || mode !== 'days') return
    const el = gridRef.current?.querySelector<HTMLElement>('[data-focused="true"]')
    el?.focus({ preventScroll: true })
  }, [focusedKey, mode])

  const moveFocus = (next: Date) => {
    wantFocus.current = true
    setFocused(next)
    if (!isSameMonth(next, view)) setView(startOfMonth(next))
  }

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    if (e.key in map) {
      e.preventDefault()
      moveFocus(addDays(focused, map[e.key]))
      return
    }
    if (e.key === 'PageUp') {
      e.preventDefault()
      moveFocus(subMonths(focused, 1))
      return
    }
    if (e.key === 'PageDown') {
      e.preventDefault()
      moveFocus(addMonths(focused, 1))
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      moveFocus(startOfWeek(focused, { locale }))
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      moveFocus(endOfWeek(focused, { locale }))
    }
  }

  const pick = (d: Date) => {
    if (isDisabled(d)) return
    setFocused(d)
    onChange(toDateValue(d))
  }

  const jumpTo = (d: Date) => {
    setView(startOfMonth(d))
    setFocused(d)
    onChange(toDateValue(d))
  }

  // A month whose LAST day is still before `min` can hold nothing selectable,
  // so the arrow that would reach it is genuinely dead, not merely unhelpful.
  const prevMonth = subMonths(view, 1)
  const prevDisabled = minDate ? isBefore(endOfMonth(prevMonth), startOfDay(minDate)) : false

  const sameAsDate = parseDateValue(sameAs)
  const todayDisabled = isDisabled(today)
  const todaySelected = Boolean(selected && isSameDay(selected, today))
  const sameAsSelected = Boolean(selected && sameAsDate && isSameDay(selected, sameAsDate))

  return (
    <div className="relative">
      {/* Month header: ‹ · a real month/year switch · › */}
      <div className="mb-2 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => setView(prevMonth)}
          disabled={prevDisabled}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:text-white/20 disabled:hover:bg-transparent"
          aria-label={t('pickers.prev_month', { defaultValue: 'Previous month' })}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {/* Eleven taps on "next" to reach next August is not a date picker. */}
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'days' ? 'months' : 'days'))}
          aria-expanded={mode === 'months'}
          // The visible month has to survive into the accessible name (WCAG
          // Label in Name), so the hint is appended rather than substituted.
          aria-label={`${format(view, 'LLLL yyyy', { locale })}, ${t('pickers.choose_month', {
            defaultValue: 'Choose month and year',
          })}`}
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold capitalize text-white transition-colors hover:bg-white/[0.12] focus:outline-none focus:ring-2 focus:ring-brand-400/40"
        >
          {format(view, 'LLLL yyyy', { locale })}
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-white/50 transition-transform ${mode === 'months' ? 'rotate-180' : ''}`}
          />
        </button>

        <button
          type="button"
          onClick={() => setView(addMonths(view, 1))}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.12] hover:text-white"
          aria-label={t('pickers.next_month', { defaultValue: 'Next month' })}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {mode === 'months' ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => setView((v) => setYear(v, v.getFullYear() - 1))}
              className="grid h-11 w-11 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.12] hover:text-white"
              aria-label={t('pickers.prev_year', { defaultValue: 'Previous year' })}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold tabular-nums text-white">{format(view, 'yyyy')}</span>
            <button
              type="button"
              onClick={() => setView((v) => setYear(v, v.getFullYear() + 1))}
              className="grid h-11 w-11 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.12] hover:text-white"
              aria-label={t('pickers.next_year', { defaultValue: 'Next year' })}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 12 }, (_, m) => {
              const monthDate = setMonth(startOfMonth(view), m)
              const disabled = minDate ? isBefore(endOfMonth(monthDate), startOfDay(minDate)) : false
              const on = view.getMonth() === m
              return (
                <button
                  key={m}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setView(monthDate)
                    setMode('days')
                  }}
                  className={[
                    'min-h-11 rounded-lg text-sm font-semibold capitalize transition-colors',
                    disabled
                      ? 'cursor-not-allowed bg-white/[0.03] text-white/20'
                      : on
                      ? 'bg-white text-black'
                      : 'bg-white/[0.07] text-white/80 hover:bg-white/[0.12] hover:text-white',
                  ].join(' ')}
                >
                  {format(monthDate, 'LLL', { locale })}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-1 grid grid-cols-7 gap-0.5">
            {weekdayLabels.map((w, i) => (
              <div key={i} className="py-1 text-center text-[10px] font-medium uppercase tracking-wide text-white/35">
                {w}
              </div>
            ))}
          </div>

          <div ref={gridRef} role="grid" className="space-y-0.5" onKeyDown={onGridKeyDown}>
            {weeks.map((week, wi) => (
              <div key={wi} role="row" className="grid grid-cols-7 gap-0.5">
                {week.map((day, i) => {
                  const inMonth = isSameMonth(day, view)
                  const isSel = Boolean(selected && isSameDay(day, selected))
                  const disabled = isDisabled(day)
                  const isFocused = isSameDay(day, focused)
                  return (
                    <button
                      key={i}
                      type="button"
                      role="gridcell"
                      // `aria-disabled`, not `disabled`: an out-of-range day
                      // still has to accept focus or the arrow keys lose the
                      // caret the moment they cross the boundary. `pick()`
                      // refuses the activation instead.
                      aria-disabled={disabled || undefined}
                      aria-selected={isSel}
                      aria-current={isToday(day) ? 'date' : undefined}
                      aria-label={format(day, 'PPPP', { locale })}
                      data-focused={isFocused ? 'true' : undefined}
                      tabIndex={isFocused ? 0 : -1}
                      onClick={() => pick(day)}
                      className={[
                        'grid h-11 w-full place-items-center rounded-lg text-sm tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70',
                        // Selected is the only pure white in here; today is the
                        // only teal, and it means exactly one thing.
                        isSel
                          ? 'bg-white font-semibold text-black'
                          : disabled
                          ? 'cursor-not-allowed text-white/15'
                          : inMonth
                          ? 'text-white hover:bg-white/[0.12]'
                          : 'text-white/25 hover:bg-white/[0.08]',
                        !isSel && !disabled && isToday(day) ? 'ring-1 ring-inset ring-brand-400/50' : '',
                      ].join(' ')}
                    >
                      {format(day, 'd')}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Quick affordances. "Today" is one tap instead of navigating home;
              "same day as start" is the single most useful control on an END
              field, where the honest answer is almost always the start date. */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => jumpTo(today)}
              disabled={todayDisabled}
              aria-pressed={todaySelected}
              className={quickChipCls(todaySelected, todayDisabled)}
            >
              {t('time.today', { defaultValue: 'Today' })}
            </button>
            {sameAsDate && (
              <button
                type="button"
                onClick={() => jumpTo(sameAsDate)}
                aria-pressed={sameAsSelected}
                className={quickChipCls(sameAsSelected)}
              >
                {sameAsLabel || t('pickers.same_day_as_start', { defaultValue: 'Same day as start' })}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DatePicker
// ---------------------------------------------------------------------------

/**
 * Every label the date trigger can produce, so the button can reserve its own
 * worst case. `PP` is the locale's own short date — "Jan 20, 2026" in en,
 * "20 janv. 2026" in fr and ht — and the widest of the twelve month names is
 * the widest label there is, because `tabular-nums` fixes the day and the year
 * at a constant width. The weekday moved off the trigger and into the sheet
 * (the calendar shows it, and the day cell's aria-label reads it in full): as
 * `EEE, PP` the label ran to 19 characters in fr/ht, which is what overflowed
 * the composer's Dates row in the first place.
 */
function dateLabelCandidates(locale: Locale, placeholder: string): string[] {
  const out = [placeholder]
  for (let m = 0; m < 12; m += 1) out.push(format(new Date(2026, m, 28), 'PP', { locale }))
  return out
}

export function DatePicker({
  value,
  onChange,
  min,
  invalid = false,
  placeholder = 'Select date',
  title = 'Pick a date',
  className = '',
  sameAs,
  sameAsLabel,
}: {
  value: string // 'yyyy-MM-dd'
  onChange: (value: string) => void
  min?: string // 'yyyy-MM-dd'
  invalid?: boolean
  placeholder?: string
  title?: string
  className?: string
  /** See InlineCalendar — the composer's END field should pass its start date. */
  sameAs?: string // 'yyyy-MM-dd'
  sameAsLabel?: string
}) {
  const locale = useDateLocale()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selected = parseDateValue(value)

  const candidates = useMemo(() => dateLabelCandidates(locale, placeholder), [locale, placeholder])
  const label = selected ? format(selected, 'PP', { locale }) : placeholder

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-invalid={invalid || undefined}
        className={`${triggerBase} ${
          // A colour-only `border-red-400/60` did nothing here: triggerBase
          // carries no border-width, so the invalid state was invisible. An
          // inset ring shows on the fill without adding a box to the layout.
          invalid ? 'ring-1 ring-inset ring-red-400/70' : ''
        } ${selected ? '' : 'text-white/45'} ${className}`}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-white/40" />
        <StableWidth label={label} candidates={candidates} />
      </button>

      <PickerModal open={open} onClose={close} title={title}>
        <InlineCalendar
          value={value}
          min={min}
          sameAs={sameAs}
          sameAsLabel={sameAsLabel}
          autoFocus
          onChange={(d) => {
            onChange(d)
            close()
          }}
        />
      </PickerModal>
    </>
  )
}

// ---------------------------------------------------------------------------
// TimePicker
// ---------------------------------------------------------------------------

function timeLabel(value: string, locale: Locale): string {
  const [h, m] = value.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return value
  return format(new Date(2000, 0, 1, h, m), 'p', { locale })
}

/** Does this locale write 1 PM or 13:00? Ask it, don't assume. */
function usesMeridiem(locale: Locale): boolean {
  return !format(new Date(2000, 0, 1, 13, 0), 'p', { locale }).startsWith('13')
}

/**
 * The widest clock the locale can print. With `tabular-nums` the digits are a
 * constant width, so the worst case is simply the longest of a two-digit hour
 * and either meridiem — four probes cover every one of the 1,440 minutes.
 */
function timeLabelCandidates(locale: Locale, placeholder: string): string[] {
  return [
    placeholder,
    timeLabel('00:00', locale),
    timeLabel('10:45', locale),
    timeLabel('12:45', locale),
    timeLabel('23:45', locale),
  ]
}

const MINUTE_STEPS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

/**
 * WHY THIS SHAPE. The owner: *"for the time, it doesnt make it easy."* It was a
 * flat scroller of 96 rows: reaching 9:30 PM meant dragging past every one of
 * the small hours, and the only way to know where you were was to read.
 *
 * Replaced with a two-axis grid — meridiem, then hour, then minute — because it
 * is the only design here where *every* reachable time is on screen at once. No
 * scrolling, a hard ceiling of three taps to any time in the day, and the axes
 * are self-labelling, so nothing has to be read to be found. The alternatives
 * lose on exactly that: a two-wheel scroller keeps the dragging and hides both
 * ends; a text field that parses "9:30pm" is faster for a keyboard and hopeless
 * on a thumb, and iOS would zoom the page on focus.
 *
 * Contracts kept: the value in and out is 24-hour `'HH:mm'`, and the locale
 * still prints itself via `format(…, 'p')` — the meridiem row simply disappears
 * in fr and ht, where the hour grid runs 00–23 instead.
 *
 * Granularity went from 15 minutes to 5, which costs nothing in a grid, and an
 * exact stored value that is not on the grid (an imported 20:07) gets its own
 * chip so it stays selectable and visible rather than being rounded away.
 */
export function TimePicker({
  value,
  onChange,
  placeholder = 'Select time',
  title = 'Pick a time',
  className = '',
}: {
  value: string // 'HH:mm'
  onChange: (value: string) => void
  placeholder?: string
  title?: string
  className?: string
}) {
  const { t } = useTranslation('common')
  const locale = useDateLocale()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const meridiem = usesMeridiem(locale)

  // The draft is what the grids paint. Every tap commits it upward too, so a
  // backdrop dismissal keeps the choice instead of quietly discarding it.
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  const parts = useMemo(() => {
    const [h, m] = (draft || '').split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return null
    return { h, m }
  }, [draft])

  const commit = (h: number, m: number) => {
    const next = toTimeValue(h, m)
    setDraft(next)
    onChange(next)
  }

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }, [])

  const candidates = useMemo(() => timeLabelCandidates(locale, placeholder), [locale, placeholder])
  const label = value ? timeLabel(value, locale) : placeholder

  // With nothing chosen yet, an hour tap needs a half of the day and a minute
  // tap needs an hour. Events are evening things, so the unset defaults are
  // PM and 19:00 — and the header prints the result big enough to argue with.
  const isPM = parts ? parts.h >= 12 : true
  const hours = meridiem ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : Array.from({ length: 24 }, (_, i) => i)
  const minutes = parts && !MINUTE_STEPS.includes(parts.m) ? [...MINUTE_STEPS, parts.m].sort((a, b) => a - b) : MINUTE_STEPS

  const hourValue = (display: number) => (meridiem ? (isPM ? (display % 12) + 12 : display % 12) : display)
  const hourIsOn = (display: number) => Boolean(parts && parts.h === hourValue(display))

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${triggerBase} ${value ? '' : 'text-white/45'} ${className}`}
      >
        <Clock className="h-4 w-4 shrink-0 text-white/40" />
        <StableWidth label={label} candidates={candidates} />
      </button>

      <PickerModal open={open} onClose={close} title={title} maxWidth="max-w-xs">
        {/* The running answer, large. This is the only thing that has to be
            read, and it is never more than one glance away from any tap. */}
        <div className="mb-3 rounded-xl bg-white/[0.055] px-4 py-3 text-center">
          <span
            className={`text-2xl font-semibold tabular-nums ${draft ? 'text-white' : 'text-white/40'}`}
            aria-live="polite"
          >
            {draft ? timeLabel(draft, locale) : t('pickers.no_time_yet', { defaultValue: 'No time set' })}
          </span>
        </div>

        {meridiem && (
          <div className="mb-3 flex gap-2" role="group" aria-label={t('pickers.half_day', { defaultValue: 'AM or PM' })}>
            {[false, true].map((pm) => {
              const on = parts !== null && parts.h >= 12 === pm
              return (
                <button
                  key={String(pm)}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const base = parts ? parts.h % 12 : 7
                    commit(pm ? base + 12 : base, parts ? parts.m : 0)
                  }}
                  className={[
                    'min-h-11 flex-1 rounded-lg text-sm font-semibold uppercase transition-colors',
                    on ? 'bg-white text-black' : 'bg-white/[0.07] text-white/70 hover:bg-white/[0.12] hover:text-white',
                  ].join(' ')}
                >
                  {format(new Date(2000, 0, 1, pm ? 13 : 1, 0), 'a', { locale })}
                </button>
              )
            })}
          </div>
        )}

        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-white/40">
          {t('pickers.hour', { defaultValue: 'Hour' })}
        </p>
        <div className={`grid gap-1.5 ${meridiem ? 'grid-cols-4' : 'grid-cols-6'}`} role="group">
          {hours.map((display) => {
            const on = hourIsOn(display)
            return (
              <button
                key={display}
                type="button"
                aria-pressed={on}
                onClick={() => commit(hourValue(display), parts ? parts.m : 0)}
                className={[
                  'min-h-11 rounded-lg text-sm font-semibold tabular-nums transition-colors',
                  on ? 'bg-white text-black' : 'bg-white/[0.07] text-white/80 hover:bg-white/[0.12] hover:text-white',
                ].join(' ')}
              >
                {meridiem ? display : pad2(display)}
              </button>
            )
          })}
        </div>

        <p className="mb-1.5 mt-3 text-[11px] font-medium uppercase tracking-wide text-white/40">
          {t('pickers.minutes', { defaultValue: 'Minutes' })}
        </p>
        <div className="grid grid-cols-4 gap-1.5" role="group">
          {minutes.map((m) => {
            const on = Boolean(parts && parts.m === m)
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => commit(parts ? parts.h : 19, m)}
                className={[
                  'min-h-11 rounded-lg text-sm font-semibold tabular-nums transition-colors',
                  on ? 'bg-white text-black' : 'bg-white/[0.07] text-white/80 hover:bg-white/[0.12] hover:text-white',
                ].join(' ')}
              >
                :{pad2(m)}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={close}
          className="mt-4 min-h-11 w-full rounded-lg bg-white text-sm font-semibold text-black transition-colors hover:bg-white/90"
        >
          {t('common.done', { defaultValue: 'Done' })}
        </button>
      </PickerModal>
    </>
  )
}
