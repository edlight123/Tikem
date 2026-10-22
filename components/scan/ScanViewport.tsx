'use client'

import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { useTranslation } from 'react-i18next'

interface ScanViewportProps {
  onScan: (result: string) => void
  isProcessing: boolean
}

export function ScanViewport({ onScan, isProcessing }: ScanViewportProps) {
  const { t } = useTranslation('organizer')
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const onScanRef = useRef(onScan)
  const isProcessingRef = useRef(isProcessing)
  const [error, setError] = useState<string | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [showOpenInApp, setShowOpenInApp] = useState(false)

  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  useEffect(() => {
    isProcessingRef.current = isProcessing
  }, [isProcessing])

  const openInAppUrl = 'tikem://'

  const isMobile = (() => {
    if (typeof navigator === 'undefined') return false
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  })()

  const isIOS = (() => {
    if (typeof navigator === 'undefined') return false
    return /iPhone|iPad|iPod/i.test(navigator.userAgent)
  })()

  const isStandalone = (() => {
    if (typeof window === 'undefined') return false
    const mql = window.matchMedia?.('(display-mode: standalone)')
    const iosStandalone = (navigator as any)?.standalone
    return Boolean(mql?.matches || iosStandalone)
  })()

  useEffect(() => {
    let cancelled = false

    const allowCamera = (() => {
      if (typeof window === 'undefined') return false
      // getUserMedia generally requires HTTPS (or localhost).
      const isSecure = window.location.protocol === 'https:' || window.location.hostname === 'localhost'
      const hasGetUserMedia = !!navigator.mediaDevices?.getUserMedia
      return isSecure && hasGetUserMedia
    })()

    // If scanning doesn't work reliably on this device/context, show a friendly path forward.
    if (!isMobile) {
      setError('Scanning is only available on a mobile device.')
      setShowOpenInApp(true)
      return
    }

    // Prefer (but don't require) the installed experience on iOS.
    if (isIOS && !isStandalone) {
      setShowOpenInApp(true)
    }

    if (!allowCamera) {
      setError('Camera access is not available in this browser. Please use the Tikèm app.')
      setShowOpenInApp(true)
      return
    }

    const scanner = new Html5Qrcode('qr-reader')
    scannerRef.current = scanner

    const config = { fps: 10, qrbox: { width: 250, height: 250 } }

    scanner
      .start(
        { facingMode: 'environment' },
        config,
        (decodedText) => {
          if (!isProcessingRef.current) {
            onScanRef.current(decodedText)
          }
        },
        () => {
          // Ignore scan errors
        }
      )
      .then(() => {
        if (cancelled) return
        setIsInitialized(true)
        setError(null)
      })
      .catch((err) => {
        console.error('Scanner start error:', err)
        if (cancelled) return
        setError('Camera access denied or not available')
        setShowOpenInApp(true)
      })

    return () => {
      cancelled = true
      const current = scannerRef.current
      scannerRef.current = null
      if (!current) return

      const stopIfNeeded = async () => {
        try {
          if ((current as any).isScanning) {
            await current.stop()
          }
        } catch {
          // ignore stop errors on unmount/navigation
        }
        try {
          // Ensure the video element + overlays are removed cleanly
          await (current as any).clear?.()
        } catch {
          // ignore
        }
      }

      void stopIfNeeded()
    }
  }, [isIOS, isMobile, isStandalone])

  // Pause/resume scanning based on processing state
  useEffect(() => {
    if (!scannerRef.current || !isInitialized) return

    if (isProcessing) {
      // Scanner will ignore scans during processing due to callback check
    }
  }, [isProcessing, isInitialized])

  return (
    <div className="relative flex-1 bg-black flex items-center justify-center">
      {/* Scanner Container */}
      <div id="qr-reader" className="w-full max-w-lg" />

      {/* Scanning Frame Overlay */}
      {isInitialized && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="relative">
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-brand-500 rounded-tl-xl" />
            <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-brand-500 rounded-tr-xl" />
            <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-brand-500 rounded-bl-xl" />
            <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-brand-500 rounded-br-xl" />
          </div>
        </div>
      )}

      {/* Helper Text */}
      <div className="absolute bottom-8 left-0 right-0 text-center">
        <p className="text-white text-sm font-medium bg-black/50 backdrop-blur-sm px-4 py-2 rounded inline-block">
          {isProcessing ? 'Processing...' : 'Point camera at ticket QR code'}
        </p>
      </div>

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center px-6">
            <div className="w-16 h-16 rounded flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="text-white font-semibold mb-2">{t('door.camera_error', { defaultValue: 'Camera Error' })}</p>
            <p className="text-white/40 text-sm">{error}</p>

            {showOpenInApp ? (
              <div className="mt-4">
                <a
                  href={openInAppUrl}
                  className="inline-block px-5 py-2.5 bg-white hover:bg-white/90 text-black font-semibold rounded transition-colors"
                >
                  Open Tikèm app
                </a>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
