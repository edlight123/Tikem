'use client'

// "INSIDE THE APP" — the phone mockup as a full scroll story (2026-08-31
// scroll-film spec, v2 faithful to the real mobile app): status bar, the
// tikèm wordmark bar with the location chip, the search pill, category
// chips, the fixed tab bar with the white + FAB (Home · Discover · + ·
// Tickets · Profile — the attendee tabs from mobile/navigation), and real
// screens for each phase:
//
//   phase 1  the home feed scrolls — page scroll IS the app scroll
//   phase 2  the event screen pushes in over it (the top pick)
//   phase 3  the ticket: white card, QR, perforation — you're in
//
// Same engine as PosterChapter: one rAF-throttled scroll listener,
// transforms/opacity only. Skips itself under 4 posters; reduced motion pins
// a still composition. The phone is theatre (aria-hidden, non-interactive);
// the captions column carries the real link.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Wifi,
  Search,
  Home,
  Compass,
  Plus,
  Ticket,
  User,
  ChevronLeft,
  Share,
  MapPin,
  ChevronDown,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { getEventPriceLabel } from '@/lib/discover/helpers'

export interface AppScrubEvent {
  id: string
  title: string
  banner_image_url: string
  city?: string
  venue_name?: string
  [key: string]: any
}

const smooth = (p: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (p - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/* ------------------------------------------------------------------ */
/* Pieces of the real app                                              */
/* ------------------------------------------------------------------ */

export function StatusBar() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-between bg-gradient-to-b from-[#0a0a0a] from-40% via-[#0a0a0a]/85 to-transparent px-6 pb-4 pt-3">
      <span className="w-10 text-[11px] font-semibold tracking-tight text-white">9:41</span>
      <span className="h-[18px] w-[76px] rounded-full bg-black" />
      <span className="flex w-10 items-center justify-end gap-1">
        {/* signal bars */}
        <span className="flex items-end gap-[1.5px]" aria-hidden>
          <span className="h-[4px] w-[2.5px] rounded-[1px] bg-white" />
          <span className="h-[6px] w-[2.5px] rounded-[1px] bg-white" />
          <span className="h-[8px] w-[2.5px] rounded-[1px] bg-white" />
          <span className="h-[10px] w-[2.5px] rounded-[1px] bg-white/40" />
        </span>
        <Wifi className="h-[11px] w-[11px] text-white" strokeWidth={2.5} />
        {/* battery */}
        <span className="relative h-[10px] w-[18px] rounded-[3px] border border-white/50" aria-hidden>
          <span className="absolute inset-[1.5px] right-[4px] rounded-[1px] bg-white" />
          <span className="absolute -right-[3px] top-1/2 h-[4px] w-[1.5px] -translate-y-1/2 rounded-r-full bg-white/50" />
        </span>
      </span>
    </div>
  )
}

function Wordmark() {
  return (
    <span className="font-display italic text-[19px] leading-none text-white">
      tik<span className="not-italic text-brand-400">è</span>m
    </span>
  )
}

function TabBar() {
  const items = [
    { icon: Home, label: 'Home', active: true },
    { icon: Compass, label: 'Discover', active: false },
    null, // the white + FAB
    { icon: Ticket, label: 'Tickets', active: false },
    { icon: User, label: 'Profile', active: false },
  ] as const
  return (
    <div className="absolute inset-x-0 bottom-0 z-[5] bg-[#0a0a0a]/95 pb-4 pt-2 backdrop-blur-md">
      <div className="flex items-center justify-around px-3">
        {items.map((it, i) =>
          it === null ? (
            <span key={i} className="grid h-9 w-9 place-items-center rounded bg-white">
              <Plus className="h-[18px] w-[18px] text-black" strokeWidth={2.5} />
            </span>
          ) : (
            <span key={i} className="flex flex-col items-center gap-0.5">
              <it.icon
                className={`h-[18px] w-[18px] ${it.active ? 'text-white' : 'text-white/35'}`}
                strokeWidth={it.active ? 2.2 : 1.8}
              />
              <span className={`text-[8px] font-medium ${it.active ? 'text-white' : 'text-white/35'}`}>
                {it.label}
              </span>
            </span>
          )
        )}
      </div>
      {/* home indicator */}
      <span className="absolute bottom-1.5 left-1/2 h-[4px] w-[86px] -translate-x-1/2 rounded-full bg-white/30" />
    </div>
  )
}

function FeedCard({ ev }: { ev: AppScrubEvent }) {
  const { t } = useTranslation('common')
  const price = getEventPriceLabel(ev as any, t)
  return (
    <div>
      <div className="relative aspect-[4/5] overflow-hidden rounded">
        <Image src={ev.banner_image_url} alt="" fill sizes="130px" quality={50} className="object-cover" />
      </div>
      <p className="mt-1.5 truncate text-[10px] font-semibold text-white">{ev.title}</p>
      {ev.city && <p className="truncate text-[9px] text-white/50">{ev.city}</p>}
      {price && <p className="truncate text-[9px] font-semibold text-brand-400">{price}</p>}
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* The scene                                                           */
/* ------------------------------------------------------------------ */

export default function AppScrub({
  events,
  hero,
}: {
  /** Real events filling the in-phone feed. */
  events: AppScrubEvent[]
  /** The event the story opens and tickets (the top pick). */
  hero?: (AppScrubEvent & Record<string, any>) | null
}) {
  const { t } = useTranslation('common')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const [still, setStill] = useState(false)

  const posters = (events || []).filter((e) => e?.banner_image_url)
  const star = hero && hero.banner_image_url ? hero : posters[0]

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStill(true)
      setProgress(0.2)
      return
    }
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const el = wrapRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const scrollable = rect.height - window.innerHeight
        if (scrollable <= 0) return
        setProgress(Math.min(1, Math.max(0, -rect.top / scrollable)))
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  if (posters.length < 4 || !star) return null

  const feed = Array.from({ length: 10 }, (_, i) => posters[i % posters.length])
  const p = progress

  const feedY = -smooth(p, 0.02, 0.52) * 54 // % of feed track height
  const eventY = (1 - smooth(p, 0.52, 0.7)) * 105
  const ticketY = (1 - smooth(p, 0.78, 0.94)) * 105

  const c1 = still ? 1 : 1 - smooth(p, 0.42, 0.52)
  const c2 = still ? 0 : smooth(p, 0.54, 0.62) * (1 - smooth(p, 0.7, 0.78))
  const c3 = still ? 0 : smooth(p, 0.8, 0.88)

  const priceLabel = getEventPriceLabel(star as any, t)
  const place = [star.venue_name, star.city].filter(Boolean).join(' · ')
  const code = `TKM-${String(star.id).replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase() || 'OULADAN'}`

  const captions: { key: string; text: string; opacity: number }[] = [
    { key: 'a', text: t('home.appscrub_a', { defaultValue: 'one feed. every fèt.' }), opacity: c1 },
    { key: 'b', text: t('home.appscrub_b', { defaultValue: 'tap. peye. antre.' }), opacity: c2 },
    { key: 'c', text: t('home.appscrub_c', { defaultValue: 'ou ladan, you’re in.' }), opacity: c3 },
  ]

  return (
    <div ref={wrapRef} className="relative h-[170vh] bg-[#0a0a0a] sm:h-[320vh]">
      {/* The stage pins BELOW the site chrome, not under it. At top-0 with a
          full h-screen the composition centred itself against the whole
          viewport, so on a phone (402×734) the top 23px of the frame — the
          notch and the status bar — sat behind the sticky navbar, and at
          402×664 the first 58px were gone. The offset tracks Navbar's own
          h-14 sm:h-16 (3.5rem / 4rem).
          The height is svh, not vh: iOS Safari's 100vh is the toolbars-hidden
          height while window.innerHeight (what the scrub divides by) is the
          visible one, and a stage taller than top + innerHeight unpins BEFORE
          progress reaches 1 — the last beats of the film played while the
          phone was already sliding away. svh makes the two agree.
          Mobile starts the composition at the top instead of centring it: a
          short phone can't fit phone + captions + CTA, and clipping must
          happen at the bottom, never against the navbar. md+ is unchanged. */}
      <div className="sticky top-14 flex h-[calc(100svh_-_3.5rem)] items-start overflow-hidden pt-4 sm:top-16 sm:h-[calc(100svh_-_4rem)] md:top-0 md:h-screen md:items-center md:pt-0">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-5 px-4 sm:px-6 md:grid-cols-2 md:gap-10 lg:px-8">
          {/* Captions hold the left; each line hands off to the next. */}
          <div className="relative z-10 order-2 md:order-1">
            <div className="relative h-16 md:h-40">
              {captions.map((c) => (
                <p
                  key={c.key}
                  className="absolute inset-x-0 font-display lowercase italic !text-[clamp(26px,4.2vw,52px)] !leading-[1.08] text-white"
                  style={{ opacity: c.opacity }}
                  aria-hidden={c.opacity < 0.5}
                >
                  {c.text}
                </p>
              ))}
            </div>
            {/* In flow, not absolute at top-full: out of flow it reserved no
                height, so on a phone it landed past the stage's
                overflow-hidden edge and never showed. Same position on md+,
                where the phone column sets the row height. */}
            <div className="mt-4 md:mt-6" style={{ opacity: still ? 1 : Math.max(c3, 0) }}>
              <Link
                href="/discover"
                className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-400 transition-colors hover:text-brand-300"
              >
                {t('home.appscrub_cta', { defaultValue: 'explore events' })}
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>

          {/* The phone: page scroll drives the screen. */}
          <div aria-hidden className="pointer-events-none order-1 select-none md:order-2">
            <div className="mx-auto w-[250px] rounded-[42px] border border-white/10 bg-[#161616] p-2.5 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)] sm:w-[280px]">
              <div className="relative aspect-[9/19.5] overflow-hidden rounded-[32px] bg-[#0a0a0a]">
                <StatusBar />

                {/* ---------- phase 1: the home feed ---------- */}
                <div
                  className="px-4 pt-12"
                  style={{ transform: `translate3d(0, ${feedY}%, 0)`, willChange: still ? undefined : 'transform' }}
                >
                  {/* wordmark bar + location chip — the real home top bar */}
                  <div className="flex items-center justify-between">
                    <Wordmark />
                    <span className="flex items-center gap-1 rounded bg-white/[0.06] px-2 py-1 text-[9px] font-medium text-white/70">
                      <MapPin className="h-[9px] w-[9px]" />
                      Port-au-Prince
                      <ChevronDown className="h-[9px] w-[9px] text-white/40" />
                    </span>
                  </div>

                  {/* search pill */}
                  <div className="mt-3 flex items-center gap-2 rounded bg-white/[0.06] px-3 py-2">
                    <Search className="h-[11px] w-[11px] text-white/40" />
                    <span className="text-[10px] text-white/40">Search events, organizers…</span>
                  </div>

                  {/* category chips */}
                  <div className="mt-3 flex gap-1.5">
                    <span className="rounded bg-white px-2.5 py-1 text-[9px] font-semibold text-black">All</span>
                    {['mizik', 'fèt', 'espò', 'kilti'].map((c) => (
                      <span key={c} className="rounded bg-white/[0.06] px-2.5 py-1 text-[9px] text-white/60">
                        {c}
                      </span>
                    ))}
                  </div>

                  <p className="mt-4 font-display lowercase italic text-[17px] leading-none text-white/90">
                    {t('events.rail_tonight', { defaultValue: 'tonight' })}
                  </p>
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                    {feed.slice(0, 4).map((ev, i) => (
                      <FeedCard key={`${ev.id}-${i}`} ev={ev} />
                    ))}
                  </div>
                  <p className="mt-4 font-display lowercase italic text-[17px] leading-none text-white/90">
                    {t('events.this_week', { defaultValue: 'this week' })}
                  </p>
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                    {feed.slice(4, 8).map((ev, i) => (
                      <FeedCard key={`${ev.id}-w${i}`} ev={ev} />
                    ))}
                  </div>
                  <p className="mt-4 font-display lowercase italic text-[17px] leading-none text-white/90">
                    {t('events.rail_diaspora', { defaultValue: 'in the diaspora' })}
                  </p>
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5 pb-20">
                    {feed.slice(8, 10).map((ev, i) => (
                      <FeedCard key={`${ev.id}-d${i}`} ev={ev} />
                    ))}
                  </div>
                </div>

                {/* the tab bar stays fixed while the feed scrolls — like the app */}
                <TabBar />

                {/* ---------- phase 2: the event screen pushes in ---------- */}
                <div
                  className="absolute inset-0 z-10 flex flex-col bg-[#0a0a0a]"
                  style={{ transform: `translate3d(0, ${eventY}%, 0)`, willChange: still ? undefined : 'transform' }}
                >
                  <div className="relative aspect-[4/5] w-full shrink-0 overflow-hidden">
                    <Image src={star.banner_image_url} alt="" fill sizes="280px" quality={60} className="object-cover" />
                    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0a0a0a] to-transparent" />
                    {/* push-screen chrome over the poster */}
                    <span className="absolute left-3 top-10 grid h-7 w-7 place-items-center rounded bg-black/40 backdrop-blur-md">
                      <ChevronLeft className="h-4 w-4 text-white" />
                    </span>
                    <span className="absolute right-3 top-10 grid h-7 w-7 place-items-center rounded bg-black/40 backdrop-blur-md">
                      <Share className="h-3.5 w-3.5 text-white" />
                    </span>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col px-4 pb-5">
                    <p className="line-clamp-2 font-grotesk text-[16px] font-bold leading-tight text-white">
                      {star.title}
                    </p>
                    {place && <p className="mt-1 truncate text-[11px] text-white/55">{place}</p>}
                    {priceLabel && (
                      <p className="mt-1 text-[11px] font-semibold text-brand-400">{priceLabel}</p>
                    )}
                    <div className="mt-3 space-y-1.5">
                      <span className="block h-1.5 w-full rounded bg-white/[0.07]" />
                      <span className="block h-1.5 w-4/5 rounded bg-white/[0.07]" />
                    </div>
                    <div className="mt-auto rounded bg-white py-2.5 text-center text-[12px] font-medium text-black">
                      {t('events.get_tickets', { defaultValue: 'Get tickets' })}
                    </div>
                  </div>
                </div>

                {/* ---------- phase 3: the ticket ---------- */}
                <div
                  className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0a0a0a] px-5"
                  style={{ transform: `translate3d(0, ${ticketY}%, 0)`, willChange: still ? undefined : 'transform' }}
                >
                  <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
                    {t('home.appscrub_ticket', { defaultValue: 'Your ticket' })}
                  </p>

                  {/* the white ticket card: poster header, real QR, punched
                      perforation, the real app's ticket, made poster-grade */}
                  <div className="relative mt-4 w-full max-w-[216px]">
                    {/* soft brand glow behind the card */}
                    <span aria-hidden className="absolute -inset-5 rounded bg-brand-400/15 blur-2xl" />
                    <div className="relative overflow-hidden rounded bg-white text-center shadow-[0_24px_60px_-18px_rgba(0,0,0,0.9)]">
                      {/* event artwork band */}
                      <div className="relative h-14 w-full">
                        <Image
                          src={star.banner_image_url}
                          alt=""
                          fill
                          sizes="216px"
                          quality={55}
                          className="object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-white via-white/10 to-transparent" />
                      </div>
                      <div className="px-5 pb-1 pt-1.5">
                        <p className="line-clamp-1 font-grotesk text-[13px] font-bold text-black">{star.title}</p>
                        {place && <p className="mt-0.5 truncate text-[9px] text-black/50">{place}</p>}
                        {/* the QR, framed like the real ticket screen */}
                        <div className="mt-3 flex justify-center">
                          <div className="rounded border border-black/[0.08] bg-white p-2.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
                            <QRCodeSVG
                              value={`tikem://ticket/${code}`}
                              size={100}
                              level="M"
                              includeMargin={false}
                              bgColor="#ffffff"
                              fgColor="#0a0a0a"
                            />
                          </div>
                        </div>
                      </div>
                      {/* perforation: punched notches clip into the card edges */}
                      <div className="relative mt-3">
                        <span className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[#0a0a0a]" />
                        <span className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[#0a0a0a]" />
                        <span className="mx-4 block border-t border-dashed border-black/20" />
                      </div>
                      {/* the stub */}
                      <div className="flex items-center justify-between px-5 pb-3.5 pt-2.5">
                        <span className="label-mono text-[10px] tracking-[0.08em] text-black/75">{code}</span>
                        <span className="text-[9px] font-medium text-black/45">1 × General</span>
                      </div>
                    </div>
                  </div>

                  <p className="mt-4 flex items-center gap-1.5 text-[11px] text-white/55">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {t('home.appscrub_valid', { defaultValue: 'valid · 1 × General' })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
