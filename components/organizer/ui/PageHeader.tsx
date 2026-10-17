import React from 'react'

/**
 * Dark-canvas page header for every organizer route.
 * Eyebrow + serif title + optional subtitle + right-aligned primary action.
 * Drop-in replacement for the ad-hoc `<div className="…"><h1>…</h1></div>`
 * pattern that appears across organizer pages.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className = '',
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="eyebrow text-white/45">{eyebrow}</p>
        )}
        <h1 className="mt-1.5 font-display text-[clamp(26px,4vw,38px)] leading-[1.02] text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-sm text-white/55 sm:text-[15px]">{subtitle}</p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}

/**
 * Dark-canvas section header inside a page — smaller hierarchy than PageHeader.
 * Use for "Your Events", "Recent Orders" etc.
 */
export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  className = '',
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-end justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow text-white/45">{eyebrow}</p>}
        <h2 className="mt-1 font-display lowercase italic !text-[22px] !leading-snug text-white">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-white/50">{description}</p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}
