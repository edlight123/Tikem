'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { positionIfPermitted } from '@/lib/location/geolocate'
import { formatDistance, kmBetween, type LatLng } from '@/lib/location/nearestArea'
import { resolveVenueLatLng } from '@/lib/staticMap'

/**
 * "2.4 km away" / "12 mi away" for an event page, or ''.
 * Only when the site already holds the geolocation permission (never prompts)
 * and the event carries venue coordinates. Computed in the page; the position
 * is never sent or stored.
 */
export function useVenueDistance(event: unknown): string {
  const { t, i18n } = useTranslation('common')
  const [here, setHere] = useState<LatLng | null>(null)
  const venue = resolveVenueLatLng(event)
  const hasVenue = !!venue

  useEffect(() => {
    if (!hasVenue) return
    let live = true
    positionIfPermitted().then((p) => {
      if (live && p) setHere(p)
    })
    return () => {
      live = false
    }
  }, [hasVenue])

  if (!here || !venue) return ''
  const country = String((event as { country?: unknown } | null)?.country || '')
  const label = formatDistance(
    kmBetween(here, { lat: venue.latitude, lng: venue.longitude }),
    country,
    i18n.language || 'en',
  )
  return label ? t('current_location.distance_away', { distance: label }) : ''
}
