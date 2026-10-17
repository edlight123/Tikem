'use client'

/**
 * The attendee's ticket(s) for ONE event — /tickets/event/[eventId].
 *
 * The whole page exists to get a QR under a scanner at a venue door, often in
 * bad light, so the hierarchy is deliberately lopsided: poster → title → the
 * facts you need on the way there → then one big inverted WHITE stub per live
 * ticket with the QR as the largest object on the screen. Everything else
 * (calendar, directions, wallet, transfer, used tickets) is demoted below it.
 *
 * Surfaces follow docs/POSH_DESIGN_BRIEF.md — a card gets a FILL, never a
 * hairline around empty space. The only borders here are real dividers (the
 * rule between two facts, the dashed tear-line on the stub) and the sanctioned
 * dashed edge of the empty state.
 */

import { EMPTY_VALUE } from '@/lib/format'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format, isValid } from 'date-fns'
import Image from 'next/image'
import QRCodeDisplay from '@/app/tickets/[id]/QRCodeDisplay'
import AddToWalletButton from '@/components/AddToWalletButton'
import { isDemoMode } from '@/lib/demo'
import { isLiveTicketStatus } from '@/lib/tickets/status'
import { getPosterTheme } from '@/lib/posterGradient'
import { EditorialHeader } from '@/components/ui/EditorialHeader'
import { SectionHeader } from '@/components/ui/EditorialRails'
import { EmptyState, StatusChip } from '@/components/ui/kit'
import { TikemWordmark } from '@/components/ui/TikemLogo'
import {
  CalendarDays,
  MapPin,
  Ticket as TicketIcon,
  CheckCircle2,
  Share2,
  ChevronRight,
  ChevronDown,
  ArrowRight,
  CalendarPlus,
  Navigation,
  User as UserIcon,
} from 'lucide-react'

interface EventTicketsContentProps {
  event: any
  tickets: any[]
}

const FALLBACK = EMPTY_VALUE

/** date-fns `format` throws on invalid dates; always guard through this. */
function safeFormat(value: any, fmt: string, fallback: string = FALLBACK): string {
  if (!value) return fallback
  const d = new Date(value)
  return isValid(d) ? format(d, fmt) : fallback
}

