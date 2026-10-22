'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/components/ui/Toast'
import { Heart } from 'lucide-react'

interface FavoriteButtonProps {
  eventId: string
  userId: string | null
  initialIsFavorite?: boolean
}

export default function FavoriteButton({ eventId, userId, initialIsFavorite = false }: FavoriteButtonProps) {
  const { t } = useTranslation('common')
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { showToast } = useToast()

  async function toggleFavorite() {
    if (!userId) {
      const redirectTo = `${window.location.pathname}${window.location.search || ''}`
      router.push(`/auth/login?redirect=${encodeURIComponent(redirectTo)}`)
      return
    }

    setLoading(true)

    try {
      const response = await fetch('/api/favorites/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId })
      })

      if (!response.ok) throw new Error('Failed to toggle favorite')

      const data = await response.json()
      setIsFavorite(data.isFavorite)
      
      showToast({
        type: 'success',
        title: data.isFavorite ? t('favorites.toast.added_title', 'Added to favorites!') : t('favorites.toast.removed_title', 'Removed from favorites'),
        message: data.isFavorite
          ? t('favorites.toast.added_message', 'You can find this event in your favorites')
          : t('favorites.toast.removed_message', 'Event removed from your favorites'),
        duration: 3000
      })

      router.refresh()
    } catch (error) {
      console.error('Error toggling favorite:', error)
      showToast({
        type: 'error',
        title: t('favorites.toast.error_title', 'Failed to update favorites'),
        message: t('favorites.toast.error_message', 'Please try again later'),
        duration: 4000
      })
    } finally {
      setLoading(false)
    }
  }

  const label = isFavorite
    ? t('favorites.toast.aria_remove', 'Remove from favorites')
    : t('favorites.toast.aria_add', 'Add to favorites')

  /**
   * Geometry deliberately identical to ShareIconButton: a 40px disc with an
   * 18px glyph. These two are the event page's only secondary actions and they
   * now sit side by side in the sticky bar, so any difference in size or
   * radius reads as a mistake rather than as a pair.
   *
   * A FILL, not a hairline: this used to be `bg-white/[0.03]` inside a
   * `border-white/10`, which is the "border around nothing" the house rule
   * forbids — at 3% the disc was invisible and only its outline showed. The
   * active state carries its own red fill instead of a red border, and the
   * old `shadow-md`/`hover:scale-110` are gone: nothing else on this page
   * grows under the cursor, and a phone has no hover to grow with.
   */
  return (
    <button
      onClick={toggleFavorite}
      disabled={loading}
      className={`grid h-10 w-10 place-items-center rounded transition-colors duration-200 active:scale-90 disabled:opacity-50 ${
        isFavorite
          ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
          : 'bg-white/[0.06] text-white/65 hover:bg-white/[0.12] hover:text-red-400'
      }`}
      aria-label={label}
      aria-pressed={isFavorite}
      title={label}
    >
      <Heart className="h-[18px] w-[18px]" fill={isFavorite ? 'currentColor' : 'none'} />
    </button>
  )
}
