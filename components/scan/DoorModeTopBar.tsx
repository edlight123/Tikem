'use client'

import { X, Users, UserCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'

interface DoorModeTopBarProps {
  eventTitle: string
  eventId: string
  exitHref?: string
  entryPoint: string
  entryPoints: string[]
  onEntryPointChange: (point: string) => void
  checkedInCount: number
  remainingCount: number
}

export function DoorModeTopBar({
  eventTitle,
  eventId,
  exitHref,
  entryPoint,
  entryPoints,
  onEntryPointChange,
  checkedInCount,
  remainingCount,
}: DoorModeTopBarProps) {
  const { t } = useTranslation('organizer')
  const router = useRouter()
  const totalTickets = checkedInCount + remainingCount

  const resolvedExitHref = exitHref || `/organizer/scan`

  return (
    <div className="sticky top-0 z-50 bg-black text-white">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-4 mb-3">
          {/* Event Title */}
          <h1 className="text-lg font-bold truncate flex-1">{eventTitle}</h1>

          {/* Exit Button */}
          <button
            onClick={() => router.push(resolvedExitHref)}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.07] hover:bg-white/[0.12] rounded-full transition-colors text-sm font-medium"
          >
            <X className="w-4 h-4" />
            Exit
          </button>
        </div>

        <div className="flex items-center justify-between gap-4">
          {/* Entry Point Selector */}
          <select
            value={entryPoint}
            onChange={(e) => onEntryPointChange(e.target.value)}
            className="px-3 py-2 bg-white/[0.06] rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {entryPoints.map((point) => (
              <option key={point} value={point}>
                {point}
              </option>
            ))}
          </select>

          {/* Live Counters */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 rounded-xl">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              <div className="text-right">
                <div className="text-xs text-emerald-400 font-medium">{t('door.checked_in', { defaultValue: 'Checked In' })}</div>
                <div className="text-lg font-bold text-emerald-300">{checkedInCount}/{totalTickets}</div>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.055] rounded-xl">
              <Users className="w-4 h-4 text-white/60" />
              <div className="text-right">
                <div className="text-xs text-white/60 font-medium">{t('door.remaining', { defaultValue: 'Remaining' })}</div>
                <div className="text-lg font-bold text-white">{remainingCount}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
