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
//
// Dismissible, with the app's semantics (mobile/lib/nationalDaysRemote): the
// close is remembered per occurrence AND phase, so closing the "in 3 days"
// banner keeps it closed through the lead days and it comes back once on the
// day itself. Remembered in localStorage only; a browser that blocks storage
// simply sees the banner again next visit.
//
// No flash for someone who closed it: the banner is server-rendered, so a tiny
// inline script inside the section hides it before first paint when the key is
// stored, and the client then drops it from the tree. Nobody who has not
// dismissed it sees anything move.

import { useEffect, useLayoutEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { nationalDayDismissId, nationalDayText, type ActiveNationalDay } from '@/lib/nationalDays'
import { nationalDayArt } from '@/lib/nationalDayArt'

const TEAL = '#14B8A6'

/** Same prefix the app uses for its AsyncStorage key. */
const DISMISS_PREFIX = 'nationalDays.dismissed.'
const SECTION_ID = 'national-day-banner'

// useLayoutEffect on the client (so a client-side navigation to Home never
// paints a dismissed banner), useEffect on the server where it is a no-op.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

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
  const storageKey = DISMISS_PREFIX + nationalDayDismissId(active)
  const [dismissed, setDismissed] = useState(false)

  useIsomorphicLayoutEffect(() => {
    setDismissed(readDismissed(storageKey))
  }, [storageKey])

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

  if (dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(storageKey, '1')
    } catch {
      // Not remembered; it shows again next visit. Harmless.
    }
  }

  // Runs while the HTML is parsed, before first paint. The section is already
  // open, so it can find itself. JSON.stringify keeps the key a JS string.
  const hideIfDismissed = `try{if(localStorage.getItem(${JSON.stringify(storageKey)})==='1'){document.getElementById(${JSON.stringify(SECTION_ID)}).hidden=true}}catch(e){}`

  return (
    // suppressHydrationWarning: the script above may have set `hidden` before
    // React hydrates; the layout effect then removes the section entirely.
    <section
      id={SECTION_ID}
      aria-label={title}
      suppressHydrationWarning
      className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8"
    >
      <script dangerouslySetInnerHTML={{ __html: hideIfDismissed }} />
      <div className="relative">
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

        {/* Quiet close: a bare white/60 glyph in the corner, no box around it
          (fill, not hairline). The soft shadow keeps it legible on bright art. */}
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('home.nationalDay.dismiss', {
            defaultValue: 'Hide this banner',
          })}
          title={t('home.nationalDay.dismiss', {
            defaultValue: 'Hide this banner',
          })}
          className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-full text-white/60 outline-none transition-colors [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.6))] hover:text-white focus-visible:text-white focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <X aria-hidden className="h-5 w-5" strokeWidth={2} />
        </button>
      </div>
    </section>
  )
}
