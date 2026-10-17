import React from 'react'

type IconType = React.ComponentType<{ className?: string }>

/**
 * Dark-canvas KPI tile. One number (or string value) + label,
 * with an optional icon, sublabel, and trend indicator.
 */
export function MetricCard({
  icon: Icon,
  label,
  value,
  sublabel,
  trend,
  className = '',
}: {
  icon?: IconType
  label: React.ReactNode
  value: React.ReactNode
  sublabel?: React.ReactNode
  /** Positive = green arrow-up, negative = red arrow-down, zero = neutral. */
  trend?: number
  className?: string
}) {
  return (
    <div
      // A KPI tile is a card sitting on the page, so it gets the page-card fill
      // rather than a hairline drawn around nothing.
      className={`rounded-2xl bg-white/[0.03] p-5 ${className}`}
    >
      <div className="mb-3 flex items-center gap-2">
        {Icon && (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/50">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <p className="label-mono text-[11px] uppercase text-white/50">
          {label}
        </p>
      </div>

      <p className="font-mono tabular-nums text-[28px] leading-none text-white">{value}</p>

      {(sublabel !== undefined || trend !== undefined) && (
        <div className="mt-1.5 flex items-center gap-2">
          {trend !== undefined && trend !== 0 && (
            <span
              className={`text-xs font-semibold font-mono tabular-nums ${
                trend > 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
            </span>
          )}
          {sublabel && (
            <p className="text-xs text-white/40">{sublabel}</p>
          )}
        </div>
      )}
    </div>
  )
}
