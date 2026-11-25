'use client'

// The national-day notice at the top of the homepage (lib/nationalDays.ts),
// as the house NoticeStrip (owner, TestFlight 2026-11-25: no big cards; this
// used to be a 4:5 poster up to 78% of a phone screen): a small 4:5 thumb of
// the day's art, the day's name in the serif, when it is (a dot and a label),
// one quiet "See" link to the events tagged for it, and a ×.
//
// Low-key days (Jou Mò, Fèt Travay…) show the link only when organizers
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
import { useTranslation } from 'react-i18next'
import { nationalDayDismissId, nationalDayText, type ActiveNationalDay } from '@/lib/nationalDays'
import { nationalDayArt } from '@/lib/nationalDayArt'
import { color } from '@/lib/design/tokens'
import { NoticeStrip } from '@/components/ui/NoticeStrip'

const TEAL = color.brand[500]

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

  const { title } = nationalDayText(day, (i18n.language || 'en').slice(0, 2))
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
      <NoticeStrip
        role="region"
        ariaLabel={title}
        className="!pl-2"
        leading={
          <span className="relative block h-10 w-8 shrink-0 overflow-hidden rounded bg-surface-raised">
            <Image src={art.src} alt={art.alt} fill sizes="32px" className="object-cover" />
          </span>
        }
        serif
        text={title}
        sub={
          <>
            <span
              aria-hidden
              className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
              style={{ backgroundColor: dot }}
            />
            {when}
          </>
        }
        action={
          showCta
            ? {
                label: t('home.nationalDay.see', { defaultValue: 'See' }),
                href,
                ariaLabel: t('home.nationalDay.see_events', { defaultValue: 'See events' }),
              }
            : undefined
        }
        onDismiss={dismiss}
        dismissLabel={t('home.nationalDay.dismiss', { defaultValue: 'Hide this banner' })}
      />
    </section>
  )
}
