'use client'

// The mobile key facts: four quiet lines, no icon tiles, no boxes (owner call,
// 2026-08-29: "heavy boxes and icons"). Hierarchy is typographic — the date
// leads, the price is teal because price is semantic, everything else recedes.
//
// Every t() carries a defaultValue — a missing key once rendered raw
// ("open_in_maps →") on the page organizers share the most.

import { useTranslation } from 'react-i18next'
import { dateLocaleFor, intlLocaleFor } from '@/lib/dateLocale'
import { formatInZone } from '@/lib/home/format'
import { dayKey } from '@/lib/home/feed'
import { scarcityCopy, isUrgent, type Scarcity } from '@/lib/ticketScarcity'

interface MobileKeyFactsProps {
  startDate: string
  /** End instant, if any; equal-to-start or missing prints the start alone. */
  endDate?: string
  /** The event's IANA zone (lib/home/feed eventZone): times print in it. */
  zone: string
  venueName: string
  city: string
  address: string
  commune: string
  isFree: boolean
  /**
   * True for a 'mixed' event (free AND paid tiers side by side). `ticketPrice` is
   * then the cheapest PAID tier and the price reads as a "Free – X" range, so we
   * never advertise "0" for an event that actually charges.
   */
  hasFreeOption?: boolean
  /**
   * The ALL-IN per-ticket price. In a buyer-pays market (US/CA/FR) the caller has
   * already added the fee, so this is what the buyer is charged rather than the face
   * value — `feesIncluded` says so on the card.
   */
  ticketPrice: number
  feesIncluded?: boolean
  currency: string
  remainingTickets: number
  isSoldOut: boolean
  /**
   * Computed once by the page and passed down, so this line, the hero badge
   * and the checkout selector cannot disagree. See lib/ticketScarcity.
   */
  scarcity?: Scarcity
}

export default function MobileKeyFacts({
  startDate,
  endDate,
  zone,
  venueName,
  city,
  address,
  commune,
  isFree,
  hasFreeOption = false,
  ticketPrice,
  feesIncluded = false,
  currency,
  remainingTickets,
  isSoldOut,
  scarcity
}: MobileKeyFactsProps) {
  const { t, i18n } = useTranslation('common')
  const dfLocale = dateLocaleFor(i18n.language)

  // The end time lives here now (the mobile "date & time" section that held
  // it repeated this line). Same day: the time alone; another day: its date,
  // or "2:00 PM – 2:00 AM" silently loses the overnight.
  const startMs = new Date(startDate).getTime()
  const endMs = endDate ? new Date(endDate).getTime() : NaN
  const hasEnd = Number.isFinite(endMs) && endMs > startMs
  const endLabel = !hasEnd
    ? ''
    : dayKey(startDate, zone) === dayKey(endDate!, zone)
      ? formatInZone(endDate!, zone, 'h:mm a', { locale: dfLocale })
      : formatInZone(endDate!, zone, 'EEE, MMM d · h:mm a', { locale: dfLocale })

  // The place, once: venue and town. Directions and the map live in the venue
  // section just below, so the "Open in Maps" link here was a second copy.
  // The neighbourhood people say ("Pétion-Ville") before the city, and never
  // a repeat of what the venue name already says (same as the app).
  const area = (commune && commune.trim()) || city
  const place = [venueName, venueName && area && venueName.includes(area) ? '' : area]
    .filter((p) => p && p.trim())
    .join(' · ')

  const priceLine = isFree
    ? t('common.free')
    : `${hasFreeOption ? `${t('common.free')}, ` : ''}${ticketPrice.toLocaleString(intlLocaleFor(i18n.language))} ${currency}`

  return (
    <div className="md:hidden px-4 pt-2">
      {/* Printed in the event's zone, so the server and the browser agree. */}
      <p className="text-[15px] text-white/60">
        {formatInZone(startDate, zone, 'EEE, MMM d, yyyy · h:mm a', { locale: dfLocale })}
        {endLabel && ` – ${endLabel}`}
      </p>

      {place && <p className="mt-0.5 text-[15px] text-white/60">{place}</p>}

      {/* A free event's button already says so; "Free" here was a repeat. */}
      {!isFree && (
      <p className="mt-3 text-[15px] font-semibold text-white">
        {priceLine}
        <span className="ml-1.5 text-[13px] font-normal text-white/45">
          {feesIncluded
            ? t('events.fees_included', { defaultValue: 'Fees included' })
            : t('events.per_ticket', { defaultValue: 'per ticket' })}
        </span>
      </p>
      )}

      {/* Scarcity, not inventory. This printed "{{count}} remaining" on every
          event — "500 remaining" is an advert for the empty room, which is the
          exact thing the owner asked to stop showing at checkout. It also held
          a FOURTH copy of the `< 10` rule. Both now come from the shared
          ladder, and an event with plenty of tickets prints nothing here. */}
      {(() => {
        const s = scarcity ?? { level: isSoldOut ? 'soldOut' : 'none' }
        const copy = scarcityCopy(s)
        if (!copy) return null
        return (
          <p className={`mt-1 text-[13px] font-medium ${isUrgent(s) ? 'text-amber-300' : 'text-red-400'}`}>
            {t(copy.key, { defaultValue: copy.defaultValue, count: copy.count })}
          </p>
        )
      })()}
    </div>
  )
}
