'use client'

import React from 'react'

interface FilterChipProps {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  count?: number
}

/**
 * Individual filter chip for the dark canvas.
 *
 * Both states are FILLS — the selected one is white, the unselected one is
 * barely there — because a row of outlined pills reads as a wireframe. This
 * matches the composer's chip exactly: 30px of ink, `rounded` (never a
 * full pill), and a separate 44px touch box drawn by an ::after that stretches
 * 7px past the top and bottom edges without adding visible height.
 */
export function FilterChip({
  active = false,
  onClick,
  children,
  count,
}: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] font-medium leading-[18px] transition-colors after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
        active
          ? 'bg-white text-black'
          : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
      }`}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={`ml-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none tabular-nums ${
            active ? 'bg-black/10 text-black/70' : 'bg-white/15 text-white/70'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

/**
 * Scrollable horizontal row of FilterChips.
 * Place below PageHeader or inside TableToolbar.
 */
export function FilterBar({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex items-center gap-2 overflow-x-auto scrollbar-none pb-0.5 ${className}`}
    >
      {children}
    </div>
  )
}
