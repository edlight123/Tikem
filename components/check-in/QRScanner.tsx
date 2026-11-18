'use client'

import { useTranslation } from 'react-i18next'

import { useState, useRef, useEffect } from 'react'
import { Camera, FlashlightOff, Flashlight, X } from 'lucide-react'
import { Html5QrcodeScanner, Html5QrcodeScanType } from 'html5-qrcode'

interface QRScannerProps {
  onScan: (ticketId: string) => void
  onClose?: () => void
}

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const { t } = useTranslation('organizer')

  const [flashlightOn, setFlashlightOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const scannerRef = useRef<Html5QrcodeScanner | null>(null)
  const [hasCamera, setHasCamera] = useState(true)

  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      'qr-reader',
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
        showTorchButtonIfSupported: true,
      },
      false
    )

    scanner.render(
      (decodedText: string) => {
        onScan(decodedText)
      },
      (error: string) => {
        // Ignore scanning errors (too frequent)
        if (error.includes('NotFoundException')) return
        console.warn('QR scan error:', error)
      }
    )

    scannerRef.current = scanner

    // Check camera permissions
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then(() => setHasCamera(true))
      .catch((err) => {
        setHasCamera(false)
        setCameraError('Camera access denied. Please enable camera permissions.')
        console.error('Camera error:', err)
      })

    return () => {
      scanner.clear().catch(console.error)
    }
  }, [onScan])

  const toggleFlashlight = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      const track = stream.getVideoTracks()[0]
      const capabilities = track.getCapabilities() as any

      if (capabilities.torch) {
        await track.applyConstraints({
          advanced: [{ torch: !flashlightOn } as any],
        })
        setFlashlightOn(!flashlightOn)
      }
    } catch (error) {
      console.error('Flashlight error:', error)
    }
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Header */}
      <div className="bg-surface-solid p-4 flex items-center justify-between">
        <h2 className="text-fg text-lg font-semibold flex items-center gap-2">
          <Camera className="w-5 h-5" />
          {t('qr_scanner.scan_qr_code')}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFlashlight}
            className="p-2 hover:bg-surface-raised-solid rounded-lg transition-colors"
          >
            {flashlightOn ? (
              <Flashlight className="w-5 h-5 text-warning" />
            ) : (
              <FlashlightOff className="w-5 h-5 text-fg-subtle" />
            )}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 hover:bg-surface-raised-solid rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-fg" />
            </button>
          )}
        </div>
      </div>

      {/* Scanner */}
      <div className="flex-1 flex items-center justify-center p-4">
        {cameraError ? (
          <div className="text-center">
            <Camera className="w-16 h-16 text-fg-subtle mx-auto mb-4" />
            <p className="text-fg text-lg mb-2">{t('qr_scanner.camera_not_available')}</p>
            <p className="text-fg-subtle text-sm">{cameraError}</p>
          </div>
        ) : (
          <div id="qr-reader" className="w-full max-w-md" />
        )}
      </div>

      {/* Instructions */}
      <div className="bg-surface-solid p-4 text-center">
        <p className="text-fg-subtle text-sm">
          {t('qr_scanner.position_qr')}
        </p>
      </div>
    </div>
  )
}
