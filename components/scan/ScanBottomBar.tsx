'use client'

import { Flashlight, SwitchCamera, Search, Volume2, VolumeX } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ScanBottomBarProps {
  onManualLookup: () => void
}

export function ScanBottomBar({ onManualLookup }: ScanBottomBarProps) {
  const { t } = useTranslation('organizer')
  const [flashlightOn, setFlashlightOn] = useState(false)
  const [soundOn, setSoundOn] = useState(true)

  const toggleFlashlight = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      })
      
      const track = stream.getVideoTracks()[0]
      const capabilities = track.getCapabilities() as any // Torch API is experimental
      
      if (capabilities.torch) {
        // @ts-ignore - Torch API not in TypeScript types yet
        await (track as any).applyConstraints({
          advanced: [{ torch: !flashlightOn }]
        })
        setFlashlightOn(!flashlightOn)
      }
    } catch (error) {
      console.error('Flashlight error:', error)
    }
  }

  return (
    <div className="sticky bottom-0 z-40 bg-black/40 backdrop-blur-lg border-t border-white/10">
      <div className="px-4 py-4">
        <div className="flex items-center justify-around gap-2">
          {/* Flashlight */}
          <button
            onClick={toggleFlashlight}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded transition-all ${
              flashlightOn
                ? 'bg-white/[0.14] text-white ring-1 ring-inset ring-brand-400/50'
                : 'text-white hover:bg-white/[0.12]'
            }`}
          >
            <Flashlight className="w-6 h-6" />
            <span className="text-xs font-medium">{t('door.flash', { defaultValue: 'Flash' })}</span>
          </button>

          {/* Manual Lookup */}
          <button
            onClick={onManualLookup}
            className="flex flex-col items-center gap-1 px-6 py-2 bg-white hover:bg-white/90 text-black font-semibold rounded transition-colors"
          >
            <Search className="w-6 h-6" />
            <span className="text-xs font-medium">{t('door.manual', { defaultValue: 'Manual' })}</span>
          </button>

          {/* Sound Toggle */}
          <button
            onClick={() => setSoundOn(!soundOn)}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded transition-all ${
              soundOn
                ? 'text-white hover:bg-white/20'
                : 'bg-white/[0.07] text-white/40'
            }`}
          >
            {soundOn ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
            <span className="text-xs font-medium">{t('door.sound', { defaultValue: 'Sound' })}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
