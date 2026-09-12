import React from 'react'
import Link from 'next/link'

type IconType = React.ComponentType<{ className?: string }>

/**
 * Standard surface card — a FILL and a radius, no hairline.
 *
 * It used to be `border border-white/10` over `bg-white/[0.03]`. On the
 * `#0a0a0a` page a 3% white fill is very nearly the page colour, so the only
 * thing that read was the outline: the wireframe look the owner has rejected
 * five times (see "Surfaces: a fill, not a hairline around nothing" in
 * docs/POSH_DESIGN_BRIEF.md). The same correction already shipped on /profile
 * (`Panel` in components/profile/ui.tsx) and /connections — this matches them
 * exactly rather than inventing a third variant.
 *
 * `shadow-soft` went with the border: it is `rgba(0,0,0,0.08)`, a black shadow
 * on a black page, i.e. nothing.
 */
export function Card({
  className = '',
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return <div className={`rounded-2xl bg-white/[0.03] ${className}`}>{children}</div>
}

/**
 * KPI tile — brand-tinted icon chip + label + value. Value stays bold sans.
 *
 * Same fix as `Card`: a tile sitting on the page is `bg-white/[0.03]` with no
 * border. Stat tiles come in rows of three or four, so the old hairline version
 * was the worst offender — a whole rank of empty outlines.
 */
export function StatTile({
  icon: Icon,
  label,
  value,
  sublabel,
  className = '',
}: {
  icon?: IconType
  label: string
  value: React.ReactNode
  sublabel?: string
  className?: string
}) {
  return (
    <div className={`rounded-2xl bg-white/[0.03] p-4 ${className}`}>
      <div className="mb-2 flex items-center gap-2">
        {Icon && (
          <span className="grid h-8 w-8 place-items-center rounded-lg text-brand-300">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <p className="text-xs font-semibold uppercase tracking-wide text-white/50">{label}</p>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sublabel && <p className="mt-0.5 text-xs text-white/50">{sublabel}</p>}
    </div>
  )
}

/**
 * Filter / category chip — an interactive control, so a fill is correct here
 * (the no-filled-pills rule is about badges that only REPORT state; see
 * StatusChip below).
 *
 * Two ladder corrections. The chosen chip was `bg-brand-700`, but teal is
 * semantic in this app — a focus ring, a selected marker, an on switch, never a
 * surface — and the brief's ladder gives `bg-white text-black` for "a chosen
 * chip or a primary button". The unchosen chip's `0.04` fill and `0.06` hover
 * were both below the ladder's steps. Both now match the category chips and
 * language segments already shipped in components/profile/PreferencesCard.tsx.
 */
export function Chip({
  active = false,
  href,
  onClick,
  children,
  className = '',
}: {
  active?: boolean
  href?: string
  onClick?: () => void
  children: React.ReactNode
  className?: string
}) {
  const base = `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? 'bg-white text-black'
      : 'bg-white/[0.055] text-white/70 hover:bg-white/[0.12] hover:text-white'
  } ${className}`
  if (href) {
    return (
      <Link href={href} className={base}>
        {children}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={base}>
      {children}
    </button>
  )
}

/**
 * Designed empty state — serif title + optional CTA.
 *
 * KEEP the dashed border. The fill-not-hairline rule carves out exactly this
 * case: a dashed edge around genuinely empty space, where the hairline IS the
 * meaning. This is the one border in this file that is not a violation.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}: {
  icon?: IconType
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-10 text-center ${className}`}>
      {Icon && (
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl text-brand-300">
          <Icon className="h-7 w-7" />
        </div>
      )}
      {/* `!text-xl`: `.mobile-typography h3` (0,1,1) outranks `text-xl` (0,1,0),
          so the serif headline was rendering at 16px on every phone. */}
      <h3 className="font-display !text-xl text-white">{title}</h3>
      {description && <p className="mx-auto mt-1.5 max-w-md text-sm text-white/50">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}

/** Status chip tone. One accent (brand teal) + semantic green/red/amber/neutral. */
export type ChipTone = 'brand' | 'neutral' | 'success' | 'warning' | 'danger'

/**
 * Status is read as a DOT plus a label, never a filled or outlined pill.
 *
 * Two reasons this changed. The house rule: a filled status pill reads as a
 * button, so PUBLISHED / ACTIVE / PENDING looked like things to press. And the
 * borders here were quietly broken — `border-green-200`, `border-amber-200`,
 * `border-brand-100` are Tailwind's LIGHT tints, so on a black canvas each chip
 * drew a near-white hairline and every tone looked the same. A coloured dot
 * carries the state; the label stays plain text at normal weight.
 */
const toneDot: Record<ChipTone, string> = {
  brand: 'bg-brand-400',
  neutral: 'bg-white/35',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-red-400',
}

const toneText: Record<ChipTone, string> = {
  brand: 'text-brand-300',
  neutral: 'text-white/60',
  success: 'text-emerald-300',
  warning: 'text-amber-300',
  danger: 'text-red-300',
}

/**
 * Maps a free-form status string to a semantic tone so tables/cards stay
 * consistent. Unknown statuses fall back to neutral. Keep this the single
 * source of truth for status coloring across admin + organizer.
 */
export function statusTone(status: string): ChipTone {
  const s = (status || '').toLowerCase().replace(/[\s-]+/g, '_')
  if (
    [
      'paid', 'completed', 'complete', 'approved', 'published', 'active', 'valid',
      'success', 'succeeded', 'verified', 'confirmed', 'settled', 'live',
    ].includes(s)
  )
    return 'success'
  if (
    [
      'pending', 'pending_review', 'in_review', 'processing', 'in_progress',
      'awaiting', 'requested', 'on_hold', 'hold', 'draft', 'scheduled', 'queued',
    ].includes(s)
  )
    return 'warning'
  if (
    [
      'failed', 'error', 'denied', 'rejected', 'cancelled', 'canceled',
      'refunded', 'expired', 'declined', 'disputed', 'suspended', 'blocked',
    ].includes(s)
  )
    return 'danger'
  return 'neutral'
}

/**
 * Status read-out: a coloured dot and a label. Pass a `tone` directly, or a
 * `status` string to auto-map via statusTone(). The label defaults to a
 * humanized status. Use across all tables.
 *
 * Named "Chip" for its call sites' sake; it is deliberately not a pill.
 */
export function StatusChip({
  status,
  tone,
  icon: Icon,
  children,
  className = '',
  title,
}: {
  status?: string
  tone?: ChipTone
  icon?: IconType
  children?: React.ReactNode
  className?: string
  /** Native tooltip — for a state whose reason is too long for the label. */
  title?: string
}) {
  const resolved: ChipTone = tone ?? statusTone(status ?? '')
  const label =
    children ??
    (status ? status.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '')
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs capitalize ${toneText[resolved]} ${className}`}
    >
      {Icon ? (
        <Icon className="h-3 w-3" />
      ) : (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[resolved]}`} aria-hidden />
      )}
      {label}
    </span>
  )
}
