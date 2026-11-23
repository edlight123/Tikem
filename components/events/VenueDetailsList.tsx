'use client'

/**
 * "Good to know" on the event page: the venue details the organizer ticked
 * (lib/events/venue-details), as quiet icon lines. No chips, no boxes: a
 * line icon and a sentence each, like the rest of the page's facts. Renders
 * nothing when the event says nothing.
 */
import { useTranslation } from 'react-i18next'
import { Accessibility, House, IdCard, Luggage, Shirt, SquareParking, Tent, Toilet, Trees, type LucideIcon } from 'lucide-react'
import { venueDetailLines, venueDetailsOf, type VenueDetailIcon } from '@/lib/events/venue-details'

const ICONS: Record<VenueDetailIcon, LucideIcon> = {
  parking: SquareParking,
  step_free: Accessibility,
  accessible_washrooms: Toilet,
  coat_check: Luggage,
  indoor: House,
  outdoor: Trees,
  mixed: Tent,
  age: IdCard,
  dress: Shirt,
}

export function useVenueDetailLines(event: unknown) {
  return venueDetailLines(venueDetailsOf(event))
}

export default function VenueDetailsList({ event, className = '' }: { event: unknown; className?: string }) {
  const { t } = useTranslation('common')
  const lines = useVenueDetailLines(event)
  if (!lines.length) return null
  return (
    <ul className={`space-y-2.5 ${className}`}>
      {lines.map((line) => {
        const Icon = ICONS[line.icon]
        return (
          <li key={line.key} className="flex items-center gap-3 text-body text-fg-muted">
            <Icon className="h-[18px] w-[18px] shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden="true" />
            <span>{t(`venue_details.${line.key}`, { value: line.value })}</span>
          </li>
        )
      })}
    </ul>
  )
}
