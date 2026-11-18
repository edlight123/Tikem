'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/components/ui/Toast'

interface FollowButtonProps {
  organizerId: string
  userId: string | null
  initialIsFollowing?: boolean
}

export default function FollowButton({ organizerId, userId, initialIsFollowing = false }: FollowButtonProps) {
  const { t } = useTranslation('common')
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { showToast } = useToast()

  async function toggleFollow() {
    if (!userId) {
      const redirectTo = `${window.location.pathname}${window.location.search || ''}`
      router.push(`/auth/login?redirect=${encodeURIComponent(redirectTo)}`)
      return
    }

    setLoading(true)

    try {
      const response = await fetch('/api/organizers/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizerId })
      })

      if (!response.ok) throw new Error('Failed to toggle follow')

      const data = await response.json()
      setIsFollowing(data.isFollowing)
      
      showToast({
        type: 'success',
        title: data.isFollowing ? t('follow.toast_followed_title', 'Now following!') : t('follow.toast_unfollowed_title', 'Unfollowed'),
        message: data.isFollowing
          ? t('follow.toast_followed_message', "You'll get notified about their new events")
          : t('follow.toast_unfollowed_message', 'You will no longer receive notifications'),
        duration: 3000
      })

      router.refresh()
    } catch (error) {
      console.error('Error toggling follow:', error)
      showToast({
        type: 'error',
        title: t('follow.toast_error_title', 'Failed to update following status'),
        message: t('follow.toast_error_message', 'Please try again later'),
        duration: 4000
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={toggleFollow}
      disabled={loading}
      aria-pressed={isFollowing}
      /* A FILL, not a hairline around nothing. Both states here were a bare
         `border-line`–`/15` with NO background at all — the exact pattern
         the house rule forbids, and on the organizer profile this is the
         PRIMARY action, sitting immediately beside ConnectButton (which is
         filled). Two adjacent controls, one outlined and one filled, read as
         a mistake.
         Follow is the primary here, so it takes the white pill and
         ConnectButton beside it is passed `quiet`; once you already follow,
         the action is no longer primary and drops to a quiet fill.
         Geometry now matches ConnectButton's `md` size (px-4 py-2 text-sm,
         rounded-xl) so the pair lines up exactly. */
      className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors duration-200 ${
        isFollowing
          ? 'bg-surface text-fg-muted hover:bg-surface-high hover:text-fg'
          : 'bg-inverse text-on-inverse hover:bg-inverse-hover'
      } disabled:opacity-50`}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {t('follow.loading', 'Loading...')}
        </span>
      ) : isFollowing ? (
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          {t('follow.following', 'Following')}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('follow.follow_action', 'Follow')}
        </span>
      )}
    </button>
  )
}
