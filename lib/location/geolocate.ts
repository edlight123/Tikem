'use client'

/**
 * The browser's coarse position for "Use my current location" and the event
 * page's "2.4 km away".
 *
 * - getBrowserPosition() is only ever called from a click, so the browser's
 *   permission prompt never appears on page load.
 * - positionIfPermitted() never prompts: it reads a position only when this
 *   site already holds the geolocation permission.
 *
 * PRIVACY: coordinates stay in the page (module memory for this tab). They
 * are mapped to an area on the client (lib/location/nearestArea) and never
 * sent to the server or stored.
 */
import type { LatLng } from './nearestArea'

export type GeoErrorCode = 'denied' | 'unavailable' | 'timeout'

export class GeoError extends Error {
  code: GeoErrorCode
  constructor(code: GeoErrorCode) {
    super(`geolocation_${code}`)
    this.code = code
  }
}

let tabPosition: LatLng | null = null

export function getBrowserPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return reject(new GeoError('unavailable'))
    navigator.geolocation.getCurrentPosition(
      (p) => {
        tabPosition = { lat: p.coords.latitude, lng: p.coords.longitude }
        resolve(tabPosition)
      },
      (e) => reject(new GeoError(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
    )
  })
}

/** A position without ever prompting: this tab's, else one read if already permitted. */
export async function positionIfPermitted(): Promise<LatLng | null> {
  if (tabPosition) return tabPosition
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    if (status.state !== 'granted') return null
    return await getBrowserPosition()
  } catch {
    return null
  }
}
