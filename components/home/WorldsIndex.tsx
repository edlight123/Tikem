'use client'

// "worlds": the eight Kreyòl cultural worlds (lib/categories — a display
// layer over the canonical categories) as a typographic index. Each row is its
// real upcoming count and a door into discover; on a desktop, hovering a row
// raises that world’s top poster beside it. When enough worlds are lit, the
// empty ones stay in the index muted and unlinked (the map is the point);
// in a thin scope only the lit ones show. Nobody is sent to an empty page.

import Link from 'next/link'
import Image from 'next/image'
import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '@/components/ui/EditorialRails'
import type { HomeWorld } from '@/lib/home/feed'

const pad = (n: number) => String(n).padStart(2, '0')
const SHOW_ALL_FROM = 4

export default function WorldsIndex({ worlds, scopeQs }: { worlds: HomeWorld[]; scopeQs: string }) {
  const { t } = useTranslation('common')
  const live = worlds.filter((w) => w.count > 0)
  if (!live.length) return null
  // A thin scope (one city, a quiet month) would print a column of greyed-out
  // words with one live row; then only the live worlds show. With enough of
  // them lit, the whole map reads, empty worlds muted in place.
  const rows = live.length >= SHOW_ALL_FROM ? worlds : live

  return (
    <section>
      <SectionHeader
        title={t('home.worlds.title', { defaultValue: 'worlds' })}
        href={`/discover?${scopeQs}`}
        cta={t('home.see_all', { defaultValue: 'see all' })}
        ctaTone="quiet"
      />
      <ol className="-mx-3">
        {rows.map((w, i) => {
          const sublabel = t(`worlds.${w.key}.sublabel`, { defaultValue: '' })
          const row = (
            <>
              <span className="w-8 shrink-0 self-start pt-[0.55em] font-mono text-[11px] tabular-nums text-white/35 sm:w-12 sm:text-[12px]">
                {pad(i + 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block font-grotesk font-bold lowercase !leading-[0.95] tracking-[-0.035em] transition-transform duration-300 ease-out !text-[clamp(34px,6vw,80px)] ${
                    w.count ? 'text-white lg:group-hover:translate-x-2' : 'text-white/20'
                  }`}
                >
                  {w.label}
                </span>
                {sublabel && (
                  <span className={`mt-1.5 block text-[13px] ${w.count ? 'text-white/40' : 'text-white/20'}`}>
                    {sublabel}
                  </span>
                )}
              </span>
              <span
                className={`flex shrink-0 items-center gap-2 self-start pt-[0.5em] font-mono text-[13px] tabular-nums ${
                  w.count ? 'text-white/75' : 'text-white/20'
                }`}
              >
                {w.count}
                {w.count > 0 && (
                  <ArrowUpRight className="h-4 w-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                )}
              </span>
            </>
          )
          return (
            <li key={w.key} className="relative">
              {w.count > 0 ? (
                <Link
                  href={`/discover?${w.categories.map((c) => `category=${encodeURIComponent(c)}`).join('&')}&${scopeQs}`}
                  aria-label={`${w.label}: ${t('home.week.events', { count: w.count, defaultValue: `${w.count} events` })}`}
                  className="group relative flex items-start gap-3 rounded-xl px-3 py-3 outline-none transition-colors hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-white/70 sm:gap-5 sm:py-4"
                >
                  {row}
                  {w.poster && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute right-[16%] top-1/2 z-10 hidden aspect-[4/5] w-[132px] -translate-y-1/2 rotate-[-4deg] scale-95 overflow-hidden rounded opacity-0 transition duration-300 ease-out group-hover:rotate-[-2deg] group-hover:scale-100 group-hover:opacity-100 group-focus-visible:opacity-100 lg:block"
                    >
                      <Image src={w.poster.banner_image_url} alt="" fill sizes="132px" quality={60} className="object-cover" />
                    </span>
                  )}
                </Link>
              ) : (
                <div className="flex items-start gap-3 px-3 py-3 sm:gap-5 sm:py-4">{row}</div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
