'use client'

// The organizer landing's three phones, animated: each one plays a living
// loop of the product instead of a still. Keyframes live in globals.css
// under the `plt-` namespace; reduced motion flattens every loop there.
//
//   01  the event page assembles itself, then sells a ticket (11s CSS clock)
//   02  the discover feed browses itself and saves an event (18s CSS clock)
//   03  the dashboard runs live — ticking revenue, orders sliding in (JS)

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Bookmark } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * A real event, reduced to what a 128px flyer needs.
 *
 * These phones used to be filled entirely with `MockPoster` gradients — the
 * owner's report was that the mockups "show without any posters, they just
 * show the cards", and that is literally what was on screen: thirteen flat
 * colour rectangles. Real artwork is the whole point of this product, so the
 * landing page that sells it should be showing some.
 *
 * `city` rather than an attendance number: the cards used to print "214
 * going", which was fine beside an invented title and is not fine beside a
 * real one — it would be a made-up figure attached to somebody's actual event.
 * The city is true and does the same layout job.
 */
export interface VignettePoster {
  id: string
  title: string
  city?: string
  /** Already formatted for display, e.g. "1,500 HTG". Real, or absent. */
  price?: string
  banner_image_url: string
}

/* ------------------------------------------------------------------ */
/* Stage, frame, artwork                                               */
/* ------------------------------------------------------------------ */

/** The posh move: the artwork's light fills the room behind each phone, so
    the stage never reads as a small object floating in a black gap. */
function VignetteStage({ glow, children }: { glow: string; children: React.ReactNode }) {
  return (
    <div className="relative isolate">
      {/* max-w-full caps the bloom at the stage width. As a fixed 480px circle
          centred on a ~390px phone stage it reached 45px past each edge, and
          with nothing clipping it the DOCUMENT grew to 427px, the whole
          /platform page scrolled sideways. Capping rather than clipping the
          parent, because the phone frame inside casts a shadow that is meant
          to bleed; only the horizontal axis matters, so the height is left
          alone. */}
      <div
        aria-hidden
        className="plt-breathe absolute left-1/2 top-1/2 -z-10 h-[480px] w-[480px] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full blur-[110px]"
        style={{ background: glow }}
      />
      {children}
    </div>
  )
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none mx-auto w-[270px] select-none rounded-[42px] border border-white/10 bg-[#161616] p-2.5 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)] sm:w-[290px]"
    >
      {/* True phone proportions (9:19.5); taller content crops like a real
          screenshot instead of stretching the frame. */}
      <div className="relative aspect-[9/19.5] overflow-hidden rounded-[32px] bg-white/[0.03]">
        {/* dynamic island */}
        <div className="absolute left-1/2 top-2.5 z-10 h-[18px] w-[76px] -translate-x-1/2 rounded-full bg-[#161616]" />
        {children}
      </div>
    </div>
  )
}

/**
 * Poster artwork in the house 4:5 frame.
 *
 * `src` draws a real flyer; without one it falls back to the gradient it always
 * was. The fallback is not dead code — /platform renders on a cold cache and
 * in demo mode, and a phone full of empty frames would be worse than a phone
 * full of colour. The gradient also still supplies the `glow`, which is what
 * lights the room behind each stage.
 */
