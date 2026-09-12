'use client'

import Link from 'next/link'
import Image from 'next/image'
import { format } from 'date-fns'
import { AlertCircle, Calendar, ChevronRight, MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatMoneyFromCents, formatPrimaryMoneyFromCentsByCurrency, normalizeCurrency } from '@/lib/money'
import { StatusChip } from '@/components/ui/kit'
import { getPosterTheme } from '@/lib/posterGradient'

interface EventData {
  id: string
  title: string
  start_datetime: string
  city: string
  commune?: string
  category: string
  is_published: boolean
  banner_image_url?: string
  tickets_sold?: number
  total_tickets?: number
  revenue?: number
  revenueByCurrencyCents?: Record<string, number>
  currency?: string
  checked_in?: number
  ticket_tiers?: any[]
  location_name?: string
  join_url?: string
  /** Set by the Connect health sweep when this live event can no longer take money. */
  payout_blocked?: boolean
  payout_blocked_reason?: string
}

interface OrganizerEventCardProps {
  event: EventData
  showNeedsAttention?: boolean
  // Kept for API compatibility; row-level actions now live on the event page.
  onDuplicate?: (eventId: string) => void
  onDelete?: (eventId: string) => void
}

/**
 * A single, scannable event row. The whole row links through to the event's
 * management page, where every detail and action lives — so the list itself
 * stays calm and clutter-free (Posh-style).
 */
/** Stands in for a value we genuinely do not have. */
const NO_VALUE = '\u2013'

export default function OrganizerEventCard({ event, showNeedsAttention = true }: OrganizerEventCardProps) {
  const { t } = useTranslation('organizer')

  const ticketsSold = event.tickets_sold || 0
  const totalTickets = event.total_tickets || 0
  const isSoldOut = ticketsSold >= totalTickets && totalTickets > 0

  const revenueText = (() => {
    const breakdown = event.revenueByCurrencyCents || {}
    const nonZero = Object.entries(breakdown).filter(([, cents]) => (cents || 0) !== 0)
    if (nonZero.length >= 1) {
      return formatPrimaryMoneyFromCentsByCurrency(breakdown, event.currency, 'en-US', { currencyDisplay: 'code' })
    }
    const major = typeof event.revenue === 'number' ? event.revenue : Number(event.revenue || 0)
    // '–' (en dash), not ', '. These placeholders were em dashes until the
    // "remove the em dashes so it doesn't read as AI-generated" pass swapped
    // every '—' for ', ' — including the standalone ones that were not
    // punctuation at all, which left a stray comma-space in the UI. That pass
    // was about PROSE; a dash standing in for a missing value in a data cell
    // is a typographic convention, so an en dash restores the meaning without
    // bringing the em dash back.
    if (!Number.isFinite(major) || major === 0) return NO_VALUE
    return formatMoneyFromCents(Math.round(major * 100), normalizeCurrency(event.currency, 'HTG'), 'en-US', { currencyDisplay: 'code' })
  })()

  const missingCover = !event.banner_image_url
  const missingTickets = Array.isArray(event.ticket_tiers) ? event.ticket_tiers.length === 0 : false
  const noSales = ticketsSold === 0 && event.is_published
  const needsAttention = showNeedsAttention && (missingCover || missingTickets || noSales)

  const hasImage = Boolean(event.banner_image_url)
  const theme = getPosterTheme(event.id || event.title, event.category)
  const dateValid = !Number.isNaN(new Date(event.start_datetime).getTime())

  return (
    <Link
      href={`/organizer/events/${event.id}`}
      // A row sitting on the page is a fill, not an outline: this was a
      // `border-white/10` box with no background, repeated down the list, which
      // is the wireframe look the house rule exists to stop.
      className="group flex items-center gap-4 rounded-2xl bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.07]"
    >
      {/* Poster thumbnail */}
      <div
        className="relative h-[72px] w-[58px] shrink-0 overflow-hidden rounded-none"
        style={hasImage ? undefined : { backgroundImage: theme.bg }}
      >
        {hasImage ? (
          <Image
            src={event.banner_image_url as string}
            alt={event.title}
            fill
            sizes="58px"
            className="object-cover"
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center font-display text-xl text-white/80">
            {(event.title || '?').trim().charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* Title + meta */}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <StatusChip tone={event.is_published ? 'success' : 'neutral'}>
            {event.is_published ? t('event_card_detail.published') : t('event_card_detail.draft')}
          </StatusChip>
          {isSoldOut && <StatusChip tone="danger">{t('event_card_detail.sold_out')}</StatusChip>}
          {/* A live event whose payout account can no longer accept a charge. The
              buyer would reach checkout and fail, so this outranks every other
              signal on the row — shown before "needs attention", never hidden
              behind a hover. */}
          {event.payout_blocked && (
            <StatusChip tone="danger" title={event.payout_blocked_reason || undefined}>
              {t('event_card_detail.payout_blocked', "Can't take payments")}
            </StatusChip>
          )}
          {needsAttention && (
            <span title={t('event_card_detail.needs_attention')} className="inline-flex items-center text-amber-300">
              <AlertCircle className="h-4 w-4" />
            </span>
          )}
        </div>

        <h3 className="truncate font-display text-[15px] italic text-white">{event.title}</h3>

        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12.5px] text-white/50">
          <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            {dateValid ? format(new Date(event.start_datetime), 'MMM d, yyyy · h:mm a') : NO_VALUE}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{event.location_name || event.commune || event.city || NO_VALUE}</span>
          </span>
        </div>
      </div>

      {/* Compact stats */}
      <div className="hidden shrink-0 items-center gap-6 pr-1 sm:flex">
        <div className="text-right">
          <p className="text-sm font-semibold text-white font-mono tabular-nums">
            {ticketsSold}
            {totalTickets > 0 && <span className="text-white/40">/{totalTickets}</span>}
          </p>
          <p className="label-mono uppercase text-[11px] text-white/40">{t('event_card_detail.ticket_sales')}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-brand-300 font-mono tabular-nums">{revenueText}</p>
          <p className="label-mono uppercase text-[11px] text-white/40">{t('event_card_detail.revenue')}</p>
        </div>
      </div>

      <ChevronRight className="h-5 w-5 shrink-0 text-white/30 transition-colors group-hover:text-white/60" />
    </Link>
  )
}
