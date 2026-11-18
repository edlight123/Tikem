'use client'

import Link from 'next/link'
import { CULTURAL_CATEGORIES, culturalCategoryHref } from '@/lib/categories'

/**
 * The cultural browser: eight Kreyòl worlds instead of a generic ticketing
 * taxonomy (2026-08-30 spec). Each tile is a deterministic gradient (same
 * family as the poster fallbacks) carrying a grotesk Kreyòl label and a
 * quiet descriptor — de-iconed, per the editorial system. Tiles link into
 * the existing filter engine with multi-category URLs.
 */
export default function CategoryGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
      {CULTURAL_CATEGORIES.map((cat) => {
        return (
          <Link
            key={cat.key}
            href={culturalCategoryHref(cat)}
            className="group focus-ring rounded-2xl"
            aria-label={cat.label}
          >
            <div
              className="poster-vignette relative flex h-24 flex-col justify-end overflow-hidden rounded-2xl p-3.5 text-fg shadow-poster-sm transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-card-hover sm:h-28"
              style={{
                backgroundImage: `linear-gradient(150deg, ${cat.from}, ${cat.to} 78%, #000)`,
              }}
            >
              <span className="relative z-10 font-grotesk text-body font-bold leading-tight tracking-tight drop-shadow sm:text-base">
                {cat.label}
              </span>
              <span className="relative z-10 mt-0.5 truncate text-eyebrow text-fg-soft drop-shadow">
                {cat.sublabel}
              </span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
