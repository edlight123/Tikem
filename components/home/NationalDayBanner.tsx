'use client'

// The national-day banner at the top of the homepage (lib/nationalDays.ts):
// the day's screenprint, a small caption naming the place in the piece, the
// day's title and one line, and one white button to the events tagged for it.
//
// A phone gets a 4:5 poster with the words on a bottom scrim, like the app's
// empty states. From lg the art keeps its 4:5 crop on the right and the words
// sit on a fill to its left, because a portrait piece stretched into a wide
// band loses everything but a slice of sky.
//
// Low-key days (Jou Mò, Fèt Travay…) show the button only when organizers
// tagged events for them.

import Image from 'next/image'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { nationalDayText, type ActiveNationalDay } from '@/lib/nationalDays'
import { nationalDayArt } from '@/lib/nationalDayArt'

const TEAL = '#14B8A6'

export default function NationalDayBanner({
  active,
  href,
  eventCount,
}: {
  active: ActiveNationalDay
  href: string
  eventCount: number
}) {
  const { t, i18n } = useTranslation('common')
  const { day, phase, daysUntil } = active
  const { title, message } = nationalDayText(day, (i18n.language || 'en').slice(0, 2))
  const art = nationalDayArt(day)
  const showCta = !day.lowKey || eventCount > 0

  const when =
    phase === 'today'
      ? t('home.nationalDay.today', { defaultValue: 'Today' })
      : daysUntil === 1
        ? t('home.nationalDay.tomorrow', { defaultValue: 'Tomorrow' })
        : t('home.nationalDay.in_days', { count: daysUntil, defaultValue: 'In {{count}} days' })

  // Status = a dot and a label, never a filled pill. Teal marks "now"; Flag
  // Day swaps it for the flag's blue, the one place the theme recolours.
  const dot = day.accent || (phase === 'today' ? TEAL : 'rgba(255,255,255,0.55)')

  const words = (
    <>
      <p className="flex min-w-0 items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white/70">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
        <span className="shrink-0 whitespace-nowrap">{when}</span>
        {art.place && (
          <>
            <span aria-hidden className="shrink-0 text-white/30">·</span>
            <span className="min-w-0 truncate text-white/55">{art.place}</span>
          </>
        )}
      </p>
      <h2 className="mt-3 font-grotesk font-bold text-white text-balance !text-[clamp(32px,5vw,64px)] !leading-[0.95] tracking-[-0.03em]">
        {title}
      </h2>
      <p className="mt-3 max-w-xl text-[16px] leading-snug text-white/80 sm:text-[17px]">{message}</p>
      {showCta && (
        <Link
          href={href}
          className="mt-6 inline-flex h-12 items-center self-start rounded-xl bg-white px-6 font-grotesk text-[15px] font-semibold text-black outline-none transition-colors hover:bg-white/85 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          {t('home.nationalDay.see_events', { defaultValue: 'See events' })}
        </Link>
      )}
    </>
  )

  return (
    <section aria-label={title} className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8">
      {/* Phone and tablet: the poster, words on the scrim. */}
      <div className="relative overflow-hidden rounded-2xl bg-white/[0.045] lg:hidden">
        <div className="relative aspect-[4/5] max-h-[78vh] w-full sm:aspect-[16/11]">
          <Image
            src={art.src}
            alt={art.alt}
            fill
            priority
            sizes="(min-width: 1024px) 1px, 100vw"
            className="object-cover object-[50%_35%]"
          />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                art.scrim === 'strong'
                  ? 'linear-gradient(to bottom, rgba(10,10,10,0) 20%, rgba(10,10,10,0.6) 50%, rgba(10,10,10,0.97) 100%)'
                  : 'linear-gradient(to bottom, rgba(10,10,10,0) 30%, rgba(10,10,10,0.45) 55%, rgba(10,10,10,0.95) 100%)',
            }}
          />
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8">{words}</div>
        </div>
      </div>

      {/* Desktop: words on a fill, the art at its own 4:5 on the right. */}
      <div className="hidden overflow-hidden rounded-2xl bg-white/[0.045] lg:grid lg:grid-cols-12">
        <div className="flex flex-col justify-end p-12 lg:col-span-7 xl:p-14">{words}</div>
        <div className="relative aspect-[4/5] max-h-[520px] w-full lg:col-span-5">
          <Image src={art.src} alt={art.alt} fill sizes="(min-width: 1024px) 40vw, 1px" className="object-cover" />
        </div>
      </div>
    </section>
  )
}
