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
import { venueAddressLines } from '@/lib/events/venueLines'
import Badge from '@/components/ui/Badge'
import PromoVideo from '@/components/events/PromoVideo'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-6">
      <h2 className="mb-3 font-display lowercase italic !text-section !leading-none text-fg">
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
  /**
   * The venue map tile, passed in already-built (a composed child). Kept as a
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
  venueMap
}: MobileSectionsProps) {
  const { t } = useTranslation('common')

  const mapsQuery = encodeURIComponent(address || `${venueName}, ${commune}, ${city}`)

  // Dividers between sections, softened, and no rule at the bottom. Four
  // `white/10` hairlines down a phone screen plus the container's own closing
  // border read as stripes; at `/[0.06]` they mark structure without becoming
  // the structure, and nothing needs closing at the end — the lineup and the
  // song follow immediately.
  return (
    <div className="divide-y divide-line-soft px-4 md:hidden">
      {/* About */}
      {(description?.trim() || videoUrl || (tags && tags.length > 0)) && (
      <Section title={t('events.about_event')}>
        {description && description.trim() && (
          <p className="whitespace-pre-wrap text-body leading-relaxed text-fg-muted">{description}</p>
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
      )}

      {/* Venue — left out when the event names no place at all; the map
          links would search for an empty string. */}
      {(venueName || address || commune || city) && (
      <Section title={t('events.venue_directions')}>
        {venueName && <p className="text-body font-medium text-fg">{venueName}</p>}
        {venueAddressLines({ venueName, address, commune, city }).map((line, i) => (
          <p key={i} className={`${i === 0 ? 'mt-1 ' : ''}break-words text-body text-fg-muted`}>
            {line}
          </p>
        ))}
        {/* Same placement idea as desktop: address, then the tile, then the two
            map links. Rendered bare (no wrapper div) because the tile returns
            null with no provider key configured, a wrapper would leave its
            margin behind as unexplained blank space inside the section. */}
        {venueMap}
        <p className="mt-3 text-body">
          <a
            href={`https://maps.apple.com/?q=${mapsQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg-muted underline decoration-fg-faint underline-offset-4 transition-colors hover:text-fg"
          >
            {t('events.apple_maps')}
          </a>
          <span className="text-fg-faint"> · </span>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg-muted underline decoration-fg-faint underline-offset-4 transition-colors hover:text-fg"
          >
            {t('events.google_maps')}
          </a>
        </p>
      </Section>
      )}

      {/* The organizer and the date already lead the page (hero, key facts)
          and share sits beside the title, so their sections are gone: only
          the one thing nothing above offers, a way to write to the organizer. */}
    </div>
  )
}
