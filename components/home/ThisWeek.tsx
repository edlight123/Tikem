'use client'

// "this week": seven days from today, each with its real event count and the
// poster of its biggest event. Today carries the teal dot. A day with events
// opens discover on that date; an empty day is a quiet dash, not a link and
// not a broken card. The whole section is hidden when the week is empty.

import Link from 'next/link'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '@/components/ui/EditorialRails'
import type { WeekDay } from '@/lib/home/feed'
import { dayLabel, dayParts } from '@/lib/home/format'

export default function ThisWeek({ days, scopeQs }: { days: WeekDay[]; scopeQs: string }) {
  const { t, i18n } = useTranslation('common')
  if (!days.some((d) => d.count > 0)) return null

  return (
    <section>
      <SectionHeader
        title={t('home.week.title', { defaultValue: 'this week' })}
        href={`/discover?date=this-week&${scopeQs}`}
        cta={t('home.see_all', { defaultValue: 'see all' })}
        ctaTone="quiet"
      />
      <ol className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-7 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
        {days.map((d) => {
          const { weekday, day } = dayParts(d.date, i18n.language)
          const countLabel = t('home.week.events', { count: d.count, defaultValue: `${d.count} events` })
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p
                    className={`flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] ${
                      d.isToday ? 'text-[#14B8A6]' : 'text-white/45'
                    }`}
                  >
                    {d.isToday && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#14B8A6]" />}
                    {d.isToday ? t('home.week.today', { defaultValue: 'Today' }) : weekday}
                  </p>
                  <p
                    className={`mt-1 font-grotesk font-bold tabular-nums !text-[30px] !leading-none tracking-[-0.02em] ${
                      d.count ? 'text-white' : 'text-white/25'
                    }`}
                  >
                    {day}
                  </p>
                </div>
              </div>
              <div
                className={`relative mt-4 w-full overflow-hidden rounded-[3px] ${
                  d.top ? 'aspect-[4/5]' : 'flex-1 lg:aspect-[4/5] lg:flex-none'
                }`}
              >
                {d.top ? (
                  <Image
                    src={d.top.banner_image_url}
                    alt={d.top.title}
                    fill
                    sizes="(min-width: 1024px) 170px, 40vw"
                    quality={60}
                    className="object-cover transition-opacity duration-200 group-hover:opacity-85"
                  />
                ) : (
                  // A drawn mark, not a dash character: quiet, and it can't be
                  // read aloud as punctuation.
                  <span aria-hidden className="grid h-full place-items-center">
                    <span className="h-[2px] w-4 rounded-full bg-white/15" />
                  </span>
                )}
              </div>
              <p
                className={`mt-3 font-mono text-[11px] uppercase tracking-[0.08em] ${
                  d.count ? 'text-white/70' : 'hidden text-white/25 lg:block'
                }`}
              >
                {d.count ? countLabel : t('home.week.none', { defaultValue: 'Nothing listed' })}
              </p>
            </>
          )
          // On a phone an empty day folds to a narrow column — the swipe goes
          // to the days that have something; the desktop grid keeps all seven
          // equal so the week reads as a week.
          const cell = `group flex h-full flex-col snap-start rounded-lg p-3 lg:w-auto lg:max-w-none ${
            d.count ? 'w-[42vw] max-w-[180px] sm:w-[30vw]' : 'w-[19vw] max-w-[88px] sm:w-[14vw]'
          }`
          return (
            <li key={d.date} className="shrink-0 lg:shrink">
              {d.count > 0 ? (
                <Link
                  href={`/discover?date=pick-date&pickedDate=${d.date}&${scopeQs}`}
                  aria-label={`${dayLabel(d.date, i18n.language)}: ${countLabel}`}
                  className={`${cell} bg-white/[0.04] outline-none transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/70`}
                >
                  {body}
                </Link>
              ) : (
                <div className={`${cell} bg-white/[0.02]`}>{body}</div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
