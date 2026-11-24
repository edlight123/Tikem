// An occasion's page (lib/occasions): /occasions/kanaval, /occasions/fet-manman…
// A real photo with the name and dates on it, the events tagged for it (plus
// untagged ones on the main days of a short occasion), and a few ideas that
// open Create Event filled in. The app opens the same path natively
// (OccasionScreen; tikem://occasions/<key> and the universal link).

import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowRight, CalendarDays, Plus } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth'
import { isAdmin } from '@/lib/admin'
import Navbar from '@/components/Navbar'
import MobileNavWrapper from '@/components/MobileNavWrapper'
import { SectionHeader } from '@/components/ui/EditorialRails'
import { DiscoverEventCard } from '@/components/discover/DiscoverEventCard'
import OccasionIcon from '@/components/occasions/OccasionIcon'
import { isDemoMode, DEMO_EVENTS } from '@/lib/demo'
import { getDiscoverEvents } from '@/lib/data/events'
import { filterBlockedEvents, getBlockedOrganizerIds } from '@/lib/moderation/blocks'
import { collapseSeries } from '@/lib/events/series'
import { hasEnded, toHomeEvent } from '@/lib/home/feed'
import {
  ideaDate,
  ideaText,
  occasionBlurb,
  occasionByKey,
  occasionDaysUntil,
  occasionEvents,
  occasionIdeas,
  occasionName,
  occasionToday,
  occasionWindow,
  parseOccasion,
} from '@/lib/occasions'
import { formatOccasionDay, formatOccasionRange } from '@/lib/occasionFormat'
import { resolveServerLanguage, tServer } from '@/lib/serverT'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const key = parseOccasion((await params).key)
  if (!key) return { title: 'Tikèm' }
  const lang = await resolveServerLanguage()
  const name = occasionName(key, lang)
  const title = `${name} | Tikèm`
  const description = occasionBlurb(key, lang)
  return {
    title,
    description,
    alternates: { canonical: `/occasions/${key}` },
    openGraph: { title, description, images: [occasionByKey(key)!.webPhoto] },
  }
}

