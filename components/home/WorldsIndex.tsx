'use client'

// "worlds": the eight Kreyòl cultural worlds (lib/categories — a display
// layer over the canonical categories) as poster tiles. Each tile is that
// world's top poster with its name set small over the bottom and the real
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

// Desktop columns by how many worlds are lit, so the grid never ends on a
// half-empty row of holes. Static strings so Tailwind keeps them.
const LG_COLS: Record<number, string> = {
  1: 'lg:grid-cols-2',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-3',
  7: 'lg:grid-cols-4',
  8: 'lg:grid-cols-4',
}

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
      <ul className={`grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 ${LG_COLS[live.length] ?? 'lg:grid-cols-4'}`}>
        {live.map((w, i) => {
          const wide = oddOnPhone && i === 0
          return (
            <li key={w.key} className={wide ? 'col-span-2 sm:col-span-1' : ''}>
              <Link
                href={`/discover?${w.categories.map((c) => `category=${encodeURIComponent(c)}`).join('&')}&${scopeQs}`}
                aria-label={`${w.label}: ${t('home.week.events', { count: w.count, defaultValue: `${w.count} events` })}`}
                className={`group relative block overflow-hidden rounded bg-white/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                  wide ? 'aspect-[16/10] sm:aspect-[3/4]' : 'aspect-[3/4]'
                }`}
              >
                {w.poster && (
                  <Image
                    src={w.poster.banner_image_url}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                    quality={65}
                    className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                  />
                )}
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
                <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 sm:p-4">
                  <span className="font-grotesk font-bold lowercase !leading-none tracking-[-0.03em] text-white !text-[clamp(20px,2.2vw,28px)]">
                    {w.label}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-white/60">{w.count}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
