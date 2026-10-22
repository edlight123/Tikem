'use client'

// The guides page, as an experience (all copy through i18n):
//   ACT 0  the statement hero — SELL OUT. with the guides floating around it
//   ACT 1  the organizer console as a scroll film
//          + the verb-chain marquee
//   ACT 2  the library — guides as editorial rows, cascading in
//   ACT 3  the outro — ou pare?
//
// Guide links resolve to the reader's language when that version exists
// (EN/FR everywhere, HT for the organizer program), falling back to EN.

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import OrganizerScrub from '@/components/resources/OrganizerScrub'
import { Reveal, FloatingGuides, Marquee, OuPare } from '@/components/resources/ResourcesFx'
import {
  ArrowRight,
  ArrowUpRight,
  Rocket,
  Ticket,
  Palette,
  Tag,
  Wallet,
  ScanLine,
  QrCode,
  FileText,
  HelpCircle,
  Download,
} from 'lucide-react'

type Guide = {
  slug: string
  key: string
  icon: any
  codes: Array<'en' | 'fr' | 'ht'>
  /** Languages that have a downloadable PDF. Defaults to `codes` when absent (HT guides have no PDF yet). */
  pdfCodes?: string[]
  pdf: boolean
}

const ORGANIZER_GUIDES: Guide[] = [
  { slug: 'organizer-program', key: 'organizer_program', icon: Rocket, codes: ['en', 'fr', 'ht'], pdf: true },
  { slug: 'create-event', key: 'create_event', icon: Ticket, codes: ['en', 'fr', 'ht'], pdfCodes: ['en', 'fr'], pdf: true },
  { slug: 'poster-guide', key: 'poster_guide', icon: Palette, codes: ['en', 'fr'], pdf: true },
  { slug: 'pricing-playbook', key: 'pricing_playbook', icon: Tag, codes: ['en', 'fr'], pdf: true },
  { slug: 'getting-paid', key: 'getting_paid', icon: Wallet, codes: ['en', 'fr'], pdf: true },
  { slug: 'team-door', key: 'team_door', icon: ScanLine, codes: ['en', 'fr'], pdf: true },
]
const ATTENDEE_GUIDES: Guide[] = [
  { slug: 'ticket-guide', key: 'ticket_guide', icon: QrCode, codes: ['en', 'fr', 'ht'], pdfCodes: ['en', 'fr'], pdf: true },
]
const ABOUT_GUIDES: Guide[] = [
  { slug: 'one-pager', key: 'one_pager', icon: FileText, codes: ['en', 'fr'], pdf: false },
  { slug: 'faq', key: 'faq', icon: HelpCircle, codes: ['en', 'fr'], pdf: false },
]

const LANG_LABEL: Record<string, string> = { en: 'English', fr: 'Français', ht: 'Kreyòl' }

/** The guide in the reader's language when it exists, EN otherwise. */
export function guideHref(slug: string, lng: string, codes: string[] = ['en', 'fr']) {
  const short = (lng || 'en').slice(0, 2)
  const pick = codes.includes(short) ? short : 'en'
  return `/guides/${slug}-${pick}.html`
}

