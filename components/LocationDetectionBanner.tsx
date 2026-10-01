'use client'

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { updateUserProfile } from '@/lib/firestore/user-profile'
import { normalizeCountry, saveCountryChoice } from '@/lib/home/country'

interface DetectedLocation {
  detected: boolean
  raw?: {
    country: string
    countryCode: string
    city: string
    region: string
  }
  mapped?: {
    countryCode: string
    countryName: string
    city: string | null
    isSupported: boolean
  }
  displayName?: string
}

interface LocationDetectionBannerProps {
  userId?: string
  currentCountry?: string
  currentCity?: string
  onLocationAccepted?: (countryCode: string, city: string | null) => void
}

export function LocationDetectionBanner({
  userId,
  currentCountry,
  currentCity,
  onLocationAccepted
}: LocationDetectionBannerProps) {
  const { t } = useTranslation('common')
  const [location, setLocation] = useState<DetectedLocation | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isAccepting, setIsAccepting] = useState(false)
  const [hasAnimatedIn, setHasAnimatedIn] = useState(false)

  useEffect(() => {
    // Check if user has already dismissed or has a location set
    const dismissed = localStorage.getItem('location-banner-dismissed')
    const hasLocation = currentCountry && currentCountry !== 'HT'

    if (dismissed || hasLocation) {
      setIsLoading(false)
      return
    }

    // Detect location
    const detectLocation = async () => {
      try {
        const response = await fetch('/api/geolocation')
        const data = await response.json()

        if (data.detected && data.mapped?.isSupported) {
          // Only show if detected country is different from current
          if (data.mapped.countryCode !== currentCountry) {
            setLocation(data)
            setIsVisible(true)
            // Trigger animation after a small delay
            setTimeout(() => setHasAnimatedIn(true), 50)
          }
        }
      } catch (error) {
        console.error('Failed to detect location:', error)
      } finally {
        setIsLoading(false)
      }
    }

    detectLocation()
  }, [currentCountry])

  const handleAccept = async () => {
    if (!location?.mapped) return

    setIsAccepting(true)

    try {
      // Determine the subarea (state/region) from raw detection
      const detectedSubarea = location.raw?.region || ''

      // Save to profile if logged in - include country, city, AND subarea
      if (userId) {
        await updateUserProfile(userId, {
          defaultCountry: location.mapped.countryCode,
          defaultCity: location.mapped.city || '',
          defaultSubarea: detectedSubarea,
        })
      }

      // Save to localStorage for anonymous users
      localStorage.setItem('detected-location', JSON.stringify({
        countryCode: location.mapped.countryCode,
        city: location.mapped.city,
        subarea: detectedSubarea
      }))

      // The server reads the country from this cookie, so an anonymous
      // visitor's "Use" scopes the homepage too, not just localStorage.
      const chosen = normalizeCountry(location.mapped.countryCode)
      if (chosen) saveCountryChoice(chosen)

      // Mark as accepted
      localStorage.setItem('location-banner-dismissed', 'accepted')

      // Callback
      onLocationAccepted?.(location.mapped.countryCode, location.mapped.city)

      // Animate out
      setHasAnimatedIn(false)
      setTimeout(() => setIsVisible(false), 300)

      // Reload to apply new location
      setTimeout(() => window.location.reload(), 400)
    } catch (error) {
      console.error('Failed to save location:', error)
    } finally {
      setIsAccepting(false)
    }
  }

  const handleDismiss = () => {
    localStorage.setItem('location-banner-dismissed', 'dismissed')
    setHasAnimatedIn(false)
    setTimeout(() => setIsVisible(false), 300)
  }

  if (isLoading || !isVisible || !location) {
    return null
  }

  return (
    <div
      className={`
        fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-1.5rem)] max-w-xs
        transition-all duration-300 ease-out
        ${hasAnimatedIn
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 -translate-y-3'
        }
      `}
    >
      {/* Compact single-line pill: pin + "Events near {place}?" + Use / dismiss */}
      <div className="flex items-center gap-2 rounded-full bg-white/[0.03] border border-white/10 pl-3.5 pr-1.5 py-1.5">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="shrink-0 text-brand-500" aria-hidden>
          <path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="12" cy="11" r="2" stroke="currentColor" strokeWidth="2" />
        </svg>
        <p className="flex-1 min-w-0 truncate text-[13px] text-white/70">
          {t('location_banner.near_place', {
            defaultValue: 'Events near {{place}}?',
            place: location.displayName,
          })}
        </p>
        <button
          onClick={handleAccept}
          disabled={isAccepting}
          className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[13px] font-semibold text-black hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          {isAccepting ? '…' : t('location_banner.use', 'Use')}
        </button>
        <button
          onClick={handleDismiss}
          aria-label={t('location_banner.not_now_aria', 'Not now')}
          className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-white/50 hover:bg-white/[0.06] hover:text-white transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
