'use client'

// "THE ORGANIZER CONSOLE" — the guides page's scroll film (2026-09-01, v2).
// Same engine as the homepage AppScrub: a tall track, a sticky stage, one
// rAF-throttled scroll listener, transforms/opacity only. The phone walks
// through what an organizer actually does on Tikèm, one screen per phase —
// and each phase now plays INSIDE its screen as you scroll (w1–w4 below):
//
//   phase 1  create the event — the vertical poster drops in, the fields
//            land one by one, publish arms itself
//   phase 2  watch it sell — revenue counts up, the sold bar fills, the
//            week's bars grow, orders arrive
//   phase 3  build the door team — members cascade in, the new invite
//            slides in pending
//   phase 4  scan at the door — the laser sweeps, the green YES pops,
//            the counter ticks
//
// Captions on the left hand off phase to phase and carry the real links
// (signup + the matching guides). The organizer tab bar tracks the phase.
// Reduced motion pins a still, fully-played dashboard. The phone is theatre
// (aria-hidden, non-interactive).

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  ChevronLeft,
  Home,
  CalendarDays,
  ScanLine,
  Users,
  Plus,
  Check,
  UserPlus,
  ImagePlus,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { StatusBar } from '@/components/home/AppScrub'
import { color } from '@/lib/design/tokens'