function GuideRow({ guide, index }: { guide: Guide; index: string }) {
  const { t, i18n } = useTranslation('common')
  const Icon = guide.icon
  const title = t(`resources.guides.${guide.key}.title`)
  const pdfCodes = guide.pdfCodes ?? guide.codes
  return (
    <div className="group relative border-t border-white/10 transition-colors duration-300 hover:bg-white/[0.02]">
      <div className="grid grid-cols-1 gap-4 py-7 sm:grid-cols-[64px_1fr_auto] sm:items-baseline sm:gap-8 sm:py-9">
        {/* index + icon */}
        <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-4">
          <span className="label-mono text-[12px] text-white/35">{index}</span>
          <Icon className="h-4 w-4 text-brand-400/80" strokeWidth={1.75} />
        </div>

        {/* the read — the whole title is the link, in the reader's language */}
        <div className="min-w-0">
          <a
            href={guideHref(guide.slug, i18n.language, guide.codes)}
            target="_blank"
            rel="noopener noreferrer"
            className="group/title inline-flex items-baseline gap-3"
          >
            <span className="font-display lowercase italic text-[clamp(26px,3.4vw,42px)] leading-[1.05] text-white/85 transition-all duration-300 group-hover:translate-x-1.5 group-hover:text-white">
              {title.toLowerCase()}
            </span>
            <ArrowUpRight className="h-[0.55em] w-[0.55em] shrink-0 translate-y-1 self-center text-white/0 transition-all duration-300 group-hover:text-brand-400" />
          </a>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/50">
            {t(`resources.guides.${guide.key}.body`)}
          </p>
        </div>

        {/* the languages */}
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {guide.codes.map((c) => (
            <span key={c} className="flex items-center overflow-hidden rounded border border-white/10">
              <a
                href={`/guides/${guide.slug}-${c}.html`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 font-mono text-[11px] tracking-wider text-white/70 transition-colors hover:bg-white/5 hover:text-brand-300"
              >
                {c.toUpperCase()}
              </a>
              {guide.pdf && pdfCodes.includes(c) && (
                <a
                  href={`/guides/${guide.slug}-${c}.pdf`}
                  download
                  className="border-l border-white/10 px-2.5 py-1.5 text-white/45 transition-colors hover:bg-white/5 hover:text-brand-300"
                  aria-label={`${title} (${LANG_LABEL[c]}). PDF`}
                >
                  <Download className="h-3 w-3" />
                </a>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Chapter({
  index,
  chapter,
  guides,
  startAt,
}: {
  index: string
  chapter: 'c1' | 'c2' | 'c3'
  guides: Guide[]
  startAt: number
}) {
  const { t } = useTranslation('common')
  return (
    <section className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8">
      {/* the chapter's ghost numeral */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-4 right-2 font-grotesk text-[clamp(120px,22vw,280px)] font-bold leading-none tracking-[-0.04em] text-white/[0.03] sm:right-6"
      >
        {index}
      </span>
      <Reveal>
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="eyebrow text-brand-400">
              {index} &nbsp; {t(`resources.${chapter}_kicker`)}
            </p>
            <h2 className="mt-3 font-grotesk text-[clamp(30px,5vw,54px)] font-bold uppercase leading-[0.95] tracking-[-0.02em] text-white">
              {t(`resources.${chapter}_title`)}
            </h2>
          </div>
          <p className="max-w-sm text-[14px] leading-relaxed text-white/50">{t(`resources.${chapter}_blurb`)}</p>
        </div>
      </Reveal>
      <div className="border-b border-white/10">
        {guides.map((g, i) => (
          <Reveal key={g.slug} delay={i * 70}>
            <GuideRow guide={g} index={String(startAt + i).padStart(2, '0')} />
          </Reveal>
        ))}
      </div>
    </section>
  )
}

export default function ResourcesContent() {
  const { t } = useTranslation('common')

  return (
    <>
      {/* ACT 0 — the statement. This is a playbook, not a help center.
          The guides themselves float around it, like the homepage's posters. */}
      <section className="relative overflow-hidden bg-white/[0.03]">
        <FloatingGuides />
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-20 sm:px-6 sm:pb-24 sm:pt-32 lg:px-8">
          <p
            className="plt-enter font-display lowercase italic !text-[17px] !leading-none text-white/60"
            style={{ ['--d' as any]: '0s' }}
          >
            {t('resources.hero_eyebrow')}
          </p>
          <h1
            className="plt-enter mt-5 font-grotesk font-bold uppercase tracking-[-0.02em] text-white !leading-[0.95] !text-[clamp(52px,10vw,140px)]"
            style={{ ['--d' as any]: '0.08s' }}
          >
            {t('resources.hero_line1')}
            <br />
            {t('resources.hero_line2')}
          </h1>
          <p
            className="plt-enter mt-6 max-w-xl font-display lowercase italic !text-[clamp(18px,2.4vw,24px)] !leading-snug text-white/70"
            style={{ ['--d' as any]: '0.18s' }}
          >
            {t('resources.hero_sub')}
          </p>
        </div>
        {/* scroll cue — a breathing hairline */}
        <div
          aria-hidden
          className="plt-breathe absolute bottom-5 left-1/2 hidden h-12 w-px -translate-x-1/2 bg-gradient-to-b from-transparent to-white/40 lg:block"
        />
      </section>

      {/* ACT 1 — the console, as a scroll film. */}
      <OrganizerScrub />

      {/* the organizer's verb chain, in motion */}
      <Marquee />

      {/* ACT 2 — the library. */}
      <Chapter index="01" chapter="c1" guides={ORGANIZER_GUIDES} startAt={1} />

      <div className="mx-auto max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="hairline" />
      </div>

      <Chapter index="02" chapter="c2" guides={ATTENDEE_GUIDES} startAt={7} />

      <div className="mx-auto max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="hairline" />
      </div>

      <Chapter index="03" chapter="c3" guides={ABOUT_GUIDES} startAt={8} />

      {/* ACT 3 — the outro. */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute left-1/2 top-1/2 h-[420px] w-[420px] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-400/[0.07] blur-[120px]"
        />
        <div className="relative mx-auto max-w-4xl px-5 py-24 text-center sm:px-6 sm:py-32 lg:px-8">
          <OuPare />
          <Reveal delay={200}>
            <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-white/55">
              {t('resources.outro_sub')}
            </p>
          </Reveal>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            {/* Straight into the composer — no account needed until publish. */}
            <Link
              href="/create"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-7 py-3.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-700"
            >
              {t('resources.cta_create')}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/support"
              className="inline-flex items-center rounded-xl border border-white/15 px-7 py-3.5 text-sm font-semibold text-white/85 transition-all duration-200 hover:border-white/30 hover:bg-white/5"
            >
              {t('resources.cta_support')}
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
