'use client'

/**
 * The mobile detail sections — flat, all open, hairline-divided.
 *
 * These were accordions, every one of them shut except "About". That cost more
 * than it saved: the venue map, the end time and the organizer were all one tap
 * away from existing at all, and on a page whose whole job is to convince
 * someone to buy, the information that convinces them was hidden behind chrome.
 * It also meant the static map "stopped working" — it was simply inside a
 * collapsed row. The mobile app never did this: it lays the same material out
 * as flat sections with a serif heading and a hairline above, and you scroll.
 * This is that, so the two read as the same product (owner ask, 2026-09-03).
 *
 * Headings follow the house convention — Instrument Serif, lowercased, matching
 * mobile/components/SectionHeader — not the bold sans this file used before.
 */

import { useTranslation } from 'react-i18next'
import { formatInZone } from '@/lib/home/format'
import { dayKey } from '@/lib/home/feed'
import Badge from '@/components/ui/Badge'
import PromoVideo from '@/components/events/PromoVideo'
import { dateLocaleFor } from '@/lib/dateLocale'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-6">
      <h2 className="mb-3 font-display lowercase italic !text-[22px] !leading-none text-white">
        {title}
      </h2>
      {children}
    </section>
  )
}

interface MobileSectionsProps {
  description: string
  /** Organizer's promo video link, if any. */
  videoUrl?: string
  tags?: string[]
  venueName: string
  address: string
  commune: string
  city: string
  startDatetime: string
  endDatetime: string
  /** The event's IANA zone (lib/home/feed eventZone): times print in it. */
  zone: string
  organizerName: string
  organizerId: string
  isVerified: boolean
  shareButton: React.ReactNode
  /**
   * The venue map tile, passed in already-built — the same `shareButton`
   * convention this component already uses for composed children. Kept as a
   * node (rather than widening the props with the raw event doc) so this
   * component stays a list of flat scalars, and so the tile's link is
   * constructed once, next to the desktop one it must match.
   */
  venueMap?: React.ReactNode
}

export default function MobileSections({
  description,
  videoUrl,
  tags,
  venueName,
  address,
  commune,
  city,
  startDatetime,
  endDatetime,
  zone,
  organizerName,
  organizerId,
  isVerified,
  shareButton,
  venueMap
}: MobileSectionsProps) {
  const { t, i18n } = useTranslation('common')
  const dfLocale = dateLocaleFor(i18n.language)

  const mapsQuery = encodeURIComponent(address || `${venueName}, ${commune}, ${city}`)

  // An end that equals the start is the page's own fallback for "not set", so
  // it is not an end. Both are compared as instants, not strings.
  const startMs = new Date(startDatetime).getTime()
  const endMs = new Date(endDatetime).getTime()
  const hasEnd = Number.isFinite(endMs) && endMs > startMs
  const sameDay = hasEnd && dayKey(startDatetime, zone) === dayKey(endDatetime, zone)

  // Dividers between sections, softened, and no rule at the bottom. Four
  // `white/10` hairlines down a phone screen plus the container's own closing
  // border read as stripes; at `/[0.06]` they mark structure without becoming
  // the structure, and nothing needs closing at the end — the lineup and the
  // song follow immediately.
  return (
    <div className="divide-y divide-white/[0.06] px-4 md:hidden">
      {/* About */}
      <Section title={t('events.about_event')}>
        {description && description.trim() ? (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-white/70">{description}</p>
        ) : (
          <p className="text-[15px] italic leading-relaxed text-white/40">
            {t('events.no_description', { defaultValue: 'The organizer hasn’t added a description yet.' })}
          </p>
        )}
        {/* Under the description, exactly where the app puts it. */}
        <PromoVideo url={videoUrl} className="mt-4" />
        {tags && tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {tags.map((tag: string) => (
              <Badge key={tag} variant="neutral" size="sm">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </Section>

      {/* Date & Time — before the venue: "when" is what a reader asks first,
          and the app orders it the same way.

          Rewritten because the old shape read as "START Friday, August 28,
          2026 · 2:00 PM" — an all-caps label butted against the date with a
          single space, which is what the owner meant by the start displaying
          "kinda weird". The date now leads on its own line and the time sits
          under it as a RANGE, which is how anyone reads an event listing.

          The end is genuinely absent on most events (25 of 27 in production
          carry no end_datetime at all), so the range collapses to a single
          time rather than printing a fake one. */}
      <Section title={t('events.date_time')}>
        {/* Printed in the event's zone: a runtime-zone format rendered UTC on
            the server and the reader's zone in the browser (React #418). */}
        <div>
          <p className="text-[17px] font-medium leading-snug text-white">
            {formatInZone(startDatetime, zone, 'EEEE, MMMM d, yyyy', { locale: dfLocale })}
          </p>
          <p className="mt-1 text-[15px] text-white/70">
            {formatInZone(startDatetime, zone, 'h:mm a', { locale: dfLocale })}
            {hasEnd && (
              <>
                {' – '}
                {/* Same day: the time alone. A different day needs its date,
                    or "2:00 PM – 2:00 AM" silently loses the overnight. */}
                {sameDay
                  ? formatInZone(endDatetime, zone, 'h:mm a', { locale: dfLocale })
                  : formatInZone(endDatetime, zone, 'EEE, MMM d · h:mm a', { locale: dfLocale })}
              </>
            )}
          </p>
        </div>
      </Section>

      {/* Venue */}
      <Section title={t('events.venue_directions')}>
        <p className="text-[15px] font-medium text-white">{venueName}</p>
        {address && <p className="mt-1 break-words text-[15px] text-white/60">{address}</p>}
        <p className="text-[15px] text-white/60">
          {[commune, city].filter(Boolean).join(', ')}
        </p>
        {/* Same placement idea as desktop: address, then the tile, then the two
            map links. Rendered bare (no wrapper div) because the tile returns
            null with no provider key configured, a wrapper would leave its
            margin behind as unexplained blank space inside the section. */}
        {venueMap}
        <p className="mt-3 text-[15px]">
          <a
            href={`https://maps.apple.com/?q=${mapsQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-400 hover:text-brand-300"
          >
            {t('events.apple_maps')}
          </a>
          <span className="text-white/25"> · </span>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-400 hover:text-brand-300"
          >
            {t('events.google_maps')}
          </a>
        </p>
      </Section>

      {/* Organizer */}
      <Section title={t('events.organizer')}>
        <a
          href={`/profile/organizer/${organizerId}`}
          className="flex items-center gap-3 transition-opacity hover:opacity-80"
        >
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-base font-semibold text-white">
            {organizerName[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium text-white">{organizerName}</p>
            {isVerified && (
              <p className="mt-0.5 text-sm text-brand-400">{t('events.verified_organizer')}</p>
            )}
          </div>
        </a>
      </Section>

      {/* Share */}
      <Section title={t('events.share_event')}>{shareButton}</Section>
    </div>
  )
}
