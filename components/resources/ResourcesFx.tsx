'use client'

// The guides page's motion layer (2026-09-01): small client pieces the
// server page composes around its content.
//
//   Reveal         — children rise in when they scroll into view (staggerable)
//   FloatingGuides — mini guide covers drifting around the SELL OUT. hero,
//                    each on its own clock, like the homepage's poster room
//   Marquee        — the organizer verb chain as a kinetic ribbon
//   OuPare         — the outro question, letters rising when it enters
//
// Everything respects prefers-reduced-motion (the CSS keyframes are already
// disabled globally; the IO reveals fall back to instantly visible).

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Rocket, Ticket, Palette, Wallet, ScanLine, QrCode } from 'lucide-react'

function useSeen(threshold = 0.18) {
  const ref = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])
  return { ref, seen }
}

/** Children rise in on first sight; `delay` staggers siblings (ms). */
export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const { ref, seen } = useSeen()
  return (
    <div
      ref={ref}
      className="transition-all duration-700 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]"
      style={{
        opacity: seen ? 1 : 0,
        transform: seen ? 'none' : 'translateY(26px)',
        transitionDelay: seen ? `${delay}ms` : '0ms',
      }}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The hero's floating room: guide covers instead of event posters     */
/* ------------------------------------------------------------------ */

const COVERS = [
  { icon: Ticket, key: 'create', langs: 'EN · FR' },
  { icon: Palette, key: 'poster', langs: 'EN · FR' },
  { icon: Wallet, key: 'payouts', langs: 'EN · FR' },
  { icon: ScanLine, key: 'door', langs: 'EN · FR' },
  { icon: QrCode, key: 'tickets', langs: 'EN · FR' },
  { icon: Rocket, key: 'start', langs: 'EN · FR · HT' },
] as const

// [top%, left%, rotation, floatDur, floatDelay]
const SLOTS: Array<[number, number, number, string, string]> = [
  [4, 56, -7, '7.2s', '0s'],
  [12, 78, 5, '8.1s', '-2.2s'],
  [40, 66, -4, '6.6s', '-4.1s'],
  [52, 84, 8, '7.8s', '-1.4s'],
  [68, 58, -6, '8.4s', '-3.2s'],
  [30, 90, -3, '7s', '-5s'],
]

export function FloatingGuides() {
  const { t } = useTranslation('common')
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
      {COVERS.map((c, i) => {
        const [top, left, rot, dur, delay] = SLOTS[i]
        return (
          <div
            key={c.key}
            className="plt-enter absolute"
            style={{ top: `${top}%`, left: `${left}%`, ['--d' as any]: `${0.35 + i * 0.12}s` }}
          >
            <div className="plt-float" style={{ ['--dur' as any]: dur, ['--d' as any]: delay }}>
              <div
                className="flex aspect-[4/5] w-36 flex-col justify-between rounded-lg border border-line bg-surface-solid p-3.5 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.85)] xl:w-40"
                style={{ transform: `rotate(${rot}deg)` }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-eyebrow tracking-[0.28em] text-fg-subtle">TIKÈM GUIDE</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-400/70" />
                </div>
                <c.icon className="h-7 w-7 text-brand-400/90" strokeWidth={1.5} />
                <div>
                  <p className="font-mono text-eyebrow tracking-[0.22em] text-fg-subtle">
                    {t(`resources.covers.${c.key}.label`)}
                  </p>
                  <p className="mt-1 font-display lowercase italic text-body leading-tight text-fg">
                    {t(`resources.covers.${c.key}.title`)}
                  </p>
                  <p className="mt-2 border-t border-line pt-1.5 font-mono text-eyebrow tracking-[0.2em] text-fg-faint">
                    {c.langs}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The verb chain                                                      */
/* ------------------------------------------------------------------ */

const VERBS = ['kreye', 'vann', 'skane', 'antre', 'peye', 'repete']

export function Marquee() {
  const run = [...VERBS, ...VERBS, ...VERBS]
  const half = (
    <span className="flex shrink-0 items-baseline">
      {run.map((v, i) => (
        <span key={i} className="flex items-baseline">
          <span className="px-6 font-display lowercase italic text-[clamp(34px,5vw,64px)] leading-none text-fg/16 sm:px-9">
            {v}
          </span>
          <span className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-brand-400/40" />
        </span>
      ))}
    </span>
  )
  return (
    <div aria-hidden className="relative overflow-hidden border-y border-line-soft bg-surface-low py-7">
      <div className="tk-marquee flex w-max">
        {half}
        {half}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The outro question                                                  */
/* ------------------------------------------------------------------ */

export function OuPare() {
  const { ref, seen } = useSeen(0.4)
  const text = 'ou pare?'
  return (
    <div ref={ref}>
      <p className="font-display lowercase italic text-[clamp(36px,6vw,64px)] leading-[1.02] text-fg">
        {seen ? (
          <span className="inline-block overflow-hidden pt-[0.14em] align-bottom" style={{ marginTop: '-0.14em' }}>
            {text.split('').map((ch, j) => (
              <span key={j} className="tk-letter" style={{ animationDelay: `${j * 45}ms` }}>
                {ch === ' ' ? ' ' : ch}
              </span>
            ))}
          </span>
        ) : (
          <span className="opacity-0">{text}</span>
        )}
      </p>
    </div>
  )
}