export default async function OccasionPage({ params }: { params: Promise<{ key: string }> }) {
  const key = parseOccasion((await params).key)
  if (!key) notFound()
  const occasion = occasionByKey(key)!
  const [user, lang] = await Promise.all([getCurrentUser(), resolveServerLanguage()])
  const t = (path: string, fallback: string, vars: Record<string, string | number> = {}) =>
    Object.entries(vars).reduce((s, [k, v]) => s.split(`{{${k}}}`).join(String(v)), tServer(lang, `occasions.${path}`, fallback))

  const now = Date.now()
  const range = occasionWindow(key, now)
  const days = occasionDaysUntil(range, now)
  const today = occasionToday(now)
  const underWay = today >= range.start && today <= range.end
  const countdown = underWay
    ? t('under_way', 'Under way')
    : days === 1
      ? t('tomorrow', 'Tomorrow')
      : t('in_days', 'In {{count}} days', { count: days })
  const when = formatOccasionRange(range.mainStart, range.mainEnd, lang)
  const preKanaval =
    range.start < range.mainStart && key === 'kanaval'
      ? t('pre_kanaval', 'Pre-kanaval Sundays from {{date}}', { date: formatOccasionDay(range.start, lang) })
      : ''

  const [raw, blocked] = await Promise.all([
    isDemoMode() ? Promise.resolve(DEMO_EVENTS as any[]) : getDiscoverEvents({}, 100).catch(() => [] as any[]),
    getBlockedOrganizerIds(user?.id),
  ])
  const upcoming = collapseSeries(
    filterBlockedEvents(raw, blocked).filter((e: any) => {
      const h = toHomeEvent(e)
      return !!h && !hasEnded(h, now)
    })
  )
  const events = occasionEvents(upcoming, key, range)
  const ideas = occasionIdeas(key)
  const name = occasionName(key, lang)
  const adminFlag = isAdmin((user as any)?.email_verified ? user?.email : null)

  const words = (
    <>
      <p className="flex items-center gap-2 font-mono text-eyebrow uppercase tracking-[0.14em] text-fg-muted">
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${underWay ? 'bg-brand-500' : 'bg-fg-muted'}`} />
        {countdown}
      </p>
      <h1 className="mt-3 font-display italic font-normal text-fg text-balance !text-[clamp(38px,5.5vw,64px)] !leading-[0.95]">
        {name}
      </h1>
      <p className="mt-3 flex items-center gap-2 text-body text-fg-soft">
        <CalendarDays aria-hidden className="h-4 w-4 shrink-0 text-fg-subtle" />
        {when}
      </p>
      {preKanaval && <p className="mt-1 pl-6 text-meta text-fg-subtle">{preKanaval}</p>}
    </>
  )

  return (
    <div className="min-h-screen bg-canvas pb-mobile-nav">
      <Navbar user={user} isAdmin={adminFlag} />
      <main id="content" className="mx-auto max-w-7xl px-4 pb-20 pt-4 sm:px-6 sm:pt-6 lg:px-8">
        {/* Phone: the photo with the words on a scrim. From lg: words left, photo right. */}
        <div className="relative overflow-hidden rounded bg-surface-low lg:hidden">
          <div className="relative aspect-[4/5] max-h-[72vh] w-full sm:aspect-[16/11]">
            <Image src={occasion.webPhoto} alt="" fill priority sizes="100vw" className="object-cover" />
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(to bottom, rgba(10,10,10,0) 25%, rgba(10,10,10,0.55) 55%, rgba(10,10,10,0.97) 100%)',
              }}
            />
            <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8">{words}</div>
          </div>
        </div>
        <div className="hidden overflow-hidden rounded bg-surface-low lg:grid lg:grid-cols-12">
          <div className="flex flex-col justify-end p-12 lg:col-span-7 xl:p-14">{words}</div>
          <div className="relative aspect-[4/5] max-h-[460px] w-full lg:col-span-5">
            <Image src={occasion.webPhoto} alt="" fill priority sizes="40vw" className="object-cover" />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <p className="flex min-w-0 items-center gap-2 text-body text-fg-muted">
            <OccasionIcon name={occasion.icon} className="h-4 w-4 shrink-0 text-fg-subtle" />
            {occasionBlurb(key, lang)}
          </p>
          <Link
            href={`/create?occasion=${key}`}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded bg-inverse px-4 font-grotesk text-meta font-semibold text-on-inverse outline-none transition-colors hover:bg-inverse-hover focus-visible:ring-2 focus-visible:ring-fg/70"
          >
            <Plus aria-hidden className="h-4 w-4" />
            {t('add_event', 'Add an event')}
          </Link>
        </div>

        <section className="mt-14">
          <SectionHeader title={t('events_title', 'events')} />
          {events.length > 0 ? (
            <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4">
              {events.map((e: any) => (
                <li key={e.id}>
                  <DiscoverEventCard event={e} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded bg-surface-low px-4 py-5 text-body text-fg-muted">{t('empty', 'Nothing listed for it yet.')}</p>
          )}
        </section>

        {ideas.length > 0 && (
          <section className="mt-14">
            <SectionHeader title={t('ideas_title', 'ideas to host')} />
            <ul className="space-y-2">
              {ideas.map((idea) => {
                const copy = ideaText(idea, lang)
                return (
                  <li key={idea.id}>
                    <Link
                      href={`/create?occasion=${key}&idea=${idea.id}`}
                      className="group flex items-center gap-4 rounded bg-surface-low px-4 py-3.5 outline-none transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-fg/70"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-grotesk text-body font-semibold text-fg">{copy.title}</span>
                        <span className="mt-0.5 block truncate text-meta text-fg-subtle">
                          {formatOccasionDay(ideaDate(idea, now), lang)} · {idea.time} · {copy.description}
                        </span>
                      </span>
                      <span className="hidden shrink-0 items-center gap-1.5 text-meta font-medium text-fg-muted transition-colors group-hover:text-fg sm:flex">
                        {t('use_idea', 'Create this event')}
                      </span>
                      <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </main>
      <MobileNavWrapper user={user} isAdmin={adminFlag} />
    </div>
  )
}
