import React from 'react'
import { T } from '@/components/organizer/ui/TranslatedText'
import { AlertCircle } from 'lucide-react'

type IconType = React.ComponentType<{ className?: string }>

type StrokeIconType = React.ComponentType<{ className?: string; strokeWidth?: number }>

/**
 * Dark-canvas empty state for any zero-data list on the organizer portal.
 *
 * 'card' (default): a filled card, serif title, optional description + CTA.
 *
 * 'quiet': the per-event tool pages (guest list, comps, promo codes, tracking
 * links, promoters, messages, orders, analytics). A thin icon, one short line
 * and the compact button, centred on the bare canvas: no card, no explainer
 * subtitle, no big serif (owner, 2026-11-18: "avoid big cards", "avoid too
 * big texts", "avoid too many explanations"). Same shape as the app's
 * EmptyState variant="panel". `description` is ignored here on purpose.
 */
export function OrgEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
  variant = 'card',
}: {
  icon?: IconType
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
  variant?: 'card' | 'quiet'
}) {
  if (variant === 'quiet') {
    const QuietIcon = Icon as StrokeIconType | undefined
    return (
      <div className={`flex flex-col items-center px-6 pb-6 pt-16 text-center ${className}`}>
        {QuietIcon && <QuietIcon className="h-[22px] w-[22px] text-fg-subtle" strokeWidth={1.5} />}
        <p className="mt-3 text-body font-semibold leading-5 text-fg">{title}</p>
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </div>
    )
  }
  return (
    <div
      // The dashed hairline was doing the "nothing here" work that the fill can
      // do on its own; a dashed box around a near-empty fill is the wireframe
      // look the house rule exists to stop.
      className={`flex flex-col items-center justify-center rounded-2xl bg-surface-low p-10 text-center ${className}`}
    >
      {Icon && (
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl text-fg-subtle">
          <Icon className="h-7 w-7" />
        </div>
      )}
      <h3 className="font-display italic text-xl text-fg">{title}</h3>
      {description && (
        <p className="mx-auto mt-2 max-w-sm text-sm text-fg-subtle">{description}</p>
      )}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  )
}

/**
 * Dark-canvas error state — shows an error icon + message.
 * Use when a data fetch fails or a permission is denied.
 */
export function OrgErrorState({
  title,
  description,
  action,
  className = '',
}: {
  title?: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      // Was a red hairline around nothing. The tint carries the alarm; the ring
      // is the accent on top of a fill, not a substitute for one.
      className={`flex flex-col items-center justify-center rounded-2xl bg-danger-strong/[0.07] p-10 text-center ${className}`}
    >
      <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl text-danger">
        <AlertCircle className="h-7 w-7" />
      </div>
      <h3 className="font-display italic text-xl text-fg">{title ?? <T k="server_bits.something_went_wrong" />}</h3>
      {description && (
        <p className="mx-auto mt-2 max-w-sm text-sm text-fg-subtle">{description}</p>
      )}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  )
}

/**
 * Dark-canvas row skeleton.
 * Each row: icon placeholder + two text lines + right pill.
 */
export function OrgLoadingSkeleton({
  rows = 6,
  className = '',
}: {
  rows?: number
  className?: string
}) {
  return (
    <div className={`animate-pulse space-y-0 divide-y divide-line-soft ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4 sm:px-6">
          <div className="h-10 w-10 shrink-0 rounded-lg bg-surface" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-2/5 rounded bg-surface" />
            <div className="h-3 w-1/4 rounded bg-surface" />
          </div>
          <div className="h-6 w-16 rounded bg-surface" />
        </div>
      ))}
    </div>
  )
}

/**
 * Full-page skeleton for organizer routes — shows the PageHeader outline + rows.
 */
export function OrgPageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-3 w-16 rounded bg-surface" />
        <div className="h-9 w-56 rounded-lg bg-surface" />
        <div className="h-4 w-80 rounded bg-surface" />
      </div>
      {/* Content skeleton */}
      <div className="overflow-hidden rounded-2xl bg-surface-low">
        {/* Toolbar — the divider stays: it separates two stacked regions. */}
        <div className="border-b border-line px-4 py-3">
          <div className="h-9 w-52 rounded-lg bg-surface" />
        </div>
        <OrgLoadingSkeleton rows={rows} />
      </div>
    </div>
  )
}