/** Compact UTC stamp for Google Calendar, e.g. 20260815T210000Z. Null if invalid. */
function toCalendarStamp(value: any): string | null {
  if (!value) return null
  const d = new Date(value)
  if (!isValid(d)) return null
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

/** Short human reference derived from the ticket doc id (not the raw id). */
function shortReference(id: any): string {
  const raw = String(id || '')
  if (!raw) return FALLBACK
  return raw.slice(-6).toUpperCase()
}

/** Secondary action in the dark stack: a fill that lifts on hover, no border. */
const STACK_ACTION =
  'flex items-center justify-center gap-2 w-full rounded-xl bg-white/[0.055] px-4 py-3 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.12] hover:text-white'

export default function EventTicketsContent({ event, tickets }: EventTicketsContentProps) {
  const { t } = useTranslation('tickets')
  const [showUsed, setShowUsed] = useState(false)

  const cleanTitle = String(event.title || 'Event').replace(/^\[[^\]]*\]\s*/, '')

  /**
   * A LIVE ticket is `valid` | `confirmed` | `active` (or an older doc with no
   * status at all) — see lib/tickets/status.ts. This filter used to read
   * `status === 'valid'`, which is the exact subset bug that documentation
   * exists to stop: every MonCash / SogePay / free-claim ticket is written
   * `confirmed`, so it showed in neither list and the buyer's QR vanished.
   */
  const liveTickets = tickets.filter((tk) => tk && !tk.checked_in_at && isLiveTicketStatus(tk.status))
  const usedTickets = tickets.filter((tk) => tk && tk.checked_in_at)

  const locationParts = [event.venue_name, event.commune, event.city].filter(Boolean)
  const locationQuery = String(event.address || locationParts.join(', ') || '').trim()
  const directionsUrl = locationQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationQuery)}`
    : null

  // Build a Google Calendar link from the event date/title/venue (guarded).
  const calendarStart = toCalendarStamp(event.start_datetime)
  let calendarUrl: string | null = null
  if (calendarStart) {
    const startDate = new Date(event.start_datetime)
    // Fall back to a 2h duration when no end time is available.
    const calendarEnd =
      toCalendarStamp(event.end_datetime) ||
      toCalendarStamp(new Date(startDate.getTime() + 2 * 60 * 60 * 1000).toISOString())
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: cleanTitle,
      dates: `${calendarStart}/${calendarEnd}`,
      details: t('event_tickets.ready'),
    })
    if (locationQuery) params.set('location', locationQuery)
    calendarUrl = `https://calendar.google.com/calendar/render?${params.toString()}`
  }

  const poster = getPosterTheme(event.id || cleanTitle, event.category)
  const dateLine = event.start_datetime
    ? `${safeFormat(event.start_datetime, 'EEE, MMM d, yyyy', t('event_tickets.date_tba'))} · ${
        event.end_datetime
          ? `${safeFormat(event.start_datetime, 'h:mm a')} – ${safeFormat(event.end_datetime, 'h:mm a')}`
          : safeFormat(event.start_datetime, 'h:mm a')
      }`
    : t('event_tickets.date_tba')

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      {/* ── The flyer, in the house 4:5 portrait shape.
             This was a full-width `aspect-[16/9] sm:aspect-[21/9]` band, and
             Tikèm posters are 4:5 — so object-cover cropped every flyer to a
             horizontal strip through its middle, losing the title and the
             composition. Same defect the event page hero had.
             It is also deliberately SMALL. On this page the QR is the object
             that matters (it is read at a venue door, in bad light), and a
             full-bleed poster pushed it below the fold. ~200px gives the event
             enough presence to confirm you are looking at the right ticket
             without competing with the thing you came for.
             `rounded`, matching components/ui/PosterCard — the radius every
             other poster in the app uses. */}
      <div className="mx-auto w-[min(200px,52vw)] sm:w-[220px]">
        <div className="relative aspect-[4/5] overflow-hidden rounded bg-white/[0.04]">
          {event.banner_image_url ? (
            <Image
              src={event.banner_image_url}
              alt={cleanTitle}
              fill
              sizes="220px"
              className="object-cover"
              priority
            />
          ) : (
            /* No flyer: the generated poster template. The one sanctioned large
               use of teal — here teal IS the poster art, not chrome. */
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ backgroundImage: poster.bg }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
              <TikemWordmark className="relative text-[clamp(28px,9vw,40px)] text-white/85" />
            </div>
          )}
        </div>
      </div>

      {/* Title block. Shared editorial header, so this page speaks the same
          voice as /tickets and the organizer surfaces. */}
      <EditorialHeader
        tone="dark"
        eyebrow={
          tickets.length > 1
            ? t('event_tickets.tickets_count_plural', { count: tickets.length })
            : t('event_tickets.tickets_count', { count: tickets.length })
        }
        title={cleanTitle}
        subtitle={liveTickets.length > 0 ? t('event_tickets.ready') : undefined}
        className="mt-5"
      />

      {/* ── The two facts you need on the way to the door. One filled card,
             split by a real rule (a divider is the one honest hairline). */}
      <div className="mt-5 grid grid-cols-1 divide-y divide-white/[0.07] overflow-hidden rounded-2xl bg-white/[0.03] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="flex items-start gap-3 p-4 sm:p-5">
          <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-white/35" />
          <div className="min-w-0">
            <div className="eyebrow text-white/40">{t('event_tickets.date_time')}</div>
            <div className="label-mono mt-1.5 text-[13.5px] leading-snug text-white">
              {event.start_datetime
                ? safeFormat(event.start_datetime, 'EEE, MMM d, yyyy', t('event_tickets.date_tba'))
                : t('event_tickets.date_tba')}
            </div>
            <div className="label-mono mt-0.5 text-[12px] text-white/50">
              {event.start_datetime
                ? event.end_datetime
                  ? `${safeFormat(event.start_datetime, 'h:mm a')} – ${safeFormat(event.end_datetime, 'h:mm a')}`
                  : safeFormat(event.start_datetime, 'h:mm a')
                : t('event_tickets.time_tba')}
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3 p-4 sm:p-5">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-white/35" />
          <div className="min-w-0">
            <div className="eyebrow text-white/40">{t('event_tickets.venue')}</div>
            <div className="label-mono mt-1.5 truncate text-[13.5px] leading-snug text-white">
              {String(event.venue_name || t('event_tickets.venue_tba'))}
            </div>
            <div className="label-mono mt-0.5 truncate text-[12px] text-white/50">
              {String(event.commune || t('event_tickets.location_tba'))},{' '}
              {String(event.city || t('event_tickets.location_tba'))}
            </div>
          </div>
        </div>
      </div>

      {/* ── The hero: one inverted white stub per live ticket. */}
      {liveTickets.length > 0 ? (
        <section className="mt-9">
          <SectionHeader
            eyebrow={t('event_tickets.ready_badge', { count: liveTickets.length })}
            title={t('event_tickets.active_tickets')}
          />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {liveTickets.map((ticket, index) => {
              const qrValue = ticket.qr_code_data || ticket.id
              const qrId = `ticket-qr-${ticket.id || index}`
              const tierName = ticket.tier_name || t('event_tickets.ticket')
              const holderName = ticket.attendee_name
              return (
                <div
                  key={ticket.id || index}
                  className="overflow-hidden rounded-2xl bg-white/[0.03] shadow-xl"
                >
                  {/* The physical object, pulled out of the black app. White is
                      not decoration here — it is what makes the QR read under a
                      bad venue-door light. */}
                  <div className="bg-white p-4 text-black sm:p-6">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="label-mono text-[10px] uppercase tracking-wide text-black/45">
                          {t('event_tickets.ticket_number', { number: index + 1 })}
                        </div>
                        {/* `!` beats `.mobile-typography h3` (element+class, 0,1,1),
                            which would otherwise crush this to 16px on a phone. */}
                        <h3 className="mt-0.5 font-display italic !text-[clamp(22px,6vw,28px)] !leading-[1.02] text-black [overflow-wrap:anywhere]">
                          {cleanTitle}
                        </h3>
                        <div className="label-mono mt-1 text-[11.5px] text-black/55">{dateLine}</div>
                      </div>
                      <span className="shrink-0 rounded-full bg-black/[0.07] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-black/70">
                        {tierName}
                      </span>
                    </div>

                    {/* QR — the largest object on the page, on white, centred. */}
                    <div className="flex flex-col items-center">
                      {qrValue ? (
                        <QRCodeDisplay
                          value={qrValue}
                          size={320}
                          id={qrId}
                          className="mx-auto w-full max-w-[320px]"
                        />
                      ) : (
                        <div className="mx-auto flex aspect-square w-full max-w-[320px] items-center justify-center rounded-xl bg-black/[0.06]">
                          <span className="text-sm text-black/50">
                            {t('event_tickets.qr_unavailable')}
                          </span>
                        </div>
                      )}
                      <div className="mt-3 text-center text-[11px] font-medium uppercase tracking-[0.13em] text-black/45">
                        {t('event_tickets.scan_at_entrance')}
                      </div>
                    </div>

                    {/* Tear-line, then the small print. A dashed rule IS the
                        meaning here — it is where a paper stub would come apart. */}
                    <div className="mt-5 space-y-2 border-t border-dashed border-black/15 pt-4">
                      {holderName && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.13em] text-black/45">
                            <UserIcon className="h-3.5 w-3.5" />
                            {t('event_tickets.holder')}
                          </span>
                          <span className="truncate text-sm font-semibold text-black">
                            {holderName}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[10px] font-medium uppercase tracking-[0.13em] text-black/45">
                          {t('event_tickets.reference')}
                        </span>
                        <span className="font-mono text-sm font-semibold tracking-wider text-black">
                          {shortReference(ticket.id)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Dark utility stack — everything you might want once the QR
                      is safe. Fills only; nothing here outshouts the stub. */}
                  <div className="space-y-2 p-3 sm:p-4">
                    {calendarUrl && (
                      <a
                        href={calendarUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={STACK_ACTION}
                      >
                        <CalendarPlus className="h-4 w-4" />
                        {t('event_tickets.add_to_calendar')}
                      </a>
                    )}
                    {directionsUrl && (
                      <a
                        href={directionsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={STACK_ACTION}
                      >
                        <Navigation className="h-4 w-4" />
                        {t('event_tickets.get_directions')}
                      </a>
                    )}
                    {!isDemoMode() && (
                      <>
                        <AddToWalletButton ticket={ticket} event={event} qrElementId={qrId} />
                        <a href={`/tickets/${ticket.id}`} className={`group/btn ${STACK_ACTION}`}>
                          <Share2 className="h-4 w-4" />
                          {t('event_tickets.transfer_ticket')}
                          <ChevronRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
                        </a>
                      </>
                    )}
                    <div className="label-mono pt-1 text-center text-[10px] uppercase text-white/40">
                      {ticket.purchased_at
                        ? t('event_tickets.purchased_at', {
                            date: safeFormat(ticket.purchased_at, 'MMM d, yyyy'),
                          })
                        : t('event_tickets.ticket')}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : (
        /* Every ticket for this event is already through the door (or otherwise
           no longer live). Say so instead of leaving a hole where the QR was.
           A dashed edge is legitimate here: the space really is empty. */
        <EmptyState
          className="mt-9"
          icon={TicketIcon}
          title={t('event_tickets.no_active_tickets')}
        />
      )}

      {/* ── Used tickets: demoted, collapsed, no large QR. */}
      {usedTickets.length > 0 && (
        <section className="mt-8">
          <button
            type="button"
            onClick={() => setShowUsed((v) => !v)}
            aria-expanded={showUsed}
            className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white/[0.03] px-4 py-3.5 text-left transition-colors hover:bg-white/[0.08]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-white/35" />
              <span className="truncate text-sm font-semibold text-white sm:text-[15px]">
                {t('event_tickets.used_tickets')}
              </span>
              <span className="shrink-0 text-sm text-white/45">
                {t('event_tickets.used_count', { count: usedTickets.length })}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.13em] text-white/50">
              {showUsed ? t('event_tickets.hide') : t('event_tickets.show')}
              <ChevronDown
                className={`h-4 w-4 transition-transform ${showUsed ? 'rotate-180' : ''}`}
              />
            </span>
          </button>

          {showUsed && (
            <ul className="mt-2 divide-y divide-white/[0.06] overflow-hidden rounded-2xl bg-white/[0.03]">
              {usedTickets.map((ticket, index) => (
                <li
                  key={ticket.id || index}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white/80">
                      {ticket.tier_name || t('event_tickets.ticket')}
                    </div>
                    <div className="label-mono mt-0.5 text-[11px] text-white/45">
                      {ticket.checked_in_at
                        ? safeFormat(ticket.checked_in_at, 'MMM d, yyyy • h:mm a')
                        : t('event_tickets.used')}
                    </div>
                  </div>
                  {/* Dot + label. A status reports; it is not a pill to press. */}
                  <StatusChip tone="neutral" className="shrink-0">
                    {t('event_tickets.used')}
                  </StatusChip>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── One primary action per screen: the white pill. */}
      <div className="mt-8 flex flex-col gap-2.5 sm:flex-row-reverse">
        <a
          href="/tickets"
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-bold text-black transition-colors hover:bg-white/90"
        >
          <TicketIcon className="h-4 w-4" />
          {t('event_tickets.all_my_tickets')}
        </a>
        <a
          href={`/events/${event.id}`}
          className="group/link flex flex-1 items-center justify-center gap-2 rounded-full bg-white/[0.055] px-6 py-3.5 text-sm font-semibold text-white/75 transition-colors hover:bg-white/[0.12] hover:text-white"
        >
          {t('event_tickets.view_event_details')}
          <ArrowRight className="h-4 w-4 transition-transform group-hover/link:translate-x-0.5" />
        </a>
      </div>
    </div>
  )
}
