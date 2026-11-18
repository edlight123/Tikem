'use client'

// "worlds": the eight Kreyòl cultural worlds (lib/categories — a display
// layer over the canonical categories) as art tiles. Each tile is that
// world's painting with its name set small over the bottom and the real
// upcoming count, and opens discover on the world's categories. Only lit
// worlds show; nobody is sent to an empty page.
//
// Before, this was a typographic index: eight 80px words with sublabels and
// counts, the empty worlds greyed in place. It was the tallest thing on the
// page and all of it type, so the art the page is selling sat further down
// than a list of category names. The poster now carries the world and the
// name captions it.

import Link from 'next/link'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '@/components/ui/EditorialRails'
import type { HomeWorld } from '@/lib/home/feed'

// One tile size whatever the count: a poster-rail proportion (six across on
// a desktop, four on a tablet, two on a phone). Sizing the grid to the number
// of lit worlds made two worlds two half-page posters with a lone digit in
// the corner, which read as oversized and empty rather than chosen.
//
// Each tile wears its world's photograph (public/art/world-photos, the same
// Unsplash photos as the app's WORLD_PHOTOS in mobile/lib/artLibrary), never
// an event poster: posters on the worlds took the film strip's pictures and
// hid it, and a world with none left went blank (owner feedback 2026-10-26).
// The illustrated tiles (public/art/worlds) "read very AI" (owner,
// 2026-11-14); the app moved to real photos then and the site follows.

export default function WorldsIndex({ worlds, scopeQs }: { worlds: HomeWorld[]; scopeQs: string }) {
  const { t } = useTranslation('common')
  const live = worlds.filter((w) => w.count > 0)
  if (!live.length) return null
  // Two columns on a phone: with an odd count the first world goes full
  // width (and wider than tall) so the grid closes square.
  const oddOnPhone = live.length % 2 === 1

  return (
    <section>
      <SectionHeader
        title={t('home.worlds.title', { defaultValue: 'worlds' })}
        href={`/discover?${scopeQs}`}
        cta={t('home.see_all', { defaultValue: 'see all' })}
        ctaTone="quiet"
      />
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6">
        {live.map((w, i) => {
          const wide = oddOnPhone && i === 0
          const countLabel = t('home.week.events', { count: w.count, defaultValue: `${w.count} events` })
          return (
            <li key={w.key} className={wide ? 'col-span-2 sm:col-span-1' : ''}>
              <Link
                href={`/discover?${w.categories.map((c) => `category=${encodeURIComponent(c)}`).join('&')}&${scopeQs}`}
                aria-label={`${w.label}: ${countLabel}`}
                className={`group relative block overflow-hidden rounded bg-surface outline-none transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-fg/70 ${
                  wide ? 'aspect-[16/10] sm:aspect-[4/5]' : 'aspect-[4/5]'
                }`}
              >
                {/* The world's photograph, as in the app. Event posters are
                    left to the film strip. */}
                <Image
                  src={`/art/world-photos/${w.key}.jpg`}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 210px, (min-width: 640px) 25vw, 50vw"
                  quality={65}
                  className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                />
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-scrim-strong via-scrim-light to-transparent" />
                <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-3 sm:p-4">
                  <span className="font-grotesk font-bold lowercase !leading-none tracking-[-0.03em] text-fg !text-[clamp(19px,1.6vw,23px)]">
                    {w.label}
                  </span>
                  <span className="font-mono text-eyebrow uppercase tracking-[0.1em] text-fg-muted">{countLabel}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
