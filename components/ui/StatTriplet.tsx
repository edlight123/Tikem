import React from 'react'

type IconType = React.ComponentType<{ className?: string }>

/** Value accent. Teal (`brand`) is the sole brand accent — use it sparingly. */
type StatTone = 'default' | 'brand' | 'amber' | 'emerald'

export interface StatItem {
  /** Tiny uppercase caption above the numeral. */
  label: string
  /** The metric. Numbers get `tabular-nums`; pre-format currency/large values before passing. */
  value: string | number
  /** Colors the numeral (and tints the icon). Default = white. */
  tone?: StatTone
  /** Optional small lucide-style icon shown next to the label. */
  icon?: IconType
}

interface StatTripletProps {
  items: StatItem[]
  /** Max cells per row on sm+ (defaults to items.length). Mobile is always 2-up. */
  columns?: number
  className?: string
}

/**
 * POSH metric row — the shared "stat strip" used across admin dashboards.
 * A rounded, bordered container of hairline-divided cells; each cell is a tiny
 * muted `label-mono` caption (with optional icon) above a big bold
 * `font-mono tabular-nums` numeral. Matches the ad-hoc rows in
 * RealTimeMetrics / AdminDisbursementDashboard so it can replace them.
 *
 * @example
 * <StatTriplet
 *   columns={4}
 *   items={[
 *     { label: 'Events Ended (7d)', value: 12, icon: Calendar },
 *     { label: 'Pending Payouts', value: 3, tone: 'amber', icon: Clock },
 *     { label: 'Approved Payouts', value: 9, tone: 'emerald', icon: CheckCircle },
 *     { label: 'Pending Amount', value: '48.2K HTG', tone: 'brand', icon: DollarSign },
 *   ]}
 * />
 */
export function StatTriplet({ items, columns, className = '' }: StatTripletProps) {
  const cols = columns ?? items.length

  // Static class lookup — Tailwind can't see interpolated class names, so the
  // responsive grid + divider layout is enumerated. `divide-y` is disabled at
  // the breakpoint where all cells fit on one row (no stray top borders).
  const layout =
    LAYOUTS[cols] ?? LAYOUTS[Math.min(Math.max(cols, 1), 6) as keyof typeof LAYOUTS] ?? LAYOUTS[6]

  return (
    <div
      className={`overflow-hidden rounded-xl border border-line bg-surface-low ${className}`}
    >
      <div className={`grid divide-x divide-y divide-line ${layout}`}>
        {items.map((item, i) => {
          const Icon = item.icon
          return (
            <div key={`${item.label}-${i}`} className="p-4">
              <div className="label-mono mb-1.5 flex items-center gap-1.5 text-eyebrow font-medium uppercase tracking-wide text-fg-subtle sm:text-xs">
                {Icon && <Icon className={`h-3.5 w-3.5 shrink-0 ${ICON_TONE[item.tone ?? 'default']}`} />}
                <span className="truncate">{item.label}</span>
              </div>
              <div
                className={`font-mono text-2xl font-bold leading-none tabular-nums sm:text-3xl ${
                  VALUE_TONE[item.tone ?? 'default']
                }`}
              >
                {item.value}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const VALUE_TONE: Record<StatTone, string> = {
  default: 'text-fg',
  brand: 'text-brand-300',
  amber: 'text-warning-soft',
  emerald: 'text-success-soft',
}

const ICON_TONE: Record<StatTone, string> = {
  default: 'text-fg-faint',
  brand: 'text-brand-300',
  amber: 'text-warning/60',
  emerald: 'text-success/60',
}

const LAYOUTS: Record<number, string> = {
  1: 'grid-cols-1 divide-y-0',
  2: 'grid-cols-2 sm:divide-y-0',
  3: 'grid-cols-2 sm:grid-cols-3 sm:divide-y-0',
  4: 'grid-cols-2 sm:grid-cols-4 sm:divide-y-0',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0',
}
