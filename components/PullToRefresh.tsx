'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: React.ReactNode
}

export default function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [startY, setStartY] = useState(0)

  const threshold = 80 // Pull distance needed to trigger refresh

  useEffect(() => {
    let isMounted = true

    const handleTouchStart = (e: TouchEvent) => {
      // Only start if at top of page
      if (window.scrollY === 0) {
        setStartY(e.touches[0].clientY)
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (isRefreshing || window.scrollY > 0) return

      const currentY = e.touches[0].clientY
      const distance = currentY - startY

      if (distance > 0 && distance < 150) {
        setPullDistance(distance)
      }
    }

    const handleTouchEnd = async () => {
      if (pullDistance > threshold && !isRefreshing) {
        setIsRefreshing(true)
        try {
          await onRefresh()
        } finally {
          if (isMounted) {
            setIsRefreshing(false)
            setPullDistance(0)
          }
        }
      } else {
        setPullDistance(0)
      }
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: true })
    document.addEventListener('touchend', handleTouchEnd)

    return () => {
      isMounted = false
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [startY, pullDistance, isRefreshing, onRefresh, threshold])

  const rotation = Math.min((pullDistance / threshold) * 360, 360)
  const opacity = Math.min(pullDistance / threshold, 1)

  return (
    <div className="relative">
      {/* Pull indicator */}
      {pullDistance > 0 && (
        <div
          className="fixed top-0 left-0 right-0 z-40 flex justify-center pointer-events-none"
          style={{
            transform: `translateY(${Math.min(pullDistance - 40, 60)}px)`,
            transition: pullDistance === 0 ? 'transform 0.3s ease-out' : 'none',
          }}
        >
          <div
            /* Was `bg-inverse` with a `text-brand-600` glyph — a light-theme puck
               that flashed as a white disc over the black app on every pull.
               Same elevated-overlay fill as the toast (#1c1c1c), and the teal
               moves to the 400 end so it reads on a dark disc. */
            className="bg-surface-raised-solid rounded-full p-3 shadow-hard"
            style={{ opacity }}
          >
            <RefreshCw
              className={`w-6 h-6 text-brand-400 ${isRefreshing ? 'animate-spin' : ''}`}
              style={{
                transform: isRefreshing ? 'none' : `rotate(${rotation}deg)`,
                transition: 'transform 0.1s ease-out',
              }}
            />
          </div>
        </div>
      )}

      {/* Content */}
      {children}
    </div>
  )
}
