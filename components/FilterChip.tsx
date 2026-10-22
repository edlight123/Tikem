import React from 'react'

interface FilterChipProps {
  label: string
  active?: boolean
  onClick?: () => void
  onRemove?: () => void
  className?: string
}

export function FilterChip({ label, active, onClick, onRemove, className = '' }: FilterChipProps) {
  if (onRemove) {
    // Removable chip (an APPLIED filter). Quiet-button rules: teal never fills —
    // applied state reads as a light neutral fill, not a colored pill.
    return (
      <button
        onClick={onRemove}
        // min-h-11 on phones: these were 34px tall, well under the 44px touch
        // floor, and they are the primary control on Discover. The pill itself
        // is not redrawn — the box grows to a thumb-sized target and the label
        // stays centred.
        className={`inline-flex min-h-11 items-center gap-1.5 rounded bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/15 sm:min-h-0 ${className}`}
      >
        {label}
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    )
  }

  // Selectable chip (a filter option). Teal marks the ACTIVE one — semantic use.
  return (
    <button
      onClick={onClick}
      className={`inline-flex min-h-11 items-center rounded border px-3.5 py-1.5 text-sm transition-colors sm:min-h-0
        ${active
          ? 'border-brand-400/60 font-medium text-brand-300'
          : 'border-white/15 font-normal text-white/70 hover:border-white/30 hover:text-white'
        } ${className}`}
    >
      {label}
    </button>
  )
}
