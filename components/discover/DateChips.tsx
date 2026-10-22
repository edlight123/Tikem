'use client'

import React, { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import type { DateFilter } from '@/lib/filters/types'
import { InlineCalendar } from '@/components/ui/DateTimePickers'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'

interface DateChipsProps {
  currentDate: DateFilter
  /** When true, render only the chip row (no horizontal-scroll wrapper) for embedding in a shared strip. */
  bare?: boolean
}

/**
 * The house quick-filter chip. Kept byte-for-byte in step with the event
 * composer's `chipCls` (app/organizer/events/EventComposer.tsx) so a filter
 * chip is the same object wherever the reader meets one.
 *
 * These used to be the shared <FilterChip>: `rounded`, a hairline border,
 * `min-h-11`. Round + outlined + 44px tall made four date options read as four
 * fat lozenges, and the selected one was a teal-bordered pill — a coloured
 * status pill, which this codebase does not ship.
 *
 * So the INK is 30px and `rounded`, state is fill-vs-fill (white when
 * on, barely-there when off), and the TOUCH TARGET is a separate concern: an
 * ::after stretched 7px past the top and bottom edges buys the 44px tappable
 * box without a pixel of visible height. `leading-[18px]` is explicit because
 * an arbitrary `text-[13px]` sets only font-size and would otherwise inherit
 * whatever line-height the strip had, letting the chip height drift.
 */
const CHIP_ON = 'bg-white text-black'
const CHIP_OFF = 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
export const discoverChipCls = (on: boolean) =>
  [
    'relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap',
    'rounded px-2.5 py-1.5 text-[13px] leading-[18px] font-medium transition-colors',
    "after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-['']",
    on ? CHIP_ON : CHIP_OFF,
  ].join(' ')

export function DateChips({ currentDate, bare = false }: DateChipsProps) {
  const { t } = useTranslation('common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showDatePicker, setShowDatePicker] = useState(false)

  const todayStr = new Date().toISOString().split('T')[0]

  // Simplified to the four highest-value quick filters (the full set lives in
  // the Filters modal). "Pick a date" opens a calendar modal.
  const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
    { value: 'any', label: t('filters.any_date') },
    { value: 'today', label: t('filters.today') },
    { value: 'this-weekend', label: t('filters.this_weekend') },
    { value: 'pick-date', label: t('filters.pick_date') },
  ]

  const handleDateChange = (date: DateFilter) => {
    const params = new URLSearchParams(searchParams)

    if (date === 'any') {
      params.delete('date')
      params.delete('pickedDate')
      router.push(`?${params.toString()}`)
    } else if (date === 'pick-date') {
      setShowDatePicker(true)
    } else {
      params.set('date', date)
      params.delete('pickedDate')
      router.push(`?${params.toString()}`)
    }
  }

  const applyPickedDate = (picked: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('date', 'pick-date')
    params.set('pickedDate', picked)
    router.push(`?${params.toString()}`)
    setShowDatePicker(false)
  }

  return (
    <>
      <div className={bare ? 'flex items-center' : 'scrollbar-hide overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0'}>
        <div className="flex items-center gap-2 min-w-max">
          {DATE_OPTIONS.map(option => {
            // Format the picked-date chip label safely.
            let label = option.label
            if (option.value === 'pick-date' && currentDate === 'pick-date' && searchParams.get('pickedDate')) {
              const pickedDate = searchParams.get('pickedDate')!
              const [year, month, day] = pickedDate.split('-')
              const date = new Date(Number(year), Number(month) - 1, Number(day))
              label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            }

            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={currentDate === option.value}
                onClick={() => handleDateChange(option.value)}
                className={discoverChipCls(currentDate === option.value)}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Calendar modal — PORTALLED, and it has to be.
          Rendered inline this dialog was broken on production: the discover
          header above it carries `backdrop-blur-xl`, and a backdrop-filtered
          ancestor becomes the containing block for `position: fixed`. So
          `inset-0` resolved against the 402x116 header instead of the
          viewport, and the calendar panel measured at top:-185 — off the top
          of the screen, unreachable. CategoryModal beside this file already
          portals the identical markup; that fix was never carried across.
          A portal removes the whole class of bug rather than compensating for
          one filter. */}
      {showDatePicker && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label={t('filters.pick_date')}
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={() => setShowDatePicker(false)} aria-hidden="true" />
            <div className="relative z-[101] w-full max-w-sm rounded-t-2xl bg-[#141414] p-4 shadow-2xl ring-1 ring-white/10 sm:rounded-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">{t('filters.pick_date')}</h3>
                <button
                  onClick={() => setShowDatePicker(false)}
                  aria-label="Close"
                  className="grid h-11 w-11 place-items-center rounded-lg text-white/50 hover:bg-white/[0.06] hover:text-white sm:h-8 sm:w-8"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <InlineCalendar
                value={searchParams.get('pickedDate') || ''}
                min={todayStr}
                onChange={applyPickedDate}
              />
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
