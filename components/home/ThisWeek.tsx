'use client'

// "this week": the days in the next seven that have something on, each as
// its biggest event's poster under a small date and count. Today carries the
// teal dot. Empty days are left out: a row of "nothing listed" boxes read as
// an empty venue, and with a thin calendar it was most of the strip. The
// whole section is hidden when the week has fewer than two events.

import Link from 'next/link'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '@/components/ui/EditorialRails'
import type { WeekDay } from '@/lib/home/feed'
import { dayLabel, dayParts } from '@/lib/home/format'

export default function ThisWeek({ days, scopeQs }: { days: WeekDay[]; scopeQs: string }) {
  const { t, i18n } = useTranslation('common')
  const lit = days.filter((d) => d.count > 0)
  // One event in the week is the hero's poster again, alone in a wide row;
  // below two the section stays out of the way.
  if (lit.reduce((n, d) => n + d.count, 0) < 2) return null

  return (
    <section>
      <SectionHeader
        title={t('home.week.title', { defaultValue: 'this week' })}
        href={`/discover?date=this-week&${scopeQs}`}
        cta={t('home.see_all', { defaultValue: 'see all' })}
        ctaTone="quiet"
      />
      <ol className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
        {lit.map((d) => {
          const { weekday, day } = dayParts(d.date, i18n.language)
          const countLabel = t('home.week.events', { count: d.count, defaultValue: `${d.count} events` })
          return (
            <li key={d.date} className="w-[46vw] max-w-[220px] shrink-0 snap-start sm:w-[30vw] lg:w-[220px]">
              <Link
                href={`/discover?date=pick-date&pickedDate=${d.date}&${scopeQs}`}
                aria-label={`${dayLabel(d.date, i18n.language)}: ${countLabel}`}
                className="group block rounded outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <p
                  className={`flex items-baseline gap-2 font-mono text-[11px] uppercase tracking-[0.1em] ${
                    d.isToday ? 'text-[#14B8A6]' : 'text-white/45'
                  }`}
                >
                  {d.isToday && <span aria-hidden className="h-1.5 w-1.5 self-center rounded-full bg-[#14B8A6]" />}
                  {d.isToday ? t('home.week.today', { defaultValue: 'Today' }) : weekday}
                  <span className="font-grotesk text-[15px] font-bold normal-case tracking-[-0.01em] text-white tabular-nums">
                    {day}
                  </span>
                </p>
                <div className="relative mt-2.5 aspect-[4/5] w-full overflow-hidden rounded bg-white/[0.06]">
                  {d.top && (
                    <Image
                      src={d.top.banner_image_url}
                      alt={d.top.title}
                      fill
                      sizes="(min-width: 1024px) 220px, 46vw"
                      quality={60}
                      className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                    />
                  )}
                </div>
                <p className="mt-2.5 truncate text-[13px] text-white/80">{d.top?.title}</p>
                {d.count > 1 && (
                  <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-white/40">{countLabel}</p>
                )}
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
