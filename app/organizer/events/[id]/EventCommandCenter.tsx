'use client'

import { useTranslation } from 'react-i18next'

import Link from 'next/link'
import Image from 'next/image'
import { format, formatDistanceToNow, isValid } from 'date-fns'
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  DollarSign,
  Image as ImageIcon,
  MapPin,
  Globe,
  Ticket,
  TrendingUp,
  Users,
} from 'lucide-react'
import { formatMoneyFromCents, normalizeCurrency } from '@/lib/money'

interface EventCommandCenterProps {
  event: any
  stats: any
  tickets: any[]
  tiers: any[]
}

const TREND_DAYS = 14

export function EventCommandCenter({ event, stats, tickets, tiers }: EventCommandCenterProps) {
  const { t: tx } = useTranslation('organizer')

  const currency = normalizeCurrency(event?.currency, stats?.currency || 'HTG')
  const liveTickets = tickets.filter((t: any) => (t.status || '').toLowerCase() !== 'cancelled')

  const capacity = Number(stats?.capacity || 0)
  const sold = Number(stats?.ticketsSold || 0)
  const checkedIn = Number(stats?.checkedIn || 0)
  const pctSold = capacity > 0 ? Math.min(100, Math.round((sold / capacity) * 100)) : 0

  // --- Sales trend (last N days, derived from purchase timestamps) ---
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const buckets = Array.from({ length: TREND_DAYS }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (TREND_DAYS - 1 - i))
    return { date: d, count: 0 }
  })
  for (const t of liveTickets) {
    if (!t.purchased_at) continue
    const p = new Date(t.purchased_at)
    if (Number.isNaN(p.getTime())) continue
    p.setHours(0, 0, 0, 0)
    const idx = buckets.findIndex((b) => b.date.getTime() === p.getTime())
    if (idx >= 0) buckets[idx].count++
  }
  const maxCount = Math.max(1, ...buckets.map((b) => b.count))
  const soldInWindow = buckets.reduce((s, b) => s + b.count, 0)

  // --- Recent activity ---
  const recent = [...liveTickets]
    .filter((t) => t.purchased_at)
    .sort((a, b) => new Date(b.purchased_at).getTime() - new Date(a.purchased_at).getTime())
    .slice(0, 6)

  // --- Setup checklist (only surface what's incomplete) ---
  const setup = [
    { id: 'banner', label: 'Add a cover flyer', done: !!event.banner_image_url, href: `/organizer/events/${event.id}/edit#banner` },
    { id: 'tiers', label: 'Set up ticket tiers', done: tiers.length > 0, href: `/organizer/events/${event.id}/edit#tickets` },
    { id: 'venue', label: 'Add venue details', done: !!(event.venue_name || event.is_online), href: `/organizer/events/${event.id}/edit#venue` },
    { id: 'desc', label: 'Write a full description', done: !!(event.description && event.description.length > 100), href: `/organizer/events/${event.id}/edit#description` },
  ]
  const incomplete = setup.filter((s) => !s.done)

  const kpis = [
    {
      label: 'Gross revenue',
      value: formatMoneyFromCents(Number(stats?.revenueCents || 0), currency),
      icon: DollarSign,
    },
    { label: 'Tickets sold', value: sold.toLocaleString(), sub: capacity > 0 ? `of ${capacity.toLocaleString()}` : 'no cap', icon: Ticket },
    { label: 'Checked in', value: checkedIn.toLocaleString(), /* '–', not ', ' — see OrganizerEventCard: the em-dash cleanup pass
       replaced standalone placeholder dashes with a comma-space. */
      sub: sold > 0 ? `${Math.round((checkedIn / sold) * 100)}%` : '\u2013', icon: CheckCircle2 },
    { label: 'Capacity sold', value: `${pctSold}%`, icon: TrendingUp },
  ]

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-5 pb-24 md:pb-10">
      {/* Setup banner — only when something's missing */}
      {incomplete.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-500/[0.09] px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
            <span className="font-medium text-white">{tx('command_center.finish_setup')}</span>
            <span className="text-white/40">·</span>
            {incomplete.map((s, i) => (
              <span key={s.id} className="flex items-center gap-1.5 text-white/55">
                <span className="h-1 w-1 rounded-full bg-amber-400" />
                <Link href={s.href} className="hover:text-white">{s.label}</Link>
                {i < incomplete.length - 1 && <span className="ml-1 text-white/20">·</span>}
              </span>
            ))}
          </div>
          <Link
            href={`/organizer/events/${event.id}/edit`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-300 hover:text-brand-200"
          >
            {tx('actions.continue')}<ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* KPI strip — single compact divided row */}
      <div className="grid grid-cols-2 divide-x divide-y divide-white/10 overflow-hidden rounded-lg bg-white/[0.03] sm:grid-cols-4 sm:divide-y-0">
        {kpis.map((k) => (
          <div key={k.label} className="px-4 py-3">
            <p className="label-mono truncate uppercase text-[11px] text-white/70">{k.label}</p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold font-mono tabular-nums text-white">{k.value}</span>
              {k.sub && <span className="text-xs font-mono tabular-nums text-white/70">{k.sub}</span>}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* ===== Main column ===== */}
        <div className="min-w-0 space-y-4">
          {/* Sales trend */}
          <section className="rounded-lg bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-[16px] lowercase italic leading-none text-white">
                {tx('actions.sales')}<span className="ml-1 font-normal font-mono tabular-nums text-white/40">· {soldInWindow} in {TREND_DAYS}d</span>
              </h3>
              <Link href={`/organizer/events/${event.id}/analytics`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200">
                {tx('actions.analytics')}<ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
            {soldInWindow > 0 ? (
              <div
                role="img"
                aria-label={`Daily ticket sales over the last ${TREND_DAYS} days: ${soldInWindow} sold total. ${buckets
                  .map((b) => `${format(b.date, 'MMM d')}: ${b.count}`)
                  .join(', ')}.`}
                className="flex h-20 items-end gap-1"
              >
                {buckets.map((b, i) => (
                  <div
                    key={i}
                    aria-hidden="true"
                    className="flex-1 rounded-t bg-white/70 transition-colors hover:bg-white"
                    style={{ height: `${Math.max(3, (b.count / maxCount) * 100)}%` }}
                    title={`${format(b.date, 'MMM d')}: ${b.count}`}
                  />
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-white/35">{tx('command_center.no_sales_in_window')}</p>
            )}
          </section>

          {/* Ticket tiers */}
          <section className="rounded-lg bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-[16px] lowercase italic leading-none text-white">{tx('command_center.ticket_types')}</h3>
              <Link href={`/organizer/events/${event.id}/tickets`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200">
                {tx('actions.manage')}<ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
            {tiers.length > 0 ? (
              <div className="space-y-2.5">
                {tiers.map((tier: any) => {
                  const qty = Number(tier.quantity || 0)
                  const tsold = Number(tier.sold || 0)
                  const pct = qty > 0 ? Math.min(100, Math.round((tsold / qty) * 100)) : 0
                  return (
                    <div key={tier.id} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 truncate text-sm text-white">{tier.name || 'Ticket'}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="shrink-0 text-xs font-mono tabular-nums text-white/50">
                        {tsold}{qty > 0 ? `/${qty}` : ''} · {Number(tier.price) > 0 ? formatMoneyFromCents(Math.round(Number(tier.price) * 100), currency) : 'Free'}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="py-4 text-sm text-white/45">
                No ticket types yet.{' '}
                <Link href={`/organizer/events/${event.id}/edit#tickets`} className="font-semibold text-brand-300 hover:text-brand-200">{tx('command_center.add_one')}</Link>
              </p>
            )}
          </section>

          {/* Recent activity */}
          <section className="rounded-lg bg-white/[0.03] p-4">
            <h3 className="mb-2 font-display text-[16px] lowercase italic leading-none text-white">{tx('command_center.recent_activity')}</h3>
            {recent.length > 0 ? (
              <ul className="divide-y divide-white/5">
                {recent.map((t: any) => {
                  const cents = Math.round((Number(t.price_paid || 0) || 0) * 100)
                  const cur = normalizeCurrency(t.currency, currency)
                  const when = t.purchased_at ? new Date(t.purchased_at) : null
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="flex items-center gap-2 text-white/80">
                        <Ticket className="h-3.5 w-3.5 shrink-0 text-brand-300" />
                        Ticket sold · {cents > 0 ? formatMoneyFromCents(cents, cur) : 'Free'}
                      </span>
                      {when && !Number.isNaN(when.getTime()) && (
                        <span className="shrink-0 text-xs font-mono tabular-nums text-white/35">{formatDistanceToNow(when, { addSuffix: true })}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="py-4 text-sm text-white/45">{tx('command_center.no_sales_share')}</p>
            )}
          </section>
        </div>

        {/* ===== Right rail — event details ===== */}
        <aside className="space-y-4 lg:sticky lg:top-[132px] lg:self-start">
          {event.banner_image_url ? (
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-none">
              <Image src={event.banner_image_url} alt={event.title} fill sizes="300px" className="object-cover" />
            </div>
          ) : (
            <Link
              href={`/organizer/events/${event.id}/edit#banner`}
              className="flex aspect-[4/5] w-full flex-col items-center justify-center rounded-lg bg-white/[0.055] text-center text-white/45 transition-colors hover:bg-white/[0.09] hover:text-white/70"
            >
              <ImageIcon className="mb-2 h-8 w-8" />
              <span className="text-sm font-medium">{tx('command_center.add_a_flyer')}</span>
              <span className="mt-0.5 text-xs text-white/35">{tx('command_center.portrait_ratio')}</span>
            </Link>
          )}
          <div className="space-y-2.5 text-sm">
            <div className="flex items-start gap-2.5">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
              <span className="font-mono tabular-nums text-white/75">
                {(() => {
                  const d = new Date(event.start_datetime)
                  return isValid(d) ? format(d, 'EEE, MMM d, yyyy · h:mm a') : 'Date to be announced'
                })()}
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              {event.is_online ? (
                <Globe className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
              ) : (
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
              )}
              <span className="text-white/75">
                {event.is_online ? 'Online event' : event.venue_name || event.city || 'Location TBD'}
              </span>
            </div>
          </div>
          <Link
            href={`/organizer/events/${event.id}/edit`}
            className="flex h-11 w-full items-center justify-center rounded-[10px] bg-white/[0.08] text-center text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.14] hover:text-white"
          >
            {tx('command_center.edit_event')}
          </Link>

          {event.description && (
            <div className="border-t border-white/10 pt-3">
              <h4 className="label-mono mb-1.5 uppercase text-xs text-white/40">{tx('actions.about')}</h4>
              <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-relaxed text-white/55">
                {event.description}
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
