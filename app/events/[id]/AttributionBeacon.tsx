'use client'

import { useEffect } from 'react'
import { captureAttribution, sendClickBeacon } from '@/lib/attribution-client'

/**
 * Renders nothing. On load, captures `t` / `ref` / `utm_*` for checkout and
 * counts the click — only when the visit itself came through a link, never for
 * a later visit that merely has stored attribution.
 */
export default function AttributionBeacon({ eventId }: { eventId: string }) {
  useEffect(() => {
    const { attribution, fromUrl } = captureAttribution(eventId)
    if (fromUrl) sendClickBeacon(eventId, attribution)
  }, [eventId])
  return null
}
