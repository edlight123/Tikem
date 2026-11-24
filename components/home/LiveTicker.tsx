'use client'

// The slim bar above the nav: what is true on Tikèm right now — events live
// this minute, rooms filling up, the last tickets. Every signal is computed
// from stored numbers (lib/home/feed buildTickerSignals); with none, the bar
// does not render at all. It scrolls as a pure-CSS marquee once there are
// enough signals to loop, pauses on hover or focus, and sits still under
// prefers-reduced-motion.

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import type { TickerSignal } from '@/lib/home/feed'

const MARQUEE_MIN = 3

export default function LiveTicker({ signals }: { signals: TickerSignal[] }) {
  const { t } = useTranslation('common')
  if (!signals.length) return null

  const label = (s: TickerSignal) => {
    switch (s.kind) {
      case 'live':
        return t('home.ticker.live', { defaultValue: 'Live now' })
      case 'left':
        return t('home.ticker.left', { n: s.n, defaultValue: `${s.n} left` })
      case 'selling_fast':
        return t('home.ticker.selling_fast', { defaultValue: 'Selling fast' })
      case 'going':
        return t('home.ticker.going', { n: s.n, defaultValue: `${s.n} going` })
    }
  }

  const marquee = signals.length >= MARQUEE_MIN
  const track = marquee ? [...signals, ...signals] : signals

  return (
    <aside
      aria-label={t('home.ticker.aria', { defaultValue: 'Happening on Tikèm' })}
      className="ticker relative overflow-hidden bg-surface-low"
    >
      <div
        className={`flex h-9 items-center ${
          marquee
            ? 'ticker-track w-max'
            : 'w-full overflow-x-auto [scrollbar-width:none] sm:justify-center [&::-webkit-scrollbar]:hidden'
        }`}
      >
        {track.map((s, i) => {
          const dup = i >= signals.length
          return (
            <Link
              key={`${s.eventId}-${i}`}
              href={`/events/${s.eventId}`}
              prefetch={false}
              aria-hidden={dup || undefined}
              tabIndex={dup ? -1 : undefined}
              className={`${dup ? 'ticker-dup ' : ''}group flex shrink-0 items-center gap-2.5 px-5 font-sans text-caption font-medium tabular-nums text-fg-subtle outline-none transition-colors hover:text-fg focus-visible:text-fg focus-visible:underline`}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  s.kind === 'live' ? 'ticker-live bg-brand-500' : 'bg-fg/35'
                }`}
              />
              <span className="text-fg-soft group-hover:text-fg">{s.title}</span>
              {s.city && <span className="text-fg-faint">{s.city}</span>}
              <span>{label(s)}</span>
            </Link>
          )
        })}
      </div>
    </aside>
  )
}
