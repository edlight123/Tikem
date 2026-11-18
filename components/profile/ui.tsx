'use client'

import React from 'react'
import { EditorialSectionHeading } from '@/components/ui/EditorialHeader'

/**
 * The shared vocabulary of /profile.
 *
 * What this replaces: six cards that were each `bg-surface-low rounded-2xl
 * border border-line p-6` — a 3%-white fill on a #0a0a0a page, so faint it
 * read as empty, with a hairline drawn around it. Stacked six deep the page was
 * a wireframe of itself. Inside them, every input was `border border-line`
 * with NO fill at all, every "card" heading was a bold sans `h2`, and five
 * copies of the same switch painted their knob `bg-surface-low` — an invisible
 * knob on a teal track.
 *
 * House rules encoded here so the six cards can't drift again:
 *  - A surface gets a FILL, never a hairline around nothing. Hairlines survive
 *    in exactly one place: `divide-y` BETWEEN rows of one panel, where the line
 *    IS the meaning.
 *  - Section headings are the shared serif `EditorialSectionHeading`, lowercased
 *    — never a hand-rolled bold sans h2.
 *  - Form controls sit at 16px so iOS doesn't zoom the page on focus.
 *  - Teal is semantic: a focus ring, a selected marker, an on switch. Never a
 *    surface.
 */

/** Field fill + 16px text (the iOS focus-zoom floor) + teal focus ring. */
export const FIELD =
  'w-full rounded-xl bg-surface px-3.5 py-3 text-base text-fg placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 disabled:opacity-50'

/** Quiet secondary button — a fill, so it reads as pressable without a border. */
export const GHOST_BTN =
  'inline-flex items-center gap-1.5 rounded-lg bg-surface px-3 py-1.5 text-meta font-semibold text-fg-soft transition-colors hover:bg-surface-high hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50'

/** The one white thing in a section: confirm an edit. */
export const WHITE_BTN =
  'inline-flex items-center gap-1.5 rounded-lg bg-inverse px-3 py-1.5 text-meta font-bold text-on-inverse transition-colors hover:bg-inverse-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50'

/** A titled section: serif lowercase heading, then its content. */
export function ProfileSection({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <EditorialSectionHeading
        title={title}
        description={description}
        actions={actions}
        className="mb-4 sm:mb-5"
      />
      {children}
    </section>
  )
}

/** A surface. A fill and a radius — that is the whole idea. */
export function Panel({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`overflow-hidden rounded-2xl bg-surface-low ${className}`}>{children}</div>
  )
}

/** Rows of one panel. The hairline between them is the legitimate border. */
export function PanelRows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-line-soft">{children}</div>
}

/** Small uppercase field/read-out label. */
export function FieldLabel({
  children,
  icon: Icon,
  className = '',
  htmlFor,
}: {
  children: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  className?: string
  htmlFor?: string
}) {
  return (
    <label htmlFor={htmlFor} className={`eyebrow flex items-center gap-1.5 text-fg-subtle ${className}`}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {children}
    </label>
  )
}

/**
 * A read-out row inside a panel: label above, value below. Values stay real
 * text — a read-only marker is muted type, not a filled chip (house rule:
 * fills are for surfaces and real toggles, never for badges that only report).
 */
export function ReadoutRow({
  label,
  icon,
  children,
  note,
}: {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  note?: string
}) {
  return (
    <div className="px-4 py-3.5 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel icon={icon}>{label}</FieldLabel>
        {note && <span className="eyebrow shrink-0 text-fg-faint">{note}</span>}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  )
}

/**
 * The switch. Track fills teal when on, grey when off; the knob is WHITE at
 * both ends — it was `bg-surface-low` in all five copies, i.e. invisible.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-50 ${
        checked ? 'bg-brand-500' : 'bg-surface-high'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-inverse shadow-sm transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

/** A settings row that is a title, a line of explanation and a switch. */
export function SwitchRow({
  title,
  description,
  icon: Icon,
  checked,
  onChange,
  disabled,
}: {
  title: string
  description: string
  icon?: React.ComponentType<{ className?: string }>
  checked: boolean
  onChange: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden />}
          {/* h3 + `!`: body carries .mobile-typography, which forces h3 to
              text-base/leading-tight under 640px and beats a bare arbitrary size. */}
          <h3 className="!text-body !leading-snug font-semibold text-fg">{title}</h3>
        </div>
        <p className="mt-1 !text-meta !leading-relaxed text-fg-subtle">{description}</p>
      </div>
      <div className="pt-0.5">
        <Switch checked={checked} onChange={onChange} disabled={disabled} label={title} />
      </div>
    </div>
  )
}
