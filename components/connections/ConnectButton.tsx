'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { UserPlus, Check, Clock, X } from 'lucide-react'
import type { FriendshipState } from '@/types/social'

/**
 * Palette follows docs/POSH_DESIGN_BRIEF.md (2026-09-04). It used to fill the
 * affirmative actions with teal — `bg-brand-600` on Accept and a
 * `from-brand-600 to-brand-700` gradient on Add friend — which the brief forbids
 * outright: teal is a semantic accent (verified / live / selected), never a
 * button fill. Affirmative actions are now the white pill. The three quiet
 * states were `border border-line-strong` over `bg-surface-low`, a hairline
 * around a fill too faint to read; they are plain `bg-surface` fills now,
 * on the surface ladder, with the hover step doing the work the border was
 * pretending to do. Geometry (rounded-xl, `pad`) is unchanged so the organizer
 * profile hero still lines up with FollowButton beside it.
 */

interface ConnectButtonProps {
  targetUserId: string
  /** Friendship state from the viewer's perspective. */
  initialState: FriendshipState
  /** Whether a viewer is signed in. When false, clicking routes to login. */
  isAuthenticated: boolean
  size?: 'sm' | 'md'
  /**
   * Render the affirmative action as a quiet fill instead of the white pill.
   *
   * On /connections "Add friend" IS the primary action of its row, so it earns
   * the white pill. On an organizer profile it sits beside Follow, which is
   * that page's primary — two white pills side by side would declare two
   * primaries and neither would read as the main thing to do.
   */
  quiet?: boolean
  onChange?: (state: FriendshipState) => void
}

export default function ConnectButton({
  targetUserId,
  initialState,
  isAuthenticated,
  size = 'md',
  quiet = false,
  onChange,
}: ConnectButtonProps) {
  const router = useRouter()
  const { t } = useTranslation('common')
  const [state, setState] = useState<FriendshipState>(initialState)
  const [loading, setLoading] = useState(false)

  if (state === 'self') return null

  const pad = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'

  const requireAuth = () => {
    if (isAuthenticated) return true
    const redirect = typeof window !== 'undefined' ? window.location.pathname : '/'
    router.push(`/auth/login?redirect=${encodeURIComponent(redirect)}`)
    return false
  }

  const call = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('Request failed')
    return res.json()
  }

  const update = (next: FriendshipState) => {
    setState(next)
    onChange?.(next)
  }

  const sendRequest = async () => {
    if (!requireAuth()) return
    setLoading(true)
    try {
      const data = await call('/api/connections/request', { targetUserId })
      update(data.status as FriendshipState)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const respond = async (action: 'accept' | 'decline') => {
    setLoading(true)
    try {
      const data = await call('/api/connections/respond', { targetUserId, action })
      update(data.status as FriendshipState)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const remove = async () => {
    setLoading(true)
    try {
      await call('/api/connections/remove', { targetUserId })
      update('none')
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  if (state === 'friends') {
    return (
      <button
        onClick={remove}
        disabled={loading}
        className={`group inline-flex items-center gap-1.5 ${pad} font-semibold rounded-xl bg-surface text-fg-soft hover:bg-surface-high hover:text-danger-soft transition-colors disabled:opacity-50`}
        title={t('connections.remove_friend', { defaultValue: 'Remove friend' })}
      >
        <Check className="w-4 h-4 group-hover:hidden" />
        <X className="w-4 h-4 hidden group-hover:block" />
        <span className="group-hover:hidden">{t('connections.state_friends', { defaultValue: 'Friends' })}</span>
        <span className="hidden group-hover:inline">{t('connections.remove', { defaultValue: 'Remove' })}</span>
      </button>
    )
  }

  if (state === 'request_sent') {
    return (
      <button
        onClick={remove}
        disabled={loading}
        className={`inline-flex items-center gap-1.5 ${pad} font-semibold rounded-xl bg-surface text-fg-subtle hover:bg-surface-high hover:text-fg-soft transition-colors disabled:opacity-50`}
        title={t('connections.cancel_request', { defaultValue: 'Cancel request' })}
      >
        <Clock className="w-4 h-4" />
        {t('connections.requested', { defaultValue: 'Requested' })}
      </button>
    )
  }

  if (state === 'request_received') {
    return (
      <div className="inline-flex items-center gap-2">
        <button
          onClick={() => respond('accept')}
          disabled={loading}
          className={`inline-flex items-center gap-1.5 ${pad} font-semibold rounded-xl transition-colors disabled:opacity-50 ${
            quiet
              ? 'bg-surface text-fg-soft hover:bg-surface-high hover:text-fg'
              : 'bg-inverse text-on-inverse hover:bg-inverse-hover'
          }`}
        >
          <Check className="w-4 h-4" />
          {t('connections.accept', { defaultValue: 'Accept' })}
        </button>
        <button
          onClick={() => respond('decline')}
          disabled={loading}
          className={`inline-flex items-center gap-1.5 ${pad} font-semibold rounded-xl bg-surface text-fg-muted hover:bg-surface-high hover:text-fg transition-colors disabled:opacity-50`}
        >
          {t('connections.decline', { defaultValue: 'Decline' })}
        </button>
      </div>
    )
  }

  // state === 'none'
  return (
    <button
      onClick={sendRequest}
      disabled={loading}
      className={`inline-flex items-center gap-1.5 ${pad} font-semibold rounded-xl bg-inverse text-on-inverse hover:bg-inverse-hover transition-colors disabled:opacity-50`}
    >
      <UserPlus className="w-4 h-4" />
      {t('connections.add_friend', { defaultValue: 'Add friend' })}
    </button>
  )
}
