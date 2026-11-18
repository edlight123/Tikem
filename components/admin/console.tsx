'use client'

/**
 * Control Room — the admin console's design primitives.
 *
 * The console deliberately does not share the public site's visual language:
 * no serif display titles, no teal, and no outlined boxes. Containers are
 * elevation steps (ground → panel → raise), headings are mono, and color is
 * reserved almost entirely for one meaning — how long work has been waiting.
 * The one visually loud element per screen is the filled near-white primary
 * button.
 *
 * Every admin page composes these instead of styling itself. If a page needs a
 * new look, extend this file — a bespoke class soup on one route is how the
 * last design fell apart.
 */

import {
  forwardRef,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { formatAge, ageTier } from '@/lib/admin/age'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * The client clock for every age in the console. Rows often arrive
 * server-rendered; an age computed at render time would be stamped by the
 * server clock in the HTML and the client clock a beat later — a hydration
 * mismatch near any minute boundary. Null until mount; ticks each minute so a
 * long-open tab stays honest.
 */
export function useConsoleNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

/** Page container + the mono uppercase title every console screen carries. */
export function ConsolePage({
  title,
  sub,
  action,
  children,
}: {
  title: string
  /** Right-aligned mono figure or context, e.g. "14 waiting · oldest 265d". */
  sub?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="label-mono text-body font-bold uppercase tracking-[0.14em] text-console-text">
          {title}
        </h1>
        <div className="flex items-center gap-4">
          {sub && (
            <span className="label-mono text-xs tabular-nums text-console-mut">{sub}</span>
          )}
          {action}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  )
}

/** One-line explainer under a title. Use sparingly — the screen should explain itself. */
export function ConsoleCaption({ children }: { children: ReactNode }) {
  return <p className="-mt-2 mb-4 text-meta text-console-mut">{children}</p>
}

/**
 * The tab strip for a HUB — a console section that owns several related
 * screens (Money owns review / disbursements / withdrawals / disputes).
 *
 * This exists because the rail lies without it. `RAIL_GROUPS` bundles several
 * queue sources under one entry — Verifications covers `verifications` AND
 * `bankVerifications`, Payouts covers `payoutReview`, `disbursements` AND
 * `withdrawals` — but each entry can only link to ONE href, so the group's
 * other pages had no route into them from the rail at all. The rail promised a
 * group and delivered a single page. A hub gives the group a real front door
 * and puts its siblings one click away, which is the whole fix.
 *
 * `count` is the same figure the rail carries, repeated here so you can see
 * where the work is without going back to the rail to find out.
 *
 * A rule with an underline on the active tab, NOT a filled track: a filled
 * pill row reads as a set of buttons to press, and these are places you are,
 * not actions you take. (It is also the house rule — a track's padding
 * wrapping nothing is a border around empty space.)
 */
export function ConsoleTabs({
  tabs,
}: {
  tabs: { href: string; label: string; count?: number | null }[]
}) {
  const pathname = usePathname()
  return (
    <div className="-mx-4 mb-5 overflow-x-auto border-b border-console-line px-4 sm:mx-0 sm:px-0">
      <nav className="flex min-w-max gap-1" aria-label="Section">
        {tabs.map((tab) => {
          // Exact match, not startsWith: a hub's own index would otherwise
          // light up for every child route beneath it.
          const active = pathname === tab.href
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-meta transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut ${
                active
                  ? 'border-console-text font-semibold text-console-text'
                  : 'border-transparent text-console-mut hover:text-console-text'
              }`}
            >
              {tab.label}
              {typeof tab.count === 'number' && tab.count > 0 && (
                <span className="label-mono text-eyebrow tabular-nums text-console-faint">
                  {tab.count}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

/** Section label inside a page: small mono caps. */
export function ConsoleSection({ children }: { children: ReactNode }) {
  return (
    <div className="label-mono mb-2 mt-7 text-eyebrow uppercase tracking-[0.18em] text-console-faint">
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

/** A panel: elevation, not an outline. */
export function ConsolePanel({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-lg bg-console-panel ${className}`}>{children}</div>
}

/**
 * A queue row: the console's signature surface. The 2px left edge carries the
 * item's age tier, so a backlog reads as a temperature map before a single
 * word is read.
 */
export function ConsoleRow({
  ageAt,
  now,
  onClick,
  children,
  className = '',
}: {
  /** ISO timestamp the row has been waiting since; null shows no edge color. */
  ageAt?: string | null
  /** Client-clock Date (from useConsoleNow) so ages never hydrate-mismatch. */
  now?: Date | null
  onClick?: () => void
  children: ReactNode
  className?: string
}) {
  const tier = now && ageAt ? ageTier(ageAt, now) : 'none'
  const edge =
    tier === 'overdue' ? 'border-console-red' : tier === 'waiting' ? 'border-console-amber' : 'border-console-faint'

  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`flex w-full items-center gap-4 rounded-r-md border-l-2 bg-console-panel px-4 py-3 text-left transition-colors ${edge} ${
        onClick ? 'cursor-pointer hover:bg-console-raise focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut' : ''
      } ${className}`}
    >
      {children}
    </Tag>
  )
}

/** The right-aligned age figure for a ConsoleRow. */
export function ConsoleAge({ ageAt, now }: { ageAt?: string | null; now?: Date | null }) {
  if (!now) return <span className="label-mono text-meta text-console-faint">·</span>
  return (
    <span
      className={`label-mono shrink-0 text-meta tabular-nums ${consoleAgeClass(ageAt, now)}`}
      title={ageAt ? `Waiting since ${new Date(ageAt).toISOString()}` : 'No timestamp recorded'}
    >
      {formatAge(ageAt, now)}
    </span>
  )
}

/** Age color in console tokens (lib/admin/age's ageClass uses the old palette). */
export function consoleAgeClass(iso: string | null | undefined, now: Date): string {
  const tier = ageTier(iso, now)
  if (tier === 'overdue') return 'text-console-red'
  if (tier === 'waiting') return 'text-console-amber'
  return 'text-console-mut'
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'quiet' | 'danger'
}

/**
 * primary — filled near-white, the ONE loud element on a screen.
 * quiet   — raised step, for the actions beside it.
 * danger  — text-only red; destruction never gets a filled surface.
 */
export const ConsoleButton = forwardRef<HTMLButtonElement, ButtonProps>(function ConsoleButton(
  { variant = 'quiet', className = '', ...props },
  ref
) {
  const look =
    variant === 'primary'
      ? 'bg-console-text text-console-ground font-bold hover:opacity-90'
      : variant === 'danger'
        ? 'bg-transparent text-console-red font-semibold hover:bg-console-raise'
        : 'bg-console-raise text-console-mut font-semibold hover:text-console-text'
  return (
    <button
      ref={ref}
      {...props}
      className={`rounded px-4 py-2 text-meta transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-console-mut disabled:cursor-not-allowed disabled:opacity-50 ${look} ${className}`}
    />
  )
})

export const ConsoleInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function ConsoleInput({ className = '', ...props }, ref) {
    return (
      <input
        ref={ref}
        {...props}
        className={`w-full rounded bg-console-ground px-3 py-2 text-meta text-console-text placeholder:text-console-faint focus:outline-none focus:ring-2 focus:ring-console-mut ${className}`}
      />
    )
  }
)

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export type ConsoleTone = 'good' | 'warn' | 'bad' | 'neutral'

const TONE_DOT: Record<ConsoleTone, string> = {
  good: 'bg-console-green',
  warn: 'bg-console-amber',
  bad: 'bg-console-red',
  neutral: 'bg-console-faint',
}
const TONE_TEXT: Record<ConsoleTone, string> = {
  good: 'text-console-green',
  warn: 'text-console-amber',
  bad: 'text-console-red',
  neutral: 'text-console-mut',
}

/** Status is always a dot plus a label — never a pill. */
export function ConsoleState({ tone, children }: { tone: ConsoleTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${TONE_TEXT[tone]}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden="true" />
      {children}
    </span>
  )
}

/** Free-form status string → tone, one mapping for the whole console. */
export function consoleTone(status: string | null | undefined): ConsoleTone {
  const s = String(status || '').toLowerCase()
  if (
    ['approved', 'published', 'completed', 'complete', 'paid', 'verified', 'active', 'resolved', 'confirmed', 'won'].includes(s)
  )
    return 'good'
  if (['pending', 'pending_review', 'in_review', 'processing', 'open', 'draft', 'held'].includes(s)) return 'warn'
  if (['rejected', 'failed', 'banned', 'suspended', 'cancelled', 'unpublished'].includes(s)) return 'bad'
  return 'neutral'
}
