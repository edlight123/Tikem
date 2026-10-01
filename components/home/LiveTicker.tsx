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
      className="ticker relative overflow-hidden bg-white/[0.045]"
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
              className={`${dup ? 'ticker-dup ' : ''}group flex shrink-0 items-center gap-2.5 px-5 font-mono text-[11px] uppercase tracking-[0.08em] text-white/50 outline-none transition-colors hover:text-white focus-visible:text-white focus-visible:underline`}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  s.kind === 'live' ? 'ticker-live bg-[#14B8A6]' : 'bg-white/35'
                }`}
              />
              <span className="text-white/85 group-hover:text-white">{s.title}</span>
              {s.city && <span className="text-white/35">{s.city}</span>}
              <span>{label(s)}</span>
            </Link>
          )
        })}
      </div>
    </aside>
  )
}
