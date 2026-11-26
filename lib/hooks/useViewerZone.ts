'use client'

import { useEffect, useState } from 'react'
import { deviceZone } from '@/lib/events/zonedTime'

/**
 * The viewer's own IANA zone, read after mount. The server render doesn't know
 * it, so this is null on the server and on the first client render (no
 * hydration mismatch), then the browser's zone.
 */
export function useViewerZone(): string | null {
  const [zone, setZone] = useState<string | null>(null)
  useEffect(() => {
    setZone(deviceZone())
  }, [])
  return zone
}
