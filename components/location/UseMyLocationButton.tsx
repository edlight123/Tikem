'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Loader2, LocateFixed } from 'lucide-react'
import { GeoError, getBrowserPosition } from '@/lib/location/geolocate'
import { nearestArea, webCityForArea } from '@/lib/location/nearestArea'

/**
 * "Use my current location" for the website's location pickers (Discover's
 * city menu and the filters sheet). One click asks the browser, the nearest
 * Tikèm area is found IN THE PAGE, and only its country and city go into the
 * Discover URL, the same as picking them by hand. Never prompts on load.
 * Not rendered at all when the browser has no geolocation.
 */
export function UseMyLocationButton({ onDone, className = '' }: { onDone?: () => void; className?: string }) {
  const { t } = useTranslation('common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [supported, setSupported] = useState(false)
  const [locating, setLocating] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && !!navigator.geolocation)
  }, [])

  if (!supported) return null

  const locate = async () => {
    if (locating) return
    setLocating(true)
    setNote('')
    try {
      const area = nearestArea(await getBrowserPosition())
      if (!area || area.unsupported) {
        setNote(t('current_location.unsupported'))
        return
      }
      const params = new URLSearchParams(searchParams?.toString() || '')
      params.set('country', area.country)
      const city = webCityForArea(area)
      if (city) params.set('city', city)
      else params.delete('city')
      params.delete('commune')
      router.push(`/discover?${params.toString()}`, { scroll: false })
      onDone?.()
    } catch (e) {
      const code = e instanceof GeoError ? e.code : 'unavailable'
      setNote(t(code === 'denied' ? 'current_location.denied' : 'current_location.unavailable'))
    } finally {
      setLocating(false)
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={locate}
        disabled={locating}
        aria-busy={locating}
        className="flex min-h-10 w-full items-center gap-2.5 rounded bg-surface px-3 text-start text-sm font-medium text-fg transition-colors hover:bg-surface-raised disabled:opacity-70"
      >
        {locating ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-fg-muted" aria-hidden />
        ) : (
          <LocateFixed className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <span className="truncate">{locating ? t('current_location.locating') : t('current_location.use_current')}</span>
      </button>
      {note && (
        <p role="status" className="mt-2 text-meta text-fg-muted">
          {note}
        </p>
      )}
    </div>
  )
}

export default UseMyLocationButton
