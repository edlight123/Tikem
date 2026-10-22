'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import type { PublicUserSummary } from '@/types/social'
import type { GuestlistVisibility } from '@/lib/guestlistVisibility'

interface WhosGoingProps {
  eventId: string
  currentUserId: string | null
  /**
   * What the organizer chose in the composer. 'hidden' renders nothing at all
   * — not a privacy note, not a count: the organizer asked for the section to
   * be absent, and a note saying "attendance is private" still announces that
   * there are attendees.
   */
  visibility?: GuestlistVisibility
  /**
   * Spacing, applied to this component's own root rather than to a wrapper
   * around it. A wrapper's `mt-8` survives when this returns null — which it
   * does whenever nobody is going yet — and left 32px of unexplained black
   * above the footer on every quiet event page. Same trap the venue map hit.
   */
  className?: string
}

interface SocialData {
  totalGoing: number
  viewerIsGoing: boolean
  friendsGoing: PublicUserSummary[]
  publicGoing: PublicUserSummary[]
}

function Avatar({ user, size = 40 }: { user: PublicUserSummary; size?: number }) {
  const initial = (user.displayName || 'U').charAt(0).toUpperCase()
  return (
    <div
      className="rounded-full overflow-hidden bg-white/[0.08] flex items-center justify-center text-white font-semibold ring-2 ring-black"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      title={user.displayName}
    >
      {user.photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.photoURL} alt={user.displayName} className="w-full h-full object-cover" />
      ) : (
        initial
      )}
    </div>
  )
}

export default function WhosGoing({
  eventId,
  currentUserId,
  visibility = 'faces',
  className = '',
}: WhosGoingProps) {
  const { t } = useTranslation('common')
  const [data, setData] = useState<SocialData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // No request when the section will not render: the social endpoint returns
    // who is attending, and fetching that for a page that must not show it is
    // both wasted and the kind of thing that leaks through a network tab.
    if (visibility === 'hidden') {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    fetch(`/api/events/${eventId}/social`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json) setData(json)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [eventId, visibility])

  if (visibility === 'hidden') return null

  if (loading) {
    return (
      <div className={`rounded-2xl p-4 md:p-6 ${className}`}>
        <div className="h-5 w-32 rounded mb-4 animate-pulse" />
        <div className="flex -space-x-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="w-10 h-10 rounded-full ring-2 ring-[#0a0a0a] animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!data || data.totalGoing === 0) {
    return null
  }

  const { totalGoing, viewerIsGoing, friendsGoing, publicGoing } = data

  // 'count' — the number, and nothing that identifies anyone. No avatars, no
  // names, no friend row: those are exactly what this mode exists to withhold.
  if (visibility === 'count') {
    return (
      <div className={`rounded-2xl p-4 md:p-6 ${className}`}>
        <h2 className="font-display lowercase italic !text-[22px] !leading-none text-white">
          {t('whos_going.going_count', { count: totalGoing, defaultValue: '{{count}} going' })}
        </h2>
        {viewerIsGoing && (
          <p className="mt-1 text-sm text-white/55">
            {t('whos_going.youre_going', "You're going")}
          </p>
        )}
      </div>
    )
  }

  const pile = publicGoing.slice(0, 8)
  const namedCount = friendsGoing.length + pile.length
  const remaining = Math.max(0, totalGoing - namedCount - (viewerIsGoing ? 1 : 0))

  return (
    <div className={`rounded-2xl p-4 md:p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display lowercase italic !text-[22px] !leading-none text-white">
          {t('whos_going.title', "Who's going")}
        </h2>
        <span className="text-sm font-semibold text-white/50">
          {t(totalGoing === 1 ? 'whos_going.person' : 'whos_going.person_plural', {
            count: totalGoing,
            defaultValue: totalGoing === 1 ? '{{count}} person' : '{{count}} people',
          })}
        </span>
      </div>

      {/* Friends going */}
      {friendsGoing.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-brand-300 uppercase tracking-wide mb-2">
            {t(friendsGoing.length === 1 ? 'whos_going.friend_going' : 'whos_going.friend_going_plural', {
              count: friendsGoing.length,
              defaultValue: friendsGoing.length === 1 ? '{{count}} friend going' : '{{count}} friends going',
            })}
          </p>
          <div className="flex flex-wrap gap-3">
            {friendsGoing.map((f) => (
              <Link
                key={f.uid}
                href={`/profile/organizer/${f.uid}`}
                className="flex items-center gap-2 hover:bg-white/[0.07] rounded pl-1 pr-3 py-1 transition-colors"
              >
                <Avatar user={f} size={28} />
                <span className="text-sm font-medium text-white truncate max-w-[120px]">{f.displayName}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Public face pile */}
      {(pile.length > 0 || viewerIsGoing) && (
        <div className="flex items-center gap-3">
          <div className="flex -space-x-3">
            {viewerIsGoing && (
              <div
                className="rounded-full w-10 h-10 bg-white/[0.14] flex items-center justify-center text-white text-xs font-semibold ring-2 ring-black"
                title={t('whos_going.youre_going', "You're going")}
              >
                {t('whos_going.you_badge', 'You')}
              </div>
            )}
            {pile.map((u) => (
              <Avatar key={u.uid} user={u} size={40} />
            ))}
            {remaining > 0 && (
              <div className="rounded-full w-10 h-10 bg-white/[0.08] flex items-center justify-center text-white/70 text-xs font-semibold ring-2 ring-black">
                +{remaining}
              </div>
            )}
          </div>
          {/* "Rutshelle and 24 others going" — naming the first face makes the
              pile a sentence someone can read, instead of a number beside a
              row of strangers. Falls back to the bare count when nobody in the
              pile is public. */}
          <p className="text-sm text-white/55">
            {(() => {
              const lead = friendsGoing[0]?.displayName || pile[0]?.displayName
              const others = Math.max(0, totalGoing - 1)
              if (viewerIsGoing) return t('whos_going.youre_going', "You're going")
              if (lead && others > 0)
                return t('whos_going.lead_and_others', {
                  name: lead.split(' ')[0],
                  count: others,
                  defaultValue: '{{name}} and {{count}} others going',
                })
              return t('whos_going.going_count', { count: totalGoing, defaultValue: '{{count}} going' })
            })()}
          </p>
        </div>
      )}

      {/* Privacy note when nobody is publicly visible */}
      {friendsGoing.length === 0 && pile.length === 0 && (
        <div className="flex items-start gap-2 text-sm text-white/50">
          <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>
            {t(totalGoing === 1 ? 'whos_going.privacy_note' : 'whos_going.privacy_note_plural', {
              count: totalGoing,
              defaultValue:
                totalGoing === 1
                  ? '{{count}} person is going. Attendees keep their attendance private.'
                  : '{{count}} people are going. Attendees keep their attendance private.',
            })}{' '}
            {currentUserId && (
              <Link href="/profile" className="text-brand-300 hover:underline font-medium">
                {t('whos_going.show_going_cta', "Show that you're going")}
              </Link>
            )}
          </p>
        </div>
      )}
    </div>
  )
}