const smooth = (p: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (p - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Stagger helper: opacity+rise for item i inside a phase's 0→1 progress. */
const land = (w: number, at: number, span = 0.18) => {
  const t = smooth(w, at, at + span)
  return { opacity: t, transform: `translate3d(0, ${(1 - t) * 12}px, 0)` }
}

/* ------------------------------------------------------------------ */
/* Pieces of the organizer console                                     */
/* ------------------------------------------------------------------ */

function OrgTabBar({ active }: { active: 'home' | 'events' | 'scan' | 'team' }) {
  const { t } = useTranslation('common')
  const items = [
    { key: 'home', icon: Home, label: t('resources.scrub.tab_overview') },
    { key: 'events', icon: CalendarDays, label: t('resources.scrub.tab_events') },
    null, // the + FAB
    { key: 'scan', icon: ScanLine, label: t('resources.scrub.tab_scan') },
    { key: 'team', icon: Users, label: t('resources.scrub.tab_team') },
  ] as const
  return (
    <div className="absolute inset-x-0 bottom-0 z-30 bg-canvas/95 pb-4 pt-2 backdrop-blur-md">
      <div className="flex items-center justify-around px-3">
        {items.map((it, i) =>
          it === null ? (
            <span key={i} className="grid h-9 w-9 place-items-center rounded bg-inverse">
              <Plus className="h-[18px] w-[18px] text-on-inverse" strokeWidth={2.5} />
            </span>
          ) : (
            <span key={i} className="flex flex-col items-center gap-0.5">
              <it.icon
                className={`h-[18px] w-[18px] transition-colors duration-300 ${it.key === active ? 'text-fg' : 'text-fg-faint'}`}
                strokeWidth={it.key === active ? 2.2 : 1.8}
              />
              <span
                className={`text-eyebrow font-medium transition-colors duration-300 ${it.key === active ? 'text-fg' : 'text-fg-faint'}`}
              >
                {it.label}
              </span>
            </span>
          )
        )}
      </div>
      <span className="absolute bottom-1.5 left-1/2 h-[4px] w-[86px] -translate-x-1/2 rounded-full bg-fg/30" />
    </div>
  )
}

/** The event's own header. `poster` carries the artwork onto the screens that
    used to be pure data — the dashboard, the team, the door — because without
    it three of the film's four phases were bare cards with no poster anywhere,
    which is not what the console looks like. 4:5, the house poster shape. */
function ScreenBar({ title, back = true, poster = false }: { title: string; back?: boolean; poster?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 px-4 pt-12">
      {back && (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-surface">
          <ChevronLeft className="h-4 w-4 text-fg" />
        </span>
      )}
      {poster && (
        <span className="relative block aspect-[4/5] w-8 shrink-0 overflow-hidden rounded-md">
          <Image src="/brand/guide-poster.jpg" alt="" fill sizes="32px" className="object-cover" />
        </span>
      )}
      <span className="min-w-0 truncate font-grotesk text-body font-bold text-fg">{title}</span>
    </div>
  )
}

function Field({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-surface px-3 py-2">
      <p className="text-eyebrow font-medium uppercase tracking-[0.14em] text-fg-subtle">{label}</p>
      <p className={`mt-0.5 truncate text-eyebrow font-semibold ${accent ? 'text-brand-400' : 'text-fg'}`}>
        {value}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The scene                                                           */
/* ------------------------------------------------------------------ */

// Caption copy and link labels come from i18n; each link resolves to the
// reader's language version of that guide when it EXISTS — which varies per
// guide (create-event now has Kreyòl; pricing and team-door are EN/FR) — and
// falls back to English otherwise.
const CAPTIONS = [
  { key: 'cap1', linkKey: 'link1', slug: 'create-event', codes: ['en', 'fr', 'ht'] },
  { key: 'cap2', linkKey: 'link2', slug: 'pricing-playbook', codes: ['en', 'fr'] },
  { key: 'cap3', linkKey: 'link3', slug: 'team-door', codes: ['en', 'fr'] },
  { key: 'cap4', linkKey: 'link4', slug: 'team-door', codes: ['en', 'fr'] },
] as const

export default function OrganizerScrub() {
  const { t, i18n } = useTranslation('common')
  const readerLang = (i18n.language || 'en').slice(0, 2)
  const guideLangFor = (codes: readonly string[]) => (codes.includes(readerLang) ? readerLang : 'en')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const [still, setStill] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStill(true)
      setProgress(0.5) // pins the fully-played dashboard
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

  const p = progress

  // Screen push-ins (screen 1 sits underneath from the start).
  const dashY = (1 - smooth(p, 0.28, 0.42)) * 105
  const teamY = (1 - smooth(p, 0.53, 0.67)) * 105
  const scanY = (1 - smooth(p, 0.78, 0.92)) * 105

  // Each phase's inner 0→1 clock: the screen plays while it owns the stage.
  const w1 = still ? 1 : smooth(p, 0.02, 0.26)
  const w2 = still ? 1 : smooth(p, 0.42, 0.53)
  const w3 = still ? 1 : smooth(p, 0.67, 0.78)
  const w4 = still ? 1 : smooth(p, 0.92, 1.0)

  // Caption hand-offs.
  const c1 = still ? 0 : 1 - smooth(p, 0.24, 0.32)
  const c2 = still ? 1 : smooth(p, 0.32, 0.4) * (1 - smooth(p, 0.49, 0.57))
  const c3 = still ? 0 : smooth(p, 0.57, 0.65) * (1 - smooth(p, 0.74, 0.82))
  const c4 = still ? 0 : smooth(p, 0.82, 0.9)

  const activeTab: 'home' | 'events' | 'scan' | 'team' =
    p < 0.35 ? 'events' : p < 0.6 ? 'home' : p < 0.85 ? 'team' : 'scan'

  const opacities = [c1, c2, c3, c4]

  // Phase 2 live numbers, driven by the scroll clock.
  const revenue = Math.round((142500 * (0.12 + 0.88 * w2)) / 500) * 500
  const sold = Math.round(95 * (0.12 + 0.88 * w2))
  const soldPct = Math.round((sold / 350) * 100)

  // Phase 4 beats.
  const scanHit = w4 > 0.45
  const publishArmed = w1 > 0.78

  return (
    <div ref={wrapRef} className="relative h-[400vh] bg-canvas">
      {/* Pinned BELOW the navbar (its own h-14 sm:h-16), not under it: centred
          against a whole h-screen the frame's top 74px sat behind the sticky
          nav at 402×734. svh rather than vh so the stage can't outgrow
          window.innerHeight — the scrub divides by innerHeight, and a taller
          stage unpins before progress reaches 1. Top-aligned on mobile so any
          shortfall clips at the bottom, never against the nav; md+ unchanged.
          Mirrors components/home/AppScrub. */}
      <div className="sticky top-14 flex h-[calc(100svh_-_3.5rem)] items-start overflow-hidden pt-4 sm:top-16 sm:h-[calc(100svh_-_4rem)] md:top-0 md:h-screen md:items-center md:pt-0">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-5 px-4 sm:px-6 md:grid-cols-2 md:gap-10 lg:px-8">
          {/* Captions: each line hands off to the next; links are real. */}
          <div className="relative z-10 order-2 md:order-1">
            <p className="eyebrow text-brand-400">{t('resources.scrub.eyebrow')}</p>
            <div className="relative mt-3 h-24 md:mt-4 md:h-44">
              {CAPTIONS.map((c, i) => (
                <div key={c.key} className="absolute inset-x-0" style={{ opacity: opacities[i] }} aria-hidden={opacities[i] < 0.5}>
                  {/* !text / !leading: body carries .mobile-typography, whose
                      `p { text-sm }` outranks a plain arbitrary class and was
                      rendering these display captions at 14px on phones. */}
                  <p className="font-display lowercase italic !text-[clamp(26px,4.2vw,52px)] !leading-[1.08] text-fg">
                    {t(`resources.scrub.${c.key}`)}
                  </p>
                  <a
                    href={`/guides/${c.slug}-${guideLangFor(c.codes)}.html`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-block text-meta font-medium text-fg-subtle underline decoration-fg-faint underline-offset-4 transition-colors hover:text-fg"
                    tabIndex={opacities[i] > 0.5 ? 0 : -1}
                  >
                    {t(`resources.scrub.${c.linkKey}`)}
                  </a>
                </div>
              ))}
            </div>
            <div className="mt-4 md:mt-6" style={{ opacity: still ? 1 : Math.max(c4, 0) }}>
              <Link
                href="/create"
                className="group inline-flex items-center gap-1.5 text-meta font-medium text-brand-400 transition-colors hover:text-brand-300"
                tabIndex={still || c4 > 0.5 ? 0 : -1}
              >
                {t('resources.scrub.cta')}
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>

          {/* The phone: page scroll walks the console. */}
          <div aria-hidden className="pointer-events-none order-1 select-none md:order-2">
            <div className="mx-auto w-[250px] rounded-[42px] border border-line bg-surface-solid p-2.5 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)] sm:w-[280px]">
              <div className="relative aspect-[9/19.5] overflow-hidden rounded-[32px] bg-canvas">
                <StatusBar />

                {/* ---------- phase 1: create the event ---------- */}
                <div className="absolute inset-0">
                  <ScreenBar title={t('resources.scrub.new_event')} />
                  <div className="px-4 pt-3">
                    <div className="flex gap-2.5">
                      {/* the poster slot — VERTICAL (4:5), the house format */}
                      <div
                        className="relative w-[104px] shrink-0 overflow-hidden rounded-xl"
                        style={{
                          // Floor at 0.5, not 0.25: at the top of the track the
                          // poster was faint enough to read as missing artwork.
                          opacity: 0.5 + 0.5 * smooth(w1, 0, 0.22),
                          transform: `scale(${0.94 + 0.06 * smooth(w1, 0, 0.22)})`,
                        }}
                      >
                        <div className="relative aspect-[4/5]">
                          <Image
                            src="/brand/guide-poster.jpg"
                            alt=""
                            fill
                            sizes="104px"
                            className="object-cover"
                          />
                          <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded bg-scrim-light backdrop-blur-sm">
                            <ImagePlus className="h-2.5 w-2.5 text-fg-soft" />
                          </span>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                        <div style={land(w1, 0.24)}>
                          <Field label={t('resources.scrub.title')} value="Nwit Konpa. Live" />
                        </div>
                        <div style={land(w1, 0.38)}>
                          <Field label={t('resources.scrub.venue')} value="Yanvalou · Pacot" />
                        </div>
                        <div style={land(w1, 0.52)}>
                          <Field label={t('resources.scrub.date')} value="Sat Sep 12 · 9 PM" />
                        </div>
                      </div>
                    </div>
                    <div className="mt-2" style={land(w1, 0.62)}>
                      <Field label={t('resources.scrub.tickets')} value="350 × General, 1,500 HTG" accent />
                    </div>
                    <div
                      className={`mt-3 rounded-xl py-2.5 text-center text-caption font-semibold transition-colors duration-300 ${
                        publishArmed ? 'bg-brand-400 text-on-inverse' : 'bg-surface-raised text-fg-subtle'
                      }`}
                      style={{ transform: `scale(${publishArmed ? 1 : 0.98})`, transition: 'transform 0.3s' }}
                    >
                      {t('resources.scrub.publish')}
                    </div>
                    <p className="mt-2 text-center text-eyebrow text-fg-faint" style={{ opacity: publishArmed ? 1 : 0 }}>
                      {t('resources.scrub.publish_note')}
                    </p>
                  </div>
                </div>

                {/* ---------- phase 2: the live dashboard ---------- */}
                <div
                  className="absolute inset-0 z-10 bg-canvas"
                  style={{ transform: `translate3d(0, ${dashY}%, 0)`, willChange: still ? undefined : 'transform' }}
                >
                  <ScreenBar title="Nwit Konpa. Live" poster />
                  <div className="px-4 pt-3">
                    <div className="rounded-xl bg-surface p-3">
                      <p className="flex items-center gap-1.5 text-eyebrow font-medium uppercase tracking-[0.14em] text-fg-subtle">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                        {t('resources.scrub.revenue_live')}
                      </p>
                      <p className="mt-1 font-grotesk text-section font-bold leading-none text-fg tabular-nums">
                        {revenue.toLocaleString()} <span className="text-meta text-fg-subtle">HTG</span>
                      </p>
                      <div className="mt-3 h-1.5 overflow-hidden rounded bg-surface-raised">
                        <span className="block h-full rounded bg-brand-400" style={{ width: `${soldPct}%` }} />
                      </div>
                      <p className="mt-1.5 text-eyebrow text-fg-subtle tabular-nums">
                        <span className="font-semibold text-fg">
                          {sold} {t('resources.scrub.sold')}
                        </span>{' '}
                        {t('resources.scrub.of')} 350 · {soldPct}%
                      </p>
                    </div>
                    {/* the week, in bars — they grow with the scroll */}
                    <div className="mt-2.5 flex h-14 items-end gap-1.5 rounded-xl bg-surface px-3 pb-2.5 pt-2">
                      {[18, 30, 22, 44, 58, 72, 100].map((h, i) => (
                        <span
                          key={i}
                          className={`flex-1 rounded-sm ${i === 6 ? 'bg-brand-400' : 'bg-fg/20'}`}
                          style={{ height: `${h * smooth(w2, 0.1 + i * 0.08, 0.35 + i * 0.08)}%` }}
                        />
                      ))}
                    </div>
                    <p className="mt-3 text-eyebrow font-medium uppercase tracking-[0.14em] text-fg-subtle">
                      {t('resources.scrub.recent_orders')}
                    </p>
                    <div className="mt-1.5 space-y-1.5">
                      {[
                        ['Nadège P.', '2 × General', '2m'],
                        ['Kervens B.', '1 × General', '9m'],
                        ['Fabiola J.', '4 × General', '14m'],
                      ].map(([name, qty, when], i) => (
                        <div
                          key={name as string}
                          className="flex items-center justify-between rounded-lg bg-surface-low px-2.5 py-1.5"
                          style={land(w2, 0.45 + i * 0.16)}
                        >
                          <span className="text-eyebrow font-semibold text-fg">{name}</span>
                          <span className="text-eyebrow text-fg-subtle">{qty}</span>
                          <span className="text-eyebrow text-fg-faint">{when}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ---------- phase 3: the team ---------- */}
                <div
                  className="absolute inset-0 z-20 bg-canvas"
                  style={{ transform: `translate3d(0, ${teamY}%, 0)`, willChange: still ? undefined : 'transform' }}
                >
                  <ScreenBar title={t('resources.scrub.team')} poster />
                  <div className="px-4 pt-3">
                    <div className="space-y-1.5">
                      {[
                        ['TJ', `Ti Jo ${t('resources.scrub.you')}`, t('resources.scrub.owner')],
                        ['NP', 'Nadège P.', t('resources.scrub.checkin')],
                        ['FJ', 'Fabiola J.', t('resources.scrub.promoter')],
                      ].map(([init, name, role], i) => (
                        <div
                          key={name as string}
                          className="flex items-center gap-2.5 rounded-xl bg-surface px-3 py-2.5"
                          style={land(w3, 0.05 + i * 0.14)}
                        >
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-raised text-eyebrow font-bold text-fg">
                            {init}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-eyebrow font-semibold text-fg">{name}</span>
                            <span className="block text-eyebrow text-fg-subtle">{role}</span>
                          </span>
                          <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        </div>
                      ))}
                      {/* the fresh invite slides in mid-phase */}
                      <div
                        className="flex items-center gap-2.5 rounded-xl border border-brand-400/40 bg-brand-400/10 px-3 py-2.5"
                        style={{
                          opacity: smooth(w3, 0.55, 0.75),
                          transform: `translate3d(${(1 - smooth(w3, 0.55, 0.75)) * 24}px, 0, 0)`,
                        }}
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-400/20 text-eyebrow font-bold text-brand-300">
                          KB
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-eyebrow font-semibold text-fg">Kervens B.</span>
                          <span className="block text-eyebrow text-brand-300">
                            {t('resources.scrub.checkin')} · {t('resources.scrub.invited_now')}
                          </span>
                        </span>
                        <span className="flex items-center gap-1 text-eyebrow font-medium text-warning-soft">
                          <span className="h-1.5 w-1.5 rounded-full bg-warning-soft" />
                          {t('resources.scrub.pending')}
                        </span>
                      </div>
                    </div>
                    <div
                      className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong py-2.5 text-eyebrow font-medium text-fg-muted"
                      style={land(w3, 0.78)}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      {t('resources.scrub.invite_by')}
                    </div>
                    <p className="mt-2 text-center text-eyebrow text-fg-faint" style={{ opacity: smooth(w3, 0.85, 1) }}>
                      {t('resources.scrub.staff_note')}
                    </p>
                  </div>
                </div>

                {/* ---------- phase 4: the door scan ---------- */}
                <div
                  className="absolute inset-0 z-[25] flex flex-col bg-canvas"
                  style={{ transform: `translate3d(0, ${scanY}%, 0)`, willChange: still ? undefined : 'transform' }}
                >
                  <ScreenBar title={t('resources.scrub.door_scan')} poster />
                  <div className="flex flex-1 flex-col px-4 pt-3">
                    {/* viewfinder — the brackets flash green on the hit */}
                    <div className="relative overflow-hidden rounded-2xl bg-canvas py-7">
                      {(
                        [
                          'left-6 top-5 rounded-tl-lg border-l-2 border-t-2',
                          'right-6 top-5 rounded-tr-lg border-r-2 border-t-2',
                          'bottom-5 left-6 rounded-bl-lg border-b-2 border-l-2',
                          'bottom-5 right-6 rounded-br-lg border-b-2 border-r-2',
                        ] as const
                      ).map((pos) => (
                        <span
                          key={pos}
                          className={`absolute h-5 w-5 transition-colors duration-300 ${pos} ${
                            scanHit ? 'border-success' : 'border-fg/60'
                          }`}
                        />
                      ))}
                      <div
                        className="mx-auto w-fit rounded-lg bg-inverse p-2"
                        style={{ transform: `scale(${scanHit ? 1.04 : 1})`, transition: 'transform 0.3s' }}
                      >
                        <QRCodeSVG value="tikem://ticket/TKM-KB9412" size={88} level="M" includeMargin={false} bgColor={color.fg.DEFAULT} fgColor={color.canvas} />
                      </div>
                      {/* the laser rests once the ticket reads */}
                      {!still && !scanHit && (
                        <span className="tk-scanline absolute inset-x-8 top-1/2 h-[2px] rounded bg-brand-400/80" />
                      )}
                    </div>
                    {/* the green YES pops on the hit */}
                    <div
                      className="mt-3 flex items-center gap-2.5 rounded-xl border border-success/40 bg-success/10 px-3 py-2.5"
                      style={{
                        opacity: smooth(w4, 0.45, 0.62),
                        transform: `translate3d(0, ${(1 - smooth(w4, 0.45, 0.62)) * 14}px, 0) scale(${0.96 + 0.04 * smooth(w4, 0.45, 0.62)})`,
                      }}
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-success">
                        <Check className="h-4 w-4 text-on-inverse" strokeWidth={3} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-eyebrow font-bold text-success-soft">
                          {t('resources.scrub.valid')}
                        </span>
                        <span className="block truncate text-eyebrow text-fg-muted">Kervens B. · 1 × General</span>
                      </span>
                    </div>
                    <p className="mt-auto pb-24 pt-3 text-center text-eyebrow text-fg-subtle tabular-nums">
                      <span className="font-semibold text-fg-muted">{scanHit ? 96 : 95}</span>{' '}
                      {t('resources.scrub.scanned')}
                    </p>
                  </div>
                </div>

                <OrgTabBar active={activeTab} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
