'use client'

// "friends are going": upcoming events the signed-in viewer's friends hold
// tickets for (GET /api/social/friend-activity; every privacy rule lives in
// lib/social/friend-activity.ts: friends who chose to share only, public
// listed events only). Signed out, switched off, or nothing to show: the
// section is not rendered at all.
//
// No Firebase import here on purpose (see components/discover/
// FriendsGoingContext.tsx): the route reads the session cookie, so a plain
// same-origin fetch is enough and the homepage stays light.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '@/components/ui/EditorialRails'
import { DiscoverEventCard } from '@/components/discover/DiscoverEventCard'
import { DEFAULT_AVATAR } from '@/lib/defaultAvatar'

type Friend = { uid: string; displayName: string; photoURL: string | null }
type ActivityEvent = Record<string, any> & { id: string; friendCount: number; friends: Friend[] }

function firstName(name: string): string {
  return String(name || '').trim().split(/\s+/)[0] || ''
}

export function friendsGoingLine(
  t: (k: string, o?: Record<string, unknown>) => string,
  friends: Friend[],
  count: number
): string {
  const names = friends.map((f) => firstName(f.displayName)).filter(Boolean)
  if (count <= 1 && names[0]) return t('home.friends_going.one', { name: names[0] })
  if (count === 2 && names.length >= 2) return t('home.friends_going.two', { a: names[0], b: names[1] })
  if (names.length >= 2) return t('home.friends_going.many', { a: names[0], b: names[1], count: count - 2 })
  return t('home.friends_going.count', { count })
}

export default function FriendsGoingRail() {
  const { t } = useTranslation('common')
  const [events, setEvents] = useState<ActivityEvent[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/social/friend-activity', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.enabled && Array.isArray(data.events)) setEvents(data.events.slice(0, 12))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!events.length) return null
  return (
    <section>
      <SectionHeader title={t('home.friends_going.title', { defaultValue: 'friends are going' })} />
      <div className="rail -mx-4 scroll-px-4 px-4 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0">
        {events.map((event) => (
          <div key={event.id} className="w-[228px] sm:w-[248px]">
            <DiscoverEventCard event={event as any} />
            <div className="mt-2 flex items-center gap-2">
              <span className="flex -space-x-1.5" aria-hidden>
                {event.friends.slice(0, 3).map((f) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={f.uid}
                    src={f.photoURL || DEFAULT_AVATAR}
                    alt=""
                    className="h-5 w-5 rounded-full bg-surface object-cover ring-2 ring-canvas"
                  />
                ))}
              </span>
              <span className="truncate text-meta text-fg-muted">
                {friendsGoingLine(t as any, event.friends, event.friendCount)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
