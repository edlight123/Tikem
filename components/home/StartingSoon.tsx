'use client'

// "starting soon": up to three events that start within 48 hours, each with a
// live countdown to its start time. The countdown is the one ticking clock on
// the page; it renders the server's instant first (so hydration matches) and
// then follows the reader's clock. Hidden entirely when nothing is that close.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '@/components/ui/EditorialRails'
import type { HomeEvent } from '@/lib/home/feed'
import { metroOf } from '@/lib/home/feed'
import { eventWhen } from '@/lib/home/format'

const pad = (n: number) => String(n).padStart(2, '0')

function useNow(initial: number) {
  const [now, setNow] = useState(initial)
  useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function Countdown({ start, now }: { start: string; now: number }) {
  const { t } = useTranslation('common')
  const ms = new Date(start).getTime() - now
  if (ms <= 0) {
    return (
      <span className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.08em] text-white">
        <span aria-hidden className="ticker-live h-1.5 w-1.5 rounded-full bg-[#14B8A6]" />
        {t('home.soon.starting', { defaultValue: 'Starting now' })}
      </span>
    )
  }
  const s = Math.floor(ms / 1000)
  const clock = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
  return (
    <span className="block">
      <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
        {t('home.soon.starts_in', { defaultValue: 'Starts in' })}
      </span>
      {/* The digits change every second: keep them out of the live region
          noise — screen readers get the start time from the data line. */}
      <span aria-hidden className="mt-1 block font-mono text-[18px] tabular-nums tracking-[0.02em] text-white sm:text-[22px]">
        {clock}
      </span>
    </span>
  )
}

export default function StartingSoon({ events, now: serverNow, zone }: { events: HomeEvent[]; now: number; zone: string }) {
  const { t, i18n } = useTranslation('common')
  const now = useNow(serverNow)
  if (!events.length) return null

  return (
    <section>
      <SectionHeader title={t('home.soon.title', { defaultValue: 'starting soon' })} />
      <ul className="space-y-2">
        {events.map((ev) => {
          const city = metroOf(ev.city, ev.country)
          const venue = [ev.venue_name, city].filter(Boolean).join(', ')
          return (
            <li key={ev.id}>
              <Link
                href={`/events/${ev.id}`}
                className="group flex items-center gap-4 rounded-xl bg-white/[0.04] p-3 outline-none transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/70 sm:gap-6 sm:p-4"
              >
                <span className="relative aspect-[4/5] w-16 shrink-0 overflow-hidden rounded-[3px] bg-white/[0.06] sm:w-20">
                  {ev.banner_image_url && (
                    <Image src={ev.banner_image_url} alt={ev.title} fill sizes="80px" quality={60} className="object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-grotesk font-bold text-white !text-[clamp(18px,2vw,24px)] !leading-tight tracking-[-0.02em]">
                    {ev.title}
                  </span>
                  <span className="mt-1.5 block truncate font-mono text-[11px] uppercase tracking-[0.08em] text-white/50">
                    {eventWhen(ev.start_datetime, zone, i18n.language)}
                    {venue && <> · {venue}</>}
                  </span>
                  <span className="mt-3 block sm:hidden">
                    <Countdown start={ev.start_datetime} now={now} />
                  </span>
                </span>
                <span className="hidden shrink-0 text-right sm:block">
                  <Countdown start={ev.start_datetime} now={now} />
                </span>
                <span className="hidden shrink-0 items-center gap-1.5 pl-2 text-[13px] font-medium text-white/55 transition-colors group-hover:text-white md:flex">
                  {t('home.soon.tickets', { defaultValue: 'Tickets' })}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
