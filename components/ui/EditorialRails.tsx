'use client'

// The editorial layout primitives every public listing surface shares: the
// serif-lowercase section header, the edge-bleeding poster rail, and the
// category sub-rail. Extracted from HomePageContent (2026-08-29) so discover
// and category pages compose the same voice instead of re-inventing it.

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { DiscoverEventCard } from '@/components/discover/DiscoverEventCard'

export function SectionHeader({
  eyebrow,
  title,
  description,
  href,
  cta,
  ctaTone = 'accent',
}: {
  eyebrow?: string
  title: string
  description?: string
  href?: string
  cta?: string
  /**
   * 'quiet' sets the link in muted white. The homepage uses it: there teal is
   * reserved for state (live, the chosen city, today), so a link can't wear it.
   */
  ctaTone?: 'accent' | 'quiet'
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 sm:mb-6">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/40">
            {eyebrow}
          </p>
        )}
        {/* The editorial voice: lowercase italic serif — same convention as mobile.
            `!` beats the legacy `.mobile-typography h2` descendant rule on body. */}
        <h2 className="mt-1.5 font-display lowercase italic !text-[clamp(24px,3.8vw,34px)] !leading-[1.02] text-white/90">
          {title}
        </h2>
        {description && (
          <p className="mt-1.5 text-sm text-white/55 sm:text-[15px]">{description}</p>
        )}
      </div>
      {href && cta && (
        <Link
          href={href}
          className={`eyebrow group inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded pb-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
            ctaTone === 'quiet' ? 'text-white/55 hover:text-white' : 'text-brand-400 hover:text-brand-300'
          }`}
        >
          {cta}
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  )
}

/** Horizontal, snapping rail of poster cards that bleeds to the screen edges. */
export function EventRail({ events }: { events: any[]; userCity?: string }) {
  return (
    <div className="rail -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {events.map((event) => (
        <div key={event.id} className="w-[228px] sm:w-[248px]">
          <DiscoverEventCard event={event} />
        </div>
      ))}
    </div>
  )
}

/** A single category section: a lighter sub-header above its own poster rail. */
export function CategoryRail({
  label,
  href,
  cta,
  events,
  userCity,
}: {
  label: string
  href: string
  cta: string
  events: any[]
  userCity?: string
}) {
  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-4">
        <h3 className="font-display lowercase italic !text-[clamp(20px,3vw,28px)] !leading-tight text-white/90">
          {label}
        </h3>
        <Link
          href={href}
          className="eyebrow group inline-flex shrink-0 items-center gap-1 whitespace-nowrap pb-1 text-[11px] text-brand-400 transition-colors hover:text-brand-300"
        >
          {cta}
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </div>
      <EventRail events={events} userCity={userCity} />
    </div>
  )
}
