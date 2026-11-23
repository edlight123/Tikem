'use client'

/**
 * "Good to know" on the event page: the venue details the organizer ticked
 * (lib/events/venue-details), as quiet icon lines. What the place has, the
 * setting and the rules first; then accessibility under its own short
 * "accessibility" heading. No chips, no boxes: a line icon and a sentence
 * each, like the rest of the page's facts. Renders nothing when the event
 * says nothing.
 */
import { useTranslation } from 'react-i18next'
import {
  Accessibility,
  AirVent,
  Armchair,
  ArrowUpDown,
  Captions,
  CircleParking,
  Dog,
  DoorOpen,
  Hand,
  House,
  IdCard,
  Luggage,
  Martini,
  PlugZap,
  ShieldCheck,
  Shirt,
  Sofa,
  SquareParking,
  Tent,
  Toilet,
  Trees,
  Utensils,
  VolumeOff,
  type LucideIcon,
} from 'lucide-react'
import {
  venueAccessLines,
  venueDetailLines,
  venueDetailsOf,
  type VenueDetailIcon,
  type VenueDetailLine,
} from '@/lib/events/venue-details'

const ICONS: Record<VenueDetailIcon, LucideIcon> = {
  parking: SquareParking,
  backup_power: PlugZap,
  air_conditioning: AirVent,
  security: ShieldCheck,
  table_service: Sofa,
  food: Utensils,
  bar: Martini,
  coat_check: Luggage,
  step_free: DoorOpen,
  wheelchair: Accessibility,
  elevator: ArrowUpDown,
  accessible_washrooms: Toilet,
  accessible_parking: CircleParking,
  seating: Armchair,
  sign_language: Hand,
  captions: Captions,
  quiet_room: VolumeOff,
  service_animals: Dog,
  indoor: House,
  outdoor: Trees,
  mixed: Tent,
  age: IdCard,
  dress: Shirt,
}

function Lines({ lines }: { lines: VenueDetailLine[] }) {
  const { t } = useTranslation('common')
  return (
    <ul className="space-y-2.5">
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

export default function VenueDetailsList({ event, className = '' }: { event: unknown; className?: string }) {
  const { t } = useTranslation('common')
  const d = venueDetailsOf(event)
  const facts = venueDetailLines(d)
  const access = venueAccessLines(d)
  if (!facts.length && !access.length) return null
  return (
    <div className={className}>
      {facts.length > 0 && <Lines lines={facts} />}
      {access.length > 0 && (
        <div className={facts.length ? 'mt-5' : ''}>
          <h3 className="mb-2.5 font-display lowercase italic text-lead text-fg">{t('venue_details.accessibility_title')}</h3>
          <Lines lines={access} />
        </div>
      )}
    </div>
  )
}
