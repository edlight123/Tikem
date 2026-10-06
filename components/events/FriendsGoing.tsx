'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import type { FriendsGoingResponse } from '@/types/social'

interface FriendsGoingProps {
  eventId: string
  /** Signed-out viewers have no friends to show; nothing is fetched. */
  currentUserId: string | null
  className?: string
}

/**
 * "3 friends going" with faces: only the viewer's own connections, privacy
 * applied server-side (lib/social/suggestions.ts). Behind
 * config/auth.friend_suggestions, which the endpoint enforces; with it off the
 * response says `enabled: false` and this renders nothing (no wrapper, so no
 * stray margin).
 */
export default function FriendsGoing({ eventId, currentUserId, className = '' }: FriendsGoingProps) {
  const { t } = useTranslation('common')
  const [data, setData] = useState<FriendsGoingResponse | null>(null)

  useEffect(() => {
    if (!currentUserId) {
      setData(null)
      return
    }
    let active = true
    fetch(`/api/events/${encodeURIComponent(eventId)}/friends-going`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json) setData(json)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [eventId, currentUserId])

  if (!currentUserId || !data?.enabled || !data.count || data.friends.length === 0) return null

  const label =
    data.count === 1
      ? t('friendsGoing.one', { name: data.friends[0].displayName, defaultValue: '{{name}} is going' })
      : t('friendsGoing.other', { count: data.count, defaultValue: '{{count}} friends going' })

  return (
    <div className={`px-4 md:px-0 ${className}`}>
      <div className="flex items-center gap-3 rounded-2xl bg-white/[0.055] px-4 py-3">
        <div className="flex -space-x-2.5">
          {data.friends.map((f) => (
            <Link
              key={f.uid}
              href={`/profile/organizer/${f.uid}`}
              title={f.displayName}
              className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-white/[0.12] text-xs font-semibold text-white ring-2 ring-black"
            >
              {f.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.photoURL} alt={f.displayName} className="h-full w-full object-cover" />
              ) : (
                (f.displayName || 'U').charAt(0).toUpperCase()
              )}
            </Link>
          ))}
        </div>
        <p className="min-w-0 flex-1 truncate text-[15px] font-bold text-white">{label}</p>
      </div>
    </div>
  )
}
