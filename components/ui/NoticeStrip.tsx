'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { X, type LucideIcon } from 'lucide-react'

type NoticeAction =
  | { label: string; href: string; onClick?: () => void; ariaLabel?: string }
  | { label: string; onClick: () => void; href?: undefined; ariaLabel?: string }

export interface NoticeStripProps {
  /** A small line icon. No tile behind it. */
  icon?: LucideIcon
  /** Or any small leading node (a 32px poster thumb). Wins over `icon`. */
  leading?: ReactNode
  /** One short sentence. Wraps to two lines at most (never cut mid-word on a phone). */
  text: ReactNode
  /** A few muted words after the sentence, on the same line ("Today"). */
  sub?: ReactNode
  /** Set `text` in the display serif (a poster-ish title, e.g. a national day). */
  serif?: boolean
  /** One quiet text link on the right. */
  action?: NoticeAction
  /** Shows a small × when given. */
  onDismiss?: () => void
  dismissLabel?: string
  className?: string
  /** Landmark role. `status` for one-time notices (default). */
  role?: 'status' | 'region'
  ariaLabel?: string
}

const actionCls =
  'shrink-0 inline-flex h-10 items-center rounded px-2.5 text-meta font-semibold text-fg transition-colors hover:text-fg-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-fg/70'

/**
 * The house notice (owner, TestFlight 2026-11-25: "no big ass card like
 * this"). Every one-time notice, nudge or prompt on the site is this strip
 * and nothing bigger: a fill (never a hairline box), 4px corners, 48px tall
 * at every width (the sentence wraps to a second line only when the column is
 * too narrow), a thin line icon with no tile, one short sentence, at most one
 * quiet text action and a small ×. No eyebrow, no headline + paragraph stack,
 * no white button, no fixed widths: it fills its container at any size.
 * Mirrors the app's mobile/components/ui/NoticeStrip.
 */
export function NoticeStrip({
  icon: Icon,
  leading,
  text,
  sub,
  serif,
  action,
  onDismiss,
  dismissLabel,
  className = '',
  role = 'status',
  ariaLabel,
}: NoticeStripProps) {
  return (
    <div
      role={role}
      aria-label={ariaLabel}
      className={`flex w-full min-w-0 min-h-12 items-center gap-2.5 rounded bg-surface py-1 pl-3.5 pr-1 ${className}`}
    >
      {leading ?? (Icon ? <Icon className="h-4 w-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden /> : null)}
      <div className="min-w-0 flex-1">
        <div
          className={`line-clamp-2 text-fg ${serif ? 'font-display italic text-lead leading-tight' : 'text-sm leading-snug'}`}
        >
          {text}
          {sub ? (
            <span className="whitespace-nowrap font-sans text-meta not-italic text-fg-muted">
              <span aria-hidden className="mx-1.5 text-fg-subtle">·</span>
              {sub}
            </span>
          ) : null}
        </div>
      </div>
      {action ? (
        action.href ? (
          <Link href={action.href} onClick={action.onClick} aria-label={action.ariaLabel} className={actionCls}>
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} aria-label={action.ariaLabel} className={actionCls}>
            {action.label}
          </button>
        )
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          title={dismissLabel}
          className="flex h-10 w-8 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-fg/70"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

export default NoticeStrip
