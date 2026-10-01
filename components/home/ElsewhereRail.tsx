'use client'

// The one deliberate step outside the visitor's country, and it is
// asymmetric on purpose (named after the mobile app's ElsewhereRail, which
// does the same job inside a country):
//
//  - Outside Haiti: "back home", a quiet rail of upcoming events IN Haiti.
//    The diaspora travels home for Kanaval and the festivals.
//  - In Haiti: no diaspora rail. At most a small text link to the events
//    abroad on discover, unless Haiti has nothing listed, in which case the
//    abroad events show as the rail so the page is never empty.
//
// When the visitor's own country has nothing listed, `emptyCountry` names it
// and a one-line note sits above the rail.

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SectionHeader, EventRail } from '@/components/ui/EditorialRails'
import type { HomeEvent } from '@/lib/home/feed'

export default function ElsewhereRail({
  mode,
  events,
  emptyCountry,
}: {
  /** 'home' = Haiti for a diaspora visitor; 'abroad' = the diaspora for a visitor in Haiti. */
  mode: 'home' | 'abroad'
  events: HomeEvent[]
  /** The visitor's country, when it has nothing listed. */
  emptyCountry?: string
}) {
  const { t } = useTranslation('common')
  const note = emptyCountry
    ? t('home.empty', {
        place: t(`home.country.${emptyCountry}`, { defaultValue: emptyCountry }),
        defaultValue: `${emptyCountry}: nothing listed right now.`,
      })
    : ''

  const noteLine = note ? <p className="mb-10 text-[15px] text-white/60">{note}</p> : null

  // In Haiti with Haiti's own sections showing: only the quiet link.
  if (mode === 'abroad' && !note) {
    if (!events.length) return null
    return (
      <p>
        <Link
          href="/discover?country=abroad"
          className="group inline-flex items-center gap-1.5 rounded text-[14px] text-white/55 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"
        >
          {t('home.elsewhere.abroad_link', { defaultValue: 'Haitian events abroad' })}
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </p>
    )
  }

  if (!events.length) return noteLine

  return (
    <section>
      {noteLine}
      <SectionHeader
        title={
          mode === 'home'
            ? t('home.elsewhere.back_home', { defaultValue: 'back home' })
            : t('home.elsewhere.abroad_title', { defaultValue: 'haitian events abroad' })
        }
        description={
          mode === 'home' ? t('home.elsewhere.back_home_desc', { defaultValue: 'Coming up in Haiti' }) : undefined
        }
        href={mode === 'home' ? '/discover?country=HT' : '/discover?country=abroad'}
        cta={t('home.see_all', { defaultValue: 'see all' })}
        ctaTone="quiet"
      />
      <EventRail events={events} />
    </section>
  )
}