function MockPoster({
  from,
  to,
  glow,
  label,
  src,
  className = '',
}: {
  from: string
  to: string
  glow: string
  label?: string
  src?: string
  className?: string
}) {
  return (
    <div
      className={`relative flex aspect-[4/5] items-end overflow-hidden rounded p-2.5 ${className}`}
      style={{
        backgroundImage: `linear-gradient(150deg, ${from}, ${to} 70%, #000)`,
        boxShadow: `0 0 28px -4px ${glow}`,
      }}
    >
      {src && (
        <Image
          src={src}
          alt=""
          fill
          sizes="160px"
          quality={60}
          className="object-cover"
        />
      )}
      {/* Only over the gradient. On real art the flyer carries its own title,
          and a second one stamped on top of it reads as a rendering fault. */}
      {label && !src && (
        <span className="font-grotesk text-[11px] font-bold uppercase leading-[1.05] tracking-tight text-white/90">
          {label}
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 01 — CREATE: the page assembles, then the toast reports a sale.     */
/* ------------------------------------------------------------------ */

export function EventPageVignette({ posters = [] }: { posters?: VignettePoster[] }) {
  const { t } = useTranslation('common')
  const hero = posters[0]
  const behind = [posters[1], posters[2]]
  return (
    <VignetteStage glow="rgba(124,58,237,0.14)">
      <div className="relative isolate mx-auto w-fit">
        {/* two more flyers peek from behind the phone: a wall, not a lone screen */}
        <div className="plt-float absolute -left-16 top-14 -z-10 hidden w-[128px] -rotate-6 opacity-75 sm:block lg:-left-24" style={{ ['--dur' as any]: '8s' }}>
          <MockPoster from="#f59e0b" to="#7c2d12" glow="rgba(245,158,11,0.28)" src={behind[0]?.banner_image_url} />
        </div>
        <div className="plt-float absolute -right-14 bottom-16 -z-10 hidden w-[118px] rotate-6 opacity-75 sm:block lg:-right-20" style={{ ['--dur' as any]: '9s', ['--d' as any]: '1.2s' }}>
          <MockPoster from="#e11d48" to="#4c0519" glow="rgba(225,29,72,0.28)" src={behind[1]?.banner_image_url} />
        </div>
        <PhoneFrame>
          {/* the sale, reported the moment the loop's CTA takes its press */}
          <div className="plt-ev-toast absolute inset-x-3 top-9 z-20 flex items-center gap-2 rounded-xl bg-[#1f1f1f]/95 px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            {/* No buyer name. It read "Ticket sold: Nadège J." — harmless
                over an invented event, a fabricated sale by a named person
                once the poster beside it belongs to somebody real. The
                notification itself is product chrome and stays. */}
            <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-white">
              {t('platform.vignettes.ticketSoldPlain', { defaultValue: 'Ticket sold' })}
            </span>
          </div>

          <div className="flex h-full flex-col px-4 pb-4 pt-10">
            <div className="plt-ev-poster">
              <MockPoster
                from="#7c3aed"
                to="#312e81"
                glow="rgba(124,58,237,0.35)"
                label="Vèsen live, summer fest"
                src={hero?.banner_image_url}
              />
            </div>
            <p className="plt-ev-title mt-3 truncate font-grotesk text-[15px] font-bold text-white">
              {hero?.title || 'Vèsen Live. Summer Fest'}
            </p>
            {/* Real event, real place. The invented venue line is kept only for
                the no-data fallback, where there is nothing to misstate. */}
            <p className="plt-ev-meta mt-1 truncate text-[11px] text-white/55">
              {hero?.city || 'Sat 12 Sep · Kay Atizan, Pétion-Ville'}
            </p>
            {/* The real event's real price. This line printed a hardcoded
                "From 1,500 HTG", which became a made-up figure the moment the
                poster above it belonged to somebody. Rendered only when the
                price is actually known, so no invented number ever appears
                beside a real event; the fallback keeps the old copy because
                there is no real event to misprice. */}
            {(hero ? hero.price : '1,500 HTG') && (
              <p className="plt-ev-price mt-1 text-[11px] font-semibold text-brand-400">
                {t('platform.vignettes.fromPrice', {
                  defaultValue: 'From {{price}}',
                  price: hero ? hero.price : '1,500 HTG',
                })}
              </p>
            )}
            {/* the rest of the page, suggested */}
            <div className="plt-ev-lines mt-4 space-y-2">
              <div className="h-2 w-full rounded bg-white/[0.07]" />
              <div className="h-2 w-4/5 rounded bg-white/[0.07]" />
              <div className="h-2 w-3/5 rounded bg-white/[0.07]" />
            </div>
            <div className="plt-ev-cta mt-auto rounded-xl bg-white py-2.5 text-center text-[12px] font-medium text-black">
              {t('platform.vignettes.getTickets', { defaultValue: 'Get tickets' })}
            </div>
          </div>
        </PhoneFrame>
      </div>
    </VignetteStage>
  )
}

/* ------------------------------------------------------------------ */
/* 02 — SELL: the feed browses itself through three rails.             */
/* ------------------------------------------------------------------ */

function FeedCard({
  from,
  to,
  glow,
  title,
  going,
  save = false,
  poster,
}: {
  from: string
  to: string
  glow: string
  title: string
  going: string
  save?: boolean
  /** A real event, when the page had one to give. */
  poster?: VignettePoster
}) {
  const { t } = useTranslation('common')
  return (
    <div>
      <div className="relative">
        <MockPoster from={from} to={to} glow={glow} src={poster?.banner_image_url} />
        {save && (
          <span className="plt-feed-save absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded bg-white shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
            <Bookmark className="h-3 w-3 fill-black text-black" />
          </span>
        )}
      </div>
      <p className="mt-1.5 truncate text-[10px] font-semibold text-white">
        {poster?.title || title}
      </p>
      {/* A real event gets its real city. The invented "N going" is kept only
          for the gradient fallback, where there is no real event to misreport. */}
      <p className="truncate text-[9px] text-white/50">
        {poster
          ? poster.city || ''
          : `● ${t('platform.vignettes.going', { defaultValue: '{{n}} going', n: going })}`}
      </p>
    </div>
  )
}

export function DiscoverVignette({ posters = [] }: { posters?: VignettePoster[] }) {
  const { t } = useTranslation('common')
  // Positional: card i shows event i, and falls back to its own gradient when
  // the pool runs short. Ten cards, so a thin pool degrades card by card
  // instead of all-or-nothing.
  const at = (i: number) => posters[i]
  return (
    <VignetteStage glow="rgba(245,158,11,0.10)">
      <PhoneFrame>
        <div className="plt-feed-track px-4 pt-11">
          <p className="font-display lowercase italic text-[19px] leading-none text-white/90">
            {t('platform.vignettes.tonight', { defaultValue: 'tonight' })}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <FeedCard from="#f59e0b" to="#7c2d12" glow="rgba(245,158,11,0.32)" title="Kanaval Kickoff" going="214"  poster={at(0)} />
            <FeedCard from="#e11d48" to="#4c0519" glow="rgba(225,29,72,0.32)" title="Nuit Kompa" going="96"  poster={at(1)} />
            <FeedCard from="#0ea5e9" to="#1e3a8a" glow="rgba(14,165,233,0.32)" title="Plaj Sunset" going="58"  poster={at(2)} />
            <FeedCard from="#10b981" to="#064e3b" glow="rgba(16,185,129,0.32)" title="Fèt Champèt" going="143"  poster={at(3)} />
          </div>
          <p className="mt-5 font-display lowercase italic text-[19px] leading-none text-white/90">
            {t('platform.vignettes.thisWeekend', { defaultValue: 'this weekend' })}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <FeedCard from="#a855f7" to="#3b0764" glow="rgba(168,85,247,0.32)" title="Vibe Rooftop" going="181" save  poster={at(4)} />
            <FeedCard from="#f43f5e" to="#500724" glow="rgba(244,63,94,0.32)" title="Bal Kanpe" going="67"  poster={at(5)} />
            <FeedCard from="#f97316" to="#431407" glow="rgba(249,115,22,0.32)" title="Griyo Night" going="122"  poster={at(6)} />
            <FeedCard from="#6366f1" to="#1e1b4b" glow="rgba(99,102,241,0.32)" title="Jazz Pòtoprens" going="49"  poster={at(7)} />
          </div>
          <p className="mt-5 font-display lowercase italic text-[19px] leading-none text-white/90">
            {t('platform.vignettes.inDiaspora', { defaultValue: 'in the diaspora' })}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2.5 pb-6">
            <FeedCard from="#ec4899" to="#500724" glow="rgba(236,72,153,0.32)" title="Miami Link Up" going="238"  poster={at(8)} />
            <FeedCard from="#3b82f6" to="#172554" glow="rgba(59,130,246,0.32)" title="Konpa Paris" going="164"  poster={at(9)} />
          </div>
        </div>
      </PhoneFrame>
    </VignetteStage>
  )
}

/* ------------------------------------------------------------------ */
/* 03 — GET PAID: a dashboard that is actually live.                   */
/* ------------------------------------------------------------------ */

interface Order {
  id: number
  name: string
  qty: string
  amt: number
  seats: number
}

const ORDER_POOL: Omit<Order, 'id'>[] = [
  { name: 'Nadège J.', qty: '2 × VIP', amt: 7000, seats: 2 },
  { name: 'Ricardo P.', qty: '4 × General', amt: 6000, seats: 4 },
  { name: 'Fabiola M.', qty: '1 × Early bird', amt: 1200, seats: 1 },
  { name: 'Jean-Marc D.', qty: '2 × General', amt: 3000, seats: 2 },
  { name: 'Stephie L.', qty: '3 × General', amt: 4500, seats: 3 },
  { name: 'Woodley A.', qty: '1 × VIP', amt: 3500, seats: 1 },
  { name: 'Mirlande C.', qty: '2 × Early bird', amt: 2400, seats: 2 },
  { name: 'Kervens B.', qty: '2 × General', amt: 3000, seats: 2 },
]

const BARS = [22, 34, 28, 46, 60, 52, 78, 92]

export function DashboardVignette() {
  const { t } = useTranslation('common')
  // Deterministic initial state (SSR-safe); the live ticks start client-side.
  const [orders, setOrders] = useState<Order[]>(
    ORDER_POOL.slice(0, 4).map((o, i) => ({ ...o, id: i }))
  )
  const [revenue, setRevenue] = useState(482_500)
  const [sold, setSold] = useState(1_240)
  const [checked, setChecked] = useState(312)
  const nextRef = useRef(4)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const tick = setInterval(() => {
      const i = nextRef.current
      const next = ORDER_POOL[i % ORDER_POOL.length]
      nextRef.current = i + 1
      setOrders((prev) => [{ ...next, id: i }, ...prev].slice(0, 4))
      setRevenue((r) => r + next.amt)
      setSold((s) => s + next.seats)
      if (i % 2 === 0) setChecked((c) => Math.min(400, c + 3))
    }, 2600)
    return () => clearInterval(tick)
  }, [])

  return (
    <VignetteStage glow="rgba(124,58,237,0.12)">
      <PhoneFrame>
        <div className="h-full px-5 pt-11">
          <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
            <span className="plt-live-dot h-1.5 w-1.5 rounded-full bg-brand-400" />
            {t('platform.vignettes.liveTonight', { defaultValue: 'Live · tonight' })}
          </p>
          <p className="mt-2.5 font-grotesk text-[30px] font-bold leading-none tracking-tight text-white">
            <span key={revenue} className="plt-tick">
              {revenue.toLocaleString('en-US')}
            </span>{' '}
            <span className="text-[15px] font-semibold text-white/55">HTG</span>
          </p>
          <p className="mt-1.5 text-[11px] text-white/55">
            {t('platform.vignettes.ticketsSold', {
              defaultValue: '{{n}} tickets sold',
              n: sold.toLocaleString('en-US'),
            })}
          </p>
          <div className="mt-4 flex h-[52px] items-end gap-1.5">
            {BARS.map((h, i) => (
              <div
                key={i}
                className={`flex-1 rounded-sm ${
                  i === BARS.length - 1 ? 'plt-bar plt-bar-live bg-brand-400' : 'plt-bar bg-white/15'
                }`}
                style={{ height: `${h}%`, ['--d' as any]: `${i * 70}ms` }}
              />
            ))}
          </div>
          <div className="mt-4 space-y-2.5 border-t border-white/10 pt-3.5">
            <p className="flex items-center justify-between text-[11px]">
              <span className="text-white/55">{t('platform.vignettes.checkedIn', { defaultValue: 'Checked in' })}</span>
              <span className="font-semibold text-white">
                <span key={checked} className="plt-tick">
                  {checked}
                </span>{' '}
                / 400
              </span>
            </p>
            <p className="flex items-center justify-between text-[11px]">
              <span className="text-white/55">{t('platform.vignettes.payout', { defaultValue: 'Payout' })}</span>
              <span className="flex items-center gap-1.5 font-medium text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {t('platform.vignettes.availableAfterEvent', { defaultValue: 'Available after event' })}
              </span>
            </p>
          </div>
          {/* orders roll in live, newest first */}
          <p className="mt-5 text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
            {t('platform.vignettes.recentOrders', { defaultValue: 'Recent orders' })}
          </p>
          <div className="mt-2.5 space-y-2.5">
            {orders.map((o, i) => (
              <p
                key={o.id}
                className={`flex items-center justify-between rounded-md text-[11px] ${
                  i === 0 ? 'plt-order-in' : ''
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-white">{o.name}</span>
                  <span className="text-[10px] text-white/45">{o.qty}</span>
                </span>
                <span className="shrink-0 font-semibold text-white/80">
                  {o.amt.toLocaleString('en-US')} HTG
                </span>
              </p>
            ))}
          </div>
        </div>
      </PhoneFrame>
    </VignetteStage>
  )
}
