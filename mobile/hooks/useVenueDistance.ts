/**
 * "2.4 km away" / "12 mi away" for an event's venue, or ''.
 *
 * Only when ALL of these hold:
 *   - this build has the location native module;
 *   - the person shared their location this session ("Use my current
 *     location", or "Follow my location" is on and permission is granted);
 *   - the event carries venue coordinates (lib/staticMap resolveVenueLatLng);
 *   - it is close enough to matter (areaResolve.MAX_DISTANCE_KM).
 * Never prompts. Computed on the phone; the position is never stored or sent.
 */
import { useEffect, useState } from 'react';
import { useFilters } from '../contexts/FiltersContext';
import { useI18n } from '../contexts/I18nContext';
import { formatDistance, kmBetween, type LatLng } from '../lib/areaResolve';
import { getSessionPosition, positionIfGranted } from '../lib/currentLocation';
import { resolveVenueLatLng } from '../lib/staticMap';

export function useVenueDistance(event: any): string {
  const { t, language } = useI18n();
  const { locationAvailable, followLocation, userCountry } = useFilters();
  const [here, setHere] = useState<LatLng | null>(() => (locationAvailable ? getSessionPosition() : null));

  useEffect(() => {
    if (!locationAvailable || here || !followLocation) return;
    let live = true;
    positionIfGranted().then((p) => {
      if (live && p) setHere(p);
    });
    return () => {
      live = false;
    };
  }, [locationAvailable, followLocation, here]);

  const venue = event ? resolveVenueLatLng(event) : null;
  if (!here || !venue) return '';
  const label = formatDistance(
    kmBetween(here, { lat: venue.latitude, lng: venue.longitude }),
    event?.country || userCountry,
    language,
  );
  return label ? t('location.distanceAway', { distance: label }) : '';
}
