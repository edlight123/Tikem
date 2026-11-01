import React from 'react'

interface EditorialHeaderProps {
  /** Small uppercase, letter-spaced kicker above the title (e.g. "Platform", "Organizer"). */
  eyebrow?: string
  title: string
  subtitle?: string
  /** Optional right-aligned content (status, actions). */
  actions?: React.ReactNode
  className?: string
  /** Visual tone. 'light' (default) for dashboards; 'dark' for public dark surfaces. */
  tone?: 'light' | 'dark'
}

/**
 * Shared editorial page header used across the app so internal pages (admin,
 * organizer) share the same visual language as the public homepage:
 * an eyebrow kicker + a serif display title. Matches the SectionHeading pattern
 * in HomePageContent.
 */
export function EditorialHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className = '',
  tone = 'light',
}: EditorialHeaderProps) {
  const dark = tone === 'dark'
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        {eyebrow && <p className={`eyebrow ${dark ? 'text-brand-400' : 'text-brand-600'}`}>{eyebrow}</p>}
        {/* `!` on the size and leading: body carries `.mobile-typography`, whose
            `h1 { @apply text-xl leading-tight }` is an element+class selector
            (0,1,1) and beats a bare arbitrary utility (0,1,0) — without this the
            editorial title collapses to 20px on every phone. */}
        <h1 className={`mt-1.5 font-display italic !text-[clamp(28px,4vw,40px)] !leading-[1.02] ${dark ? 'text-white' : 'text-white'}`}>
          {title}
        </h1>
        {subtitle && (
          <p className={`mt-1.5 text-sm sm:text-[15px] ${dark ? 'text-white/55' : 'text-white/50'}`}>{subtitle}</p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}

/**
 * Section heading (serif + eyebrow) for use inside dashboard pages, matching the
 * homepage section style: Instrument Serif, lowercased — a hand-rolled bold sans
 * h2 reads as off-brand.
 *
 * Three fixes, made while adopting it on /profile and safe because it had no
 * other call site: the eyebrow was `text-brand-600` (teal-600 on a black page,
 * barely legible) and is now brand-400; the h2's size was a bare arbitrary
 * value, which loses to `.mobile-typography h2` (an element+class selector) and
 * so collapsed to 18px on a phone — the `!` restores it; and the bottom margin
 * is no longer baked in, since a call site that wants a tighter gap could not
 * override `mb-5 sm:mb-6` by class order alone.
 */
export function EditorialSectionHeading({
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
        {eyebrow && <p className="eyebrow text-brand-400">{eyebrow}</p>}
        <h2 className="mt-1.5 font-display italic lowercase !text-[clamp(22px,3.4vw,30px)] !leading-[1.04] text-white">
          {title}
        </h2>
        {description && (
          <p className="mt-1.5 text-sm text-white/50 sm:text-[15px]">{description}</p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}
