'use client'

import { Minus, Plus } from 'lucide-react'

/**
 * The quantity stepper, shared with the add-ons (components/AddOnsPicker):
 * two 40px squares on the surface fill, a muted minus and a teal plus, the
 * count between, like the app's selector. Space is kept on unavailable rows
 * so prices stay in one column.
 */
export default function QtyStepper({
  value,
  onMinus,
  onPlus,
  plusDisabled,
  decreaseLabel,
  increaseLabel,
  hidden = false,
}: {
  value: number
  onMinus: () => void
  onPlus: () => void
  plusDisabled: boolean
  decreaseLabel: string
  increaseLabel: string
  hidden?: boolean
}) {
  const btn =
    'flex h-10 w-10 items-center justify-center rounded bg-surface transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40'
  if (hidden) return <div className="w-[7.25rem] shrink-0" aria-hidden />
  return (
    <div className="flex w-[7.25rem] shrink-0 items-center justify-end gap-1.5">
      <button type="button" onClick={onMinus} disabled={value === 0} aria-label={decreaseLabel} className={btn}>
        <Minus className="h-4 w-4 text-fg-muted" />
      </button>
      <span className="w-5 text-center text-body font-bold tabular-nums text-fg" aria-live="polite">
        {value}
      </span>
      <button type="button" onClick={onPlus} disabled={plusDisabled} aria-label={increaseLabel} className={btn}>
        <Plus className="h-4 w-4 text-brand-400" />
      </button>
    </div>
  )
}
