'use client'

import { useEffect } from 'react'

/**
 * Renders nothing. Once the page has loaded, counts one view of this event
 * (POST /api/events/[id]/view; the server dedupes per viewer per day and skips
 * the organizer's own visits). Fire-and-forget: failures are ignored.
 */
export default function ViewBeacon({ eventId }: { eventId: string }) {
  useEffect(() => {
    const send = () => {
      void fetch(`/api/events/${encodeURIComponent(eventId)}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => undefined)
    }
    if (document.readyState === 'complete') {
      send()
      return
    }
    window.addEventListener('load', send, { once: true })
    return () => window.removeEventListener('load', send)
  }, [eventId])
  return null
}
