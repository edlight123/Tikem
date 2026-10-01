'use client'

// The featured-event hero. One event at a time: its poster at 4:5 on the
// right, the same artwork blurred and darkened behind the whole hero, and the
// facts on the left — label, title, a serif line, a mono data line, the
// all-in price and one white "Get tickets". A counter steps through up to
// five events: the admin's picks first, then the most-sold upcoming ones
// (lib/home/feed pickHeroEvents). Nothing advances on its own.

import { useCallback, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { HomeEvent } from '@/lib/home/feed'
import { isLiveNow, metroOf } from '@/lib/home/feed'
import { eventWhen } from '@/lib/home/format'
import { getEventPriceLabel } from '@/lib/discover/helpers'
import { culturalCategoryFor } from '@/lib/categories'
import { normalizeEventCategory } from '@/lib/filters/config'

const pad = (n: number) => String(n).padStart(2, '0')

export default function FeaturedHero({ events, now, zone }: { events: HomeEvent[]; now: number; zone: string }) {
  const { t, i18n } = useTranslation('common')
  const [index, setIndex] = useState(0)
  const count = events.length
  const go = useCallback(
    (delta: number) => setIndex((i) => (i + delta + count) % count),
    [count]
  )

  if (!count) return null
  const ev = events[Math.min(index, count - 1)]
  const live = isLiveNow(ev, now)
  const city = metroOf(ev.city, ev.country)
  const world = culturalCategoryFor(normalizeEventCategory(ev.category)).label
  const subtitle =
    ev.blurb ||
    (city ? t('home.hero.in_city', { world, city, defaultValue: `${world} in ${city}` }) : world)
  const venue = [ev.venue_name, city].filter(Boolean).join(', ')
  const price = getEventPriceLabel(ev, t)
  const lineup =
    ev.lineup.length > 4
      ? `${ev.lineup.slice(0, 4).join(', ')} +${ev.lineup.length - 4}`
      : ev.lineup.join(', ')
  const label = live
    ? t('home.ticker.live', { defaultValue: 'Live now' })
    : ev.featured
      ? t('home.hero.featured', { defaultValue: 'Featured' })
      : t('home.hero.coming_up', { defaultValue: 'Coming up' })
  const href = `/events/${ev.id}`

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t('home.hero.aria', { defaultValue: 'Featured events' })}
      onKeyDown={(e) => {
        if (count < 2) return
        if (e.key === 'ArrowLeft') go(-1)
        if (e.key === 'ArrowRight') go(1)
      }}
      className="relative isolate overflow-hidden bg-black"
    >
      {/* The room: the poster itself, blurred to colour and pushed down to
          near-black so the type above it always wins. A tiny source image is
          enough — the blur discards the detail anyway. */}
      <div key={`bg-${ev.id}`} aria-hidden className="hero-arrive-bg absolute inset-0 -z-10">
        {ev.banner_image_url && (
          <Image
            src={ev.banner_image_url}
            alt=""
            fill
            sizes="96px"
            quality={40}
            priority={index === 0}
            className="scale-125 object-cover opacity-70 blur-3xl saturate-150"
          />
        )}
        <div className="absolute inset-0 bg-black/55" />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/75 to-black/20" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black to-transparent" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black to-transparent" />
      </div>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 pb-12 pt-6 sm:px-6 sm:pt-10 lg:grid-cols-12 lg:items-center lg:gap-12 lg:px-8 lg:pb-20 lg:pt-14">
        {/* Poster — first on a phone, right on a desktop. */}
        <div key={`poster-${ev.id}`} className="hero-arrive lg:order-2 lg:col-span-5">
          <Link
            href={href}
            tabIndex={-1}
            className="relative block aspect-[4/5] w-[78%] max-w-[340px] overflow-hidden rounded bg-white/[0.06] sm:w-[60%] lg:ml-auto lg:w-full lg:max-w-[460px]"
          >
            {ev.banner_image_url && (
              <Image
                src={ev.banner_image_url}
                alt={ev.title}
                fill
                priority={index === 0}
                sizes="(min-width: 1024px) 460px, (min-width: 640px) 60vw, 78vw"
                className="object-cover"
              />
            )}
          </Link>
        </div>

        {/* The facts. */}
        <div className="min-w-0 lg:order-1 lg:col-span-7">
          <div key={`copy-${ev.id}`} className="hero-arrive" aria-live="polite">
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white/60">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${live ? 'ticker-live bg-[#14B8A6]' : 'bg-white/70'}`}
              />
              {label}
            </p>
            <h1 className="mt-4 break-words font-grotesk font-bold text-white text-balance !text-[clamp(44px,7.4vw,112px)] !leading-[0.93] tracking-[-0.035em]">
              {ev.title}
            </h1>
            {subtitle && (
              <p className="mt-5 line-clamp-2 max-w-xl font-display italic text-white/75 !text-[clamp(20px,2.2vw,28px)] !leading-[1.15]">
                {subtitle}
              </p>
            )}
            <p className="mt-6 font-mono text-[12px] uppercase leading-relaxed tracking-[0.08em] text-white/60">
              {eventWhen(ev.start_datetime, zone, i18n.language)}
              {venue && <> · {venue}</>}
            </p>
            {lineup && (
              <p className="mt-1.5 font-mono text-[12px] uppercase leading-relaxed tracking-[0.08em] text-white/45">
                {t('home.hero.lineup', { defaultValue: 'Lineup' })}: {lineup}
              </p>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                href={href}
                className="inline-flex h-12 items-center rounded-xl bg-white px-6 font-grotesk text-[15px] font-semibold text-black outline-none transition-colors hover:bg-white/85 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              >
                {t('events.get_tickets', { defaultValue: 'Get tickets' })}
              </Link>
              <span className="font-mono text-[13px] uppercase tracking-[0.06em] text-white/80">{price}</span>
            </div>
          </div>

          <div className="mt-10 flex items-center justify-between gap-6 lg:mt-16">
            {count > 1 ? (
              <div className="flex items-center gap-4">
                <p
                  className="font-mono text-[12px] tabular-nums tracking-[0.08em] text-white"
                  aria-label={t('home.hero.slide', { i: index + 1, n: count, defaultValue: `${index + 1} of ${count}` })}
                >
                  {pad(index + 1)} <span className="text-white/35">/ {pad(count)}</span>
                </p>
                <div aria-hidden className="hidden gap-1 sm:flex">
                  {events.map((e, i) => (
                    <span
                      key={e.id}
                      className={`h-[2px] w-6 transition-colors duration-300 ${i === index ? 'bg-white' : 'bg-white/20'}`}
                    />
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => go(-1)}
                    aria-label={t('home.hero.prev', { defaultValue: 'Previous event' })}
                    className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.08] text-white outline-none transition-colors hover:bg-white/[0.16] focus-visible:ring-2 focus-visible:ring-white/70"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => go(1)}
                    aria-label={t('home.hero.next', { defaultValue: 'Next event' })}
                    className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.08] text-white outline-none transition-colors hover:bg-white/[0.16] focus-visible:ring-2 focus-visible:ring-white/70"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <span />
            )}
            <p className="hidden font-display italic text-white/40 !text-[15px] sm:block">
              {t('events.hero_tagline', { defaultValue: 'where Haiti goes out.' }).toLowerCase()}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
